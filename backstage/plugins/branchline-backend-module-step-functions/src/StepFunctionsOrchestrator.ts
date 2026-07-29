import {
  DescribeExecutionCommand,
  DescribeStateMachineCommand,
  GetExecutionHistoryCommand,
  HistoryEvent,
  ListStateMachinesCommand,
  ListTagsForResourceCommand,
  SFNClient,
  SendTaskSuccessCommand,
  StartExecutionCommand,
  StateMachineListItem,
  StopExecutionCommand,
} from '@aws-sdk/client-sfn';
import { Config } from '@backstage/config';
import type {
  FlowGraph,
  ParallelBlock,
  TaskStatus,
} from '@internal/backstage-plugin-branchline-common';
import type {
  OrchestratorDefinition,
  StartWorkflowResult,
  TaskActionInput,
  WorkflowOrchestrator,
} from '@internal/backstage-plugin-branchline-node';
import { aslToFlowGraph, AslActionRecord } from './AslAdapter';
import { AslDefinition, listPhaseNames, parseAslDefinition } from './AslDefinition';
import { CandidateGroupResolver } from './CandidateGroupResolver';
import { TaskTokenStore } from './TaskTokenStore';

const DEFINITION_ID_TAG = 'branchline:definitionId';
const VERSION_TAG = 'branchline:version';

interface TaggedStateMachine {
  arn: string;
  name: string;
  definitionId: string;
  version: number;
}

export class StepFunctionsOrchestrator implements WorkflowOrchestrator {
  private readonly client: SFNClient;
  private readonly candidateGroups: CandidateGroupResolver;

  constructor(
    config: Config,
    private readonly tokenStore: TaskTokenStore,
  ) {
    const sfnConfig = config.getOptionalConfig('branchline.stepFunctions');
    this.client = new SFNClient({
      region: sfnConfig?.getOptionalString('region'),
    });
    this.candidateGroups = new CandidateGroupResolver(config);
  }

