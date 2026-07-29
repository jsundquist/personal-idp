import fs from 'fs';
import path from 'path';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DescribeExecutionCommand,
  DescribeStateMachineCommand,
  GetExecutionHistoryCommand,
  ListStateMachinesCommand,
  ListTagsForResourceCommand,
  SFNClient,
  SendTaskSuccessCommand,
  StartExecutionCommand,
  StopExecutionCommand,
} from '@aws-sdk/client-sfn';
import { ConfigReader } from '@backstage/config';
import { TestDatabases } from '@backstage/backend-test-utils';
import { StepFunctionsOrchestrator } from './StepFunctionsOrchestrator';
import { TaskTokenStore } from './TaskTokenStore';

jest.setTimeout(30_000);

const sfnMock = mockClient(SFNClient);

const STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:create-backend-api';

function taggedListStateMachinesResponse() {
  return {
    stateMachines: [
      {
        stateMachineArn: STATE_MACHINE_ARN,
        name: 'create-backend-api-v2',
        type: 'STANDARD' as const,
        creationDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
  };
}

function taggedTagsResponse(definitionId = 'create-backend-api', version = '2') {
  return {
    tags: [
      { key: 'branchline:definitionId', value: definitionId },
      { key: 'branchline:version', value: version },
    ],
  };
}

describe('StepFunctionsOrchestrator', () => {
  const databases = TestDatabases.create();

  beforeEach(() => {
    sfnMock.reset();
  });

  async function buildOrchestrator(configOverrides: Record<string, unknown> = {}) {
    const knex = await databases.init('SQLITE_3');
    const tokenStore = await TaskTokenStore.create(knex as any);
    const config = new ConfigReader({ branchline: { stepFunctions: {} }, ...configOverrides });
    return new StepFunctionsOrchestrator(config, tokenStore);
  }

  it('listDefinitions returns only tagged state machines', async () => {
    sfnMock.on(ListStateMachinesCommand).resolves(taggedListStateMachinesResponse());
    sfnMock.on(ListTagsForResourceCommand).resolves(taggedTagsResponse());

    const orchestrator = await buildOrchestrator();
    const defs = await orchestrator.listDefinitions();
    expect(defs).toEqual([
      { id: 'create-backend-api', name: 'create-backend-api-v2', version: 2 },
    ]);
  });

  it('listDefinitions skips untagged state machines', async () => {
    sfnMock.on(ListStateMachinesCommand).resolves(taggedListStateMachinesResponse());
    sfnMock.on(ListTagsForResourceCommand).resolves({ tags: [] });

    const orchestrator = await buildOrchestrator();
    expect(await orchestrator.listDefinitions()).toEqual([]);
  });

  it('startInstance resolves the tagged state machine ARN and starts an execution', async () => {
    sfnMock.on(ListStateMachinesCommand).resolves(taggedListStateMachinesResponse());
    sfnMock.on(ListTagsForResourceCommand).resolves(taggedTagsResponse());
    sfnMock
      .on(StartExecutionCommand)
      .resolves({ executionArn: 'arn:aws:states:us-east-1:123456789012:execution:x:1', startDate: new Date() });

    const orchestrator = await buildOrchestrator();
    const result = await orchestrator.startInstance({
      definitionId: 'create-backend-api',
      variables: { branchlineTitle: 'My workflow' },
    });
    expect(result).toEqual({
      orchestratorInstanceKey: 'arn:aws:states:us-east-1:123456789012:execution:x:1',
    });

    const call = sfnMock.commandCalls(StartExecutionCommand)[0];
    expect(call.args[0].input).toMatchObject({
      stateMachineArn: STATE_MACHINE_ARN,
      input: JSON.stringify({ branchlineTitle: 'My workflow' }),
    });
  });

  it('startInstance throws when no state machine is tagged for the definitionId', async () => {
    sfnMock.on(ListStateMachinesCommand).resolves({ stateMachines: [] });

    const orchestrator = await buildOrchestrator();
    await expect(
      orchestrator.startInstance({ definitionId: 'does-not-exist' }),
    ).rejects.toThrow(/No Step Functions state machine tagged/);
  });

  it('cancelInstance calls StopExecution', async () => {
    sfnMock.on(StopExecutionCommand).resolves({});
    const orchestrator = await buildOrchestrator();
    await orchestrator.cancelInstance('exec-1');
    expect(sfnMock.commandCalls(StopExecutionCommand)[0].args[0].input).toEqual({
      executionArn: 'exec-1',
    });
  });

  it('completeTask is a no-op when no task token is outstanding', async () => {
    const orchestrator = await buildOrchestrator();
    await orchestrator.completeTask('exec-1', 'Some Task', {});
    expect(sfnMock.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  });

  it('completeTask sends the stored token and removes it (single-use)', async () => {
    const knex = await databases.init('SQLITE_3');
    const tokenStore = await TaskTokenStore.create(knex as any);
    await tokenStore.save('exec-1', 'Await SonarCloud Cleared', 'token-abc');
    sfnMock.on(SendTaskSuccessCommand).resolves({});

    const orchestrator = new StepFunctionsOrchestrator(
      new ConfigReader({ branchline: { stepFunctions: {} } }),
      tokenStore,
    );
    await orchestrator.completeTask('exec-1', 'Await SonarCloud Cleared', { foo: 'bar' });

    expect(sfnMock.commandCalls(SendTaskSuccessCommand)[0].args[0].input).toEqual({
      taskToken: 'token-abc',
      output: JSON.stringify({ foo: 'bar' }),
    });
    await expect(tokenStore.get('exec-1', 'Await SonarCloud Cleared')).resolves.toBeUndefined();
  });

  it('skipTask sends the token with a skip flag in the output', async () => {
    const knex = await databases.init('SQLITE_3');
    const tokenStore = await TaskTokenStore.create(knex as any);
    await tokenStore.save('exec-1', 'Await SonarCloud Cleared', 'token-abc');
    sfnMock.on(SendTaskSuccessCommand).resolves({});

    const orchestrator = new StepFunctionsOrchestrator(
      new ConfigReader({ branchline: { stepFunctions: {} } }),
      tokenStore,
    );
    await orchestrator.skipTask('exec-1', 'Await SonarCloud Cleared', 'not applicable');

    const output = JSON.parse(sfnMock.commandCalls(SendTaskSuccessCommand)[0].args[0].input.output as string);
    expect(output).toEqual({ branchlineSkipped: true, branchlineSkipReason: 'not applicable' });
  });

  it('getTaskCandidateGroups delegates to app-config-driven resolution', async () => {
    const orchestrator = await buildOrchestrator({
      branchline: {
        stepFunctions: {
          candidateGroups: [
            { definitionId: 'create-backend-api', taskId: 'Request Architecture Review', groups: ['architects'] },
          ],
        },
      },
    });
    expect(
      await orchestrator.getTaskCandidateGroups('create-backend-api', 'Request Architecture Review'),
    ).toEqual({ groups: ['architects'], unresolved: false });
    expect(await orchestrator.getTaskCandidateGroups('create-backend-api', 'Untracked Task')).toEqual({
      groups: [],
      unresolved: false,
    });
  });

  it('buildHierarchy returns [] (no ASL equivalent of the legacy hierarchy)', async () => {
    const orchestrator = await buildOrchestrator();
    expect(await orchestrator.buildHierarchy('create-backend-api', 'exec-1', [])).toEqual([]);
  });

  it('buildFlowGraph fetches the definition + history and adapts it into a FlowGraph', async () => {
    const definition = fs.readFileSync(
      path.join(__dirname, '__fixtures__', 'create-backend-service-simple-aws.json'),
      'utf8',
    );
    sfnMock.on(DescribeExecutionCommand).resolves({ stateMachineArn: STATE_MACHINE_ARN });
    sfnMock.on(DescribeStateMachineCommand).resolves({ definition });
    sfnMock.on(GetExecutionHistoryCommand).resolves({
      events: [
        {
          type: 'TaskStateEntered',
          id: 1,
          previousEventId: 0,
          timestamp: new Date('2026-01-01T00:00:00.000Z'),
          stateEnteredEventDetails: { name: 'Build Application' },
        },
      ],
    });

    const orchestrator = await buildOrchestrator();
    const graph = await orchestrator.buildFlowGraph('create-backend-service-simple', 'exec-1', []);

    expect(graph.nodes.find(n => n.id === 'Build Application')).toMatchObject({ status: 'active' });
    expect(graph.nodes.some(n => n.type === 'phase')).toBe(true);
  });

  it('getFlownodeProgress counts phases that have exited in history', async () => {
    const definition = fs.readFileSync(
      path.join(__dirname, '__fixtures__', 'create-backend-service-simple-aws.json'),
      'utf8',
    );
    sfnMock.on(DescribeExecutionCommand).resolves({ stateMachineArn: STATE_MACHINE_ARN });
    sfnMock.on(DescribeStateMachineCommand).resolves({ definition });
    sfnMock.on(GetExecutionHistoryCommand).resolves({
      events: [
        {
          type: 'ParallelStateExited',
          id: 1,
          previousEventId: 0,
          timestamp: new Date('2026-01-01T00:00:00.000Z'),
          stateExitedEventDetails: { name: 'Phase 1: Initialize Reviews' },
        },
      ],
    });

    const orchestrator = await buildOrchestrator();
    const progress = await orchestrator.getFlownodeProgress(['exec-1']);
    expect(progress.get('exec-1')).toEqual({ completedPhases: 1, totalPhases: 3 });
  });
});
