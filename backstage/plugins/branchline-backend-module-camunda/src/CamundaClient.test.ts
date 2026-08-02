import { ConfigReader } from '@backstage/config';
import { CamundaClient } from './CamundaClient';

function buildClient(): CamundaClient {
  return new CamundaClient(
    new ConfigReader({
      branchline: {
        camunda: {
          operateBaseUrl: 'https://operate.example',
          zeebeBaseUrl: 'https://zeebe.example',
          tasklistBaseUrl: 'https://tasklist.example',
          username: 'demo',
          password: 'demo',
        },
      },
    }),
  );
}

function loginResponse() {
  return {
    status: 200,
    ok: true,
    headers: {
      get: (name: string) => (name === 'X-CSRF-TOKEN' ? 'csrf-token' : null),
      getSetCookie: () => ['OPERATE-SESSION=abc; Path=/'],
    },
  };
}

const bpmnWithThreePhases = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="p" isExecutable="true">
    <bpmn:subProcess id="phase-1" name="Phase 1"></bpmn:subProcess>
    <bpmn:subProcess id="phase-2" name="Phase 2"></bpmn:subProcess>
    <bpmn:subProcess id="phase-3" name="Phase 3"></bpmn:subProcess>
  </bpmn:process>
</bpmn:definitions>`;

describe('CamundaClient.getFlownodeProgress', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('reports the static BPMN phase count as totalPhases, not the live SUB_PROCESS instance count', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/login')) {
        return loginResponse();
      }
      if (url.endsWith('/v1/flownode-instances/search')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                key: '1',
                processInstanceKey: '2251799813685285',
                processDefinitionKey: '2251799813680001',
                flowNodeId: 'phase-1',
                type: 'SUB_PROCESS',
                state: 'COMPLETED',
              },
            ],
          }),
        };
      }
      if (url.includes('/process-definitions/2251799813680001/xml')) {
        return { ok: true, text: async () => bpmnWithThreePhases };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const progress = await buildClient().getFlownodeProgress(['2251799813685285']);

    // Only 1 SUB_PROCESS element instance exists so far (execution just
    // started), but the BPMN statically declares 3 phases — totalPhases
    // should reflect the static count, not the live one.
    expect(progress.get('2251799813685285')).toEqual({ completedPhases: 1, totalPhases: 3 });
  });

  it('falls back to the live phase count when no element instance has a definition key yet', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/flownode-instances/search')) {
        return { ok: true, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const progress = await buildClient().getFlownodeProgress(['2251799813685285']);
    expect(progress.get('2251799813685285')).toEqual({ completedPhases: 0, totalPhases: 0 });
  });
});

describe('CamundaClient BPMN XML cache reuse', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('fetches the BPMN XML once for a buildHierarchy + buildFlowGraph pair on the same process', async () => {
    let xmlFetchCount = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/login')) {
        return loginResponse();
      }
      if (url.endsWith('/v1/process-definitions/search')) {
        return {
          ok: true,
          json: async () => ({
            items: [{ key: '2251799813680001', name: 'create-backend-api', version: 1, bpmnProcessId: 'create-backend-api' }],
          }),
        };
      }
      if (url.includes('/process-definitions/2251799813680001/xml')) {
        xmlFetchCount += 1;
        return { ok: true, text: async () => bpmnWithThreePhases };
      }
      if (url.endsWith('/v1/flownode-instances/search')) {
        return { ok: true, json: async () => ({ items: [] }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const client = buildClient();
    await client.buildHierarchy('create-backend-api', '2251799813685285', []);
    await client.buildFlowGraph('create-backend-api', '2251799813685285', []);

    expect(xmlFetchCount).toBe(1);
  });
});

describe('CamundaClient tasklist session invalidation', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('re-logs in after a 401/403 from a tasklist POST, instead of reusing the stale session', async () => {
    let tasklistLoginCount = 0;
    let searchCallCount = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/login')) {
        tasklistLoginCount += 1;
        return loginResponse();
      }
      if (url.endsWith('/v1/tasks/search')) {
        searchCallCount += 1;
        if (searchCallCount === 1) {
          return { status: 401, ok: false, text: async () => 'unauthorized' };
        }
        return { ok: true, json: async () => [] };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const client = buildClient();
    await expect(client.completeUserTask('pi-1', 'some-task')).rejects.toThrow();
    await expect(client.completeUserTask('pi-1', 'some-task')).rejects.toThrow(
      /No active user task found/,
    );

    // The 401 must have invalidated the cached tasklist session, forcing a
    // fresh login on the second call rather than reusing the stale cookie.
    expect(tasklistLoginCount).toBe(2);
  });
});