  private async listTaggedStateMachines(): Promise<TaggedStateMachine[]> {
    const out: TaggedStateMachine[] = [];
    let nextToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListStateMachinesCommand({ nextToken }),
      );
      for (const sm of page.stateMachines ?? []) {
        const tagged = await this.tagsFor(sm);
        if (tagged) out.push(tagged);
      }
      nextToken = page.nextToken;
    } while (nextToken);
    return out;
  }

  private async tagsFor(sm: StateMachineListItem): Promise<TaggedStateMachine | undefined> {
    if (!sm.stateMachineArn || !sm.name) return undefined;
    const res = await this.client.send(
      new ListTagsForResourceCommand({ resourceArn: sm.stateMachineArn }),
    );
    const tags = new Map((res.tags ?? []).map(t => [t.key, t.value]));
    const definitionId = tags.get(DEFINITION_ID_TAG);
    if (!definitionId) return undefined; // opt-in: untagged state machines aren't Branchline-managed
    const version = Number(tags.get(VERSION_TAG) ?? '1') || 1;
    return { arn: sm.stateMachineArn, name: sm.name, definitionId, version };
  }

  private async resolveStateMachineArn(definitionId: string): Promise<string> {
    const machines = (await this.listTaggedStateMachines()).filter(
      m => m.definitionId === definitionId,
    );
    const latest = machines.sort((a, b) => b.version - a.version)[0];
    if (!latest) {
      throw new Error(`No Step Functions state machine tagged '${DEFINITION_ID_TAG}=${definitionId}' found`);
    }
    return latest.arn;
  }

  async listDefinitions(): Promise<OrchestratorDefinition[]> {
    const machines = await this.listTaggedStateMachines();
    return machines.map(m => ({ id: m.definitionId, name: m.name, version: m.version }));
  }

  async startInstance(opts: {
    definitionId: string;
    variables?: Record<string, unknown>;
  }): Promise<StartWorkflowResult> {
    const stateMachineArn = await this.resolveStateMachineArn(opts.definitionId);
    const res = await this.client.send(
      new StartExecutionCommand({
        stateMachineArn,
        input: JSON.stringify(opts.variables ?? {}),
      }),
    );
    if (!res.executionArn) {
      throw new Error('StartExecution did not return an executionArn');
    }
    return { orchestratorInstanceKey: res.executionArn };
  }

  async cancelInstance(orchestratorInstanceKey: string): Promise<void> {
    await this.client.send(new StopExecutionCommand({ executionArn: orchestratorInstanceKey }));
  }

  async completeTask(
    orchestratorInstanceKey: string,
    taskId: string,
    variables?: Record<string, unknown>,
  ): Promise<void> {
    const token = await this.tokenStore.get(orchestratorInstanceKey, taskId);
    if (!token) return; // not a waiting human task (or already completed) — matches Camunda's no-op behavior
    await this.client.send(
      new SendTaskSuccessCommand({ taskToken: token, output: JSON.stringify(variables ?? {}) }),
    );
    await this.tokenStore.remove(orchestratorInstanceKey, taskId);
  }

  async skipTask(orchestratorInstanceKey: string, taskId: string, reason: string): Promise<void> {
    await this.completeTask(orchestratorInstanceKey, taskId, {
      branchlineSkipped: true,
      branchlineSkipReason: reason,
    });
  }

  async getTaskCandidateGroups(
    definitionId: string,
    taskId: string,
  ): Promise<{ groups: string[]; unresolved?: boolean }> {
    return { groups: this.candidateGroups.resolve(definitionId, taskId), unresolved: false };
  }

  private async fetchDefinition(stateMachineArn: string): Promise<AslDefinition> {
    const res = await this.client.send(
      new DescribeStateMachineCommand({ stateMachineArn }),
    );
    if (!res.definition) {
      throw new Error(`DescribeStateMachine for '${stateMachineArn}' returned no definition`);
    }
    return parseAslDefinition(res.definition);
  }

  /** Derive a per-state-name status from the execution's history events.
   *  AWS emits a uniform `<X>StateEntered`/`<X>StateExited` pair (Task, Choice,
   *  Parallel, Pass, …) each carrying the state's `name` in its detail. */
  private statusFromHistory(events: HistoryEvent[]): Map<string, TaskStatus> {
    const status = new Map<string, TaskStatus>();
    for (const event of events) {
      const type = event.type ?? '';
      if (type.endsWith('StateEntered')) {
        const name = event.stateEnteredEventDetails?.name;
        if (name) status.set(name, 'active');
      } else if (type.endsWith('StateExited')) {
        const name = event.stateExitedEventDetails?.name;
        if (name) status.set(name, 'completed');
      }
    }
    return status;
  }

  private async fetchHistory(executionArn: string): Promise<HistoryEvent[]> {
    const events: HistoryEvent[] = [];
    let nextToken: string | undefined;
    do {
      const page = await this.client.send(
        new GetExecutionHistoryCommand({ executionArn, nextToken }),
      );
      events.push(...(page.events ?? []));
      nextToken = page.nextToken;
    } while (nextToken);
    return events;
  }

  async getFlownodeProgress(
    orchestratorInstanceKeys: string[],
  ): Promise<Map<string, { completedPhases: number; totalPhases: number }>> {
    const results = await Promise.all(
      orchestratorInstanceKeys.map(async executionArn => {
        try {
          const exec = await this.client.send(new DescribeExecutionCommand({ executionArn }));
          if (!exec.stateMachineArn) return { key: executionArn, completedPhases: 0, totalPhases: 0 };
          const [definition, history] = await Promise.all([
            this.fetchDefinition(exec.stateMachineArn),
            this.fetchHistory(executionArn),
          ]);
          const phaseNames = new Set(listPhaseNames(definition));
          const exitedNames = new Set(
            history
              .filter(e => (e.type ?? '').endsWith('StateExited'))
              .map(e => e.stateExitedEventDetails?.name)
              .filter((n): n is string => Boolean(n)),
          );
          const completedPhases = [...phaseNames].filter(n => exitedNames.has(n)).length;
          return { key: executionArn, completedPhases, totalPhases: phaseNames.size };
        } catch {
          return { key: executionArn, completedPhases: 0, totalPhases: 0 };
        }
      }),
    );
    return new Map(results.map(r => [r.key, { completedPhases: r.completedPhases, totalPhases: r.totalPhases }]));
  }

  // Legacy task-list hierarchy has no ASL equivalent (candidateGroups/formKey
  // are BPMN-taskHeader-sourced); Step Functions supports flowGraph only.
  async buildHierarchy(
    _definitionId: string,
    _orchestratorInstanceKey: string,
    _actions: TaskActionInput[],
  ): Promise<ParallelBlock[]> {
    return [];
  }

  async buildFlowGraph(
    _definitionId: string,
    orchestratorInstanceKey: string,
    actions: TaskActionInput[],
  ): Promise<FlowGraph> {
    const exec = await this.client.send(
      new DescribeExecutionCommand({ executionArn: orchestratorInstanceKey }),
    );
    if (!exec.stateMachineArn) {
      return { nodes: [], edges: [] };
    }
    const [definition, history] = await Promise.all([
      this.fetchDefinition(exec.stateMachineArn),
      this.fetchHistory(orchestratorInstanceKey),
    ]);
    const status = this.statusFromHistory(history);
    const actionRecords: AslActionRecord[] = actions.map(a => ({
      taskId: a.taskId,
      action: a.action,
      actor: a.actor,
      occurredAt: a.occurredAt,
      skipReason: a.skipReason,
    }));
    return aslToFlowGraph(definition, status, actionRecords);
  }
}
