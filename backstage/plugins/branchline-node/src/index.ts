/**
 * Backend-only orchestrator SPI for the branchline plugin.
 *
 * Any workflow engine (Camunda, AWS Step Functions, …) is adapted into this
 * interface so branchline-backend never depends on a specific orchestrator.
 * A concrete orchestrator ships as its own backend module (e.g.
 * branchline-backend-module-camunda) and registers itself against
 * workflowOrchestratorExtensionPoint.
 */
import { createExtensionPoint } from '@backstage/backend-plugin-api';
import type { FlowGraph, ParallelBlock } from '@internal/backstage-plugin-branchline-common';

export type TaskAction = 'completed' | 'skipped';

export interface TaskActionInput {
  taskId: string;
  action: TaskAction;
  actor: string;
  skipReason?: string;
  occurredAt: string;
}

export interface OrchestratorDefinition {
  /** Orchestrator-agnostic definition id (Camunda: bpmnProcessId; Step Functions: a tagged logical id) */
  id: string;
  name: string;
  version: number;
}

export interface StartWorkflowResult {
  /** Orchestrator-agnostic instance handle (Camunda: processInstanceKey; Step Functions: executionArn) */
  orchestratorInstanceKey: string;
}

export interface WorkflowOrchestrator {
  listDefinitions(): Promise<OrchestratorDefinition[]>;

  startInstance(opts: {
    definitionId: string;
    variables?: Record<string, unknown>;
  }): Promise<StartWorkflowResult>;

  cancelInstance(orchestratorInstanceKey: string): Promise<void>;

  /** Complete the named task on the given instance. Orchestrator-specific completion
   *  mechanics (e.g. Camunda's job-vs-user-task split, Step Functions' task tokens)
   *  are hidden behind this single method. */
  completeTask(
    orchestratorInstanceKey: string,
    taskId: string,
    variables?: Record<string, unknown>,
  ): Promise<void>;

  /** Skip the named task, recording `reason`. Each implementation encodes "this was
   *  a skip, not a normal completion" using whatever convention fits its engine
   *  (Camunda: completion variables; Step Functions: a flag in the SendTaskSuccess output). */
  skipTask(orchestratorInstanceKey: string, taskId: string, reason: string): Promise<void>;

  /** Resolve the groups allowed to act on a task. Empty `groups` means self-serve
   *  (no restriction). `unresolved: true` means the engine will resolve candidate
   *  groups dynamically at runtime (e.g. a BPMN FEEL expression) and this SPI
   *  cannot verify membership — callers must treat this as deny-by-default,
   *  not as self-serve. */
  getTaskCandidateGroups(
    definitionId: string,
    taskId: string,
  ): Promise<{ groups: string[]; unresolved?: boolean }>;

  getFlownodeProgress(
    orchestratorInstanceKeys: string[],
  ): Promise<Map<string, { completedPhases: number; totalPhases: number }>>;

  /** Legacy task-list hierarchy. Orchestrators without an equivalent structure
   *  (e.g. Step Functions) may return []. */
  buildHierarchy(
    definitionId: string,
    orchestratorInstanceKey: string,
    actions: TaskActionInput[],
  ): Promise<ParallelBlock[]>;

  /** The orchestrator-agnostic graph consumed by the frontend renderer. Every
   *  implementation must support this. */
  buildFlowGraph(
    definitionId: string,
    orchestratorInstanceKey: string,
    actions: TaskActionInput[],
  ): Promise<FlowGraph>;
}

export interface WorkflowOrchestratorExtensionPoint {
  /** Register the single active orchestrator implementation. Throws if an
   *  orchestrator has already been registered — only one orchestrator module
   *  may be installed at a time. */
  setOrchestrator(orchestrator: WorkflowOrchestrator): void;
}

export const workflowOrchestratorExtensionPoint =
  createExtensionPoint<WorkflowOrchestratorExtensionPoint>({
    id: 'branchline.orchestrator',
  });
