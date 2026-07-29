import { Config } from '@backstage/config';
import {
  CamundaProcessDefinition,
  CamundaElementInstance,
  CamundaSearchResponse,
  StartProcessInstanceRequest,
  StartProcessInstanceResponse,
} from './types';
import { FlowGraph, ParallelBlock } from '@internal/backstage-plugin-branchline-common';
import { parseBpmnXml, buildHierarchyFromBpmn } from './BpmnParser';
import { bpmnToFlowGraph } from './BpmnAdapter';
import type {
  OrchestratorDefinition,
  StartWorkflowResult,
  TaskActionInput,
  WorkflowOrchestrator,
} from '@internal/backstage-plugin-branchline-node';

interface TokenCache {
  token: string;
  expiresAt: number;
}

interface SessionCache {
  cookie: string;
  csrfToken: string;
  // Sessions don't advertise expiry; we refresh after 30 minutes
  expiresAt: number;
}

export class CamundaClient implements WorkflowOrchestrator {
  private readonly operateBaseUrl: string;
  private readonly zeebeBaseUrl: string;
  private readonly tasklistBaseUrl: string;
  // OAuth2 mode
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly tokenUrl: string | undefined;
  // Cookie auth mode
  private readonly username: string | undefined;
  private readonly password: string | undefined;

  private tokenCache: TokenCache | null = null;
  private sessionCache: SessionCache | null = null;
  private tasklistSessionCache: SessionCache | null = null;
  private bpmnCache = new Map<string, ReturnType<typeof parseBpmnXml>>(); // keyed by definition key, not bpmnProcessId

  constructor(config: Config) {
    const camundaConfig = config.getConfig('branchline.camunda');
    this.operateBaseUrl = camundaConfig.getString('operateBaseUrl').replace(/\/$/, '');
    this.zeebeBaseUrl = camundaConfig.getString('zeebeBaseUrl').replace(/\/$/, '');
    this.tasklistBaseUrl = camundaConfig.getString('tasklistBaseUrl').replace(/\/$/, '');
    this.clientId = camundaConfig.getOptionalString('clientId');
    this.clientSecret = camundaConfig.getOptionalString('clientSecret');
    this.tokenUrl = camundaConfig.getOptionalString('tokenUrl');
    this.username = camundaConfig.getOptionalString('username');
    this.password = camundaConfig.getOptionalString('password');
  }

  private get usesCookieAuth(): boolean {
    return Boolean(this.username && this.password);
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }

    if (!this.tokenUrl || !this.clientId || !this.clientSecret) {
      throw new Error('Camunda OAuth2 config (tokenUrl, clientId, clientSecret) is required when not using username/password auth');
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      throw new Error(`Camunda OAuth2 token fetch failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: data.access_token,
      // Subtract 30s buffer from expiry
      expiresAt: Date.now() + (data.expires_in - 30) * 1000,
    };
    return this.tokenCache.token;
  }

  private async getSession(): Promise<SessionCache> {
    if (this.sessionCache && Date.now() < this.sessionCache.expiresAt) {
      return this.sessionCache;
    }

    const res = await fetch(`${this.operateBaseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: this.username!, password: this.password! }).toString(),
      redirect: 'manual',
    });

    if (res.status !== 204 && res.status !== 200 && res.status !== 302) {
      throw new Error(`Camunda Operate login failed: ${res.status} ${res.statusText}`);
    }

    // getSetCookie() returns all Set-Cookie headers as an array (Node 18+ / undici)
    const allCookies = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie?.() ?? [];
    if (allCookies.length === 0) {
      throw new Error('Camunda Operate login did not return a session cookie');
    }

    // Join all cookie name=value pairs (strip directives after first semicolon)
    const cookie = allCookies.map(c => c.split(';')[0].trim()).join('; ');
    // The response header value is what Camunda expects back as X-CSRF-TOKEN on requests
    const csrfToken = res.headers.get('X-CSRF-TOKEN') ?? '';

    this.sessionCache = {
      cookie,
      csrfToken,
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
    };
    return this.sessionCache;
  }

  private async operateAuthHeaders(): Promise<Record<string, string>> {
    if (this.usesCookieAuth) {
      const session = await this.getSession();
      return { Cookie: session.cookie, 'X-CSRF-TOKEN': session.csrfToken };
    }
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  private async operatePost<T>(path: string, body: unknown): Promise<T> {
    const auth = await this.operateAuthHeaders();
    const res = await fetch(`${this.operateBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) {
      this.sessionCache = null;
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Camunda Operate POST ${path} failed: ${res.status} ${res.statusText} — ${errBody}`);
    }
    return res.json() as Promise<T>;
  }

  private async zeebePost<T>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.usesCookieAuth) {
      // Zeebe REST API uses HTTP Basic auth in self-managed cookie-auth mode
      const encoded = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers.Authorization = `Basic ${encoded}`;
    } else {
      headers.Authorization = `Bearer ${await this.getToken()}`;
    }
    const res = await fetch(`${this.zeebeBaseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Camunda Zeebe POST ${path} failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  private async listRawDefinitions(): Promise<CamundaProcessDefinition[]> {
    const result = await this.operatePost<CamundaSearchResponse<CamundaProcessDefinition>>(
      '/v1/process-definitions/search',
      { size: 100 },
    );
    return result.items;
  }

  async listDefinitions(): Promise<OrchestratorDefinition[]> {
    const defs = await this.listRawDefinitions();
    return defs.map(d => ({ id: d.bpmnProcessId, name: d.name, version: d.version }));
  }

  async startInstance(opts: {
    definitionId: string;
    variables?: Record<string, unknown>;
  }): Promise<StartWorkflowResult> {
    const req: StartProcessInstanceRequest = {
      processDefinitionId: opts.definitionId,
      variables: opts.variables,
    };
    const res = await this.zeebePost<StartProcessInstanceResponse>('/v2/process-instances', req);
    return { orchestratorInstanceKey: res.processInstanceKey };
  }

  async getElementInstances(
    processInstanceKey: string,
  ): Promise<CamundaElementInstance[]> {
    const result = await this.operatePost<CamundaSearchResponse<CamundaElementInstance>>(
      '/v1/flownode-instances/search',
      {
        filter: { processInstanceKey: parseInt(processInstanceKey, 10) },
        size: 500,
      },
    );
    return result.items;
  }

  async getFlownodeProgress(
    camundaKeys: string[],
  ): Promise<Map<string, { completedPhases: number; totalPhases: number }>> {
    if (camundaKeys.length === 0) return new Map();

    const results = await Promise.all(
      camundaKeys.map(async key => {
        try {
          const instances = await this.getElementInstances(key);
          const phases = instances.filter(i => i.type === 'SUB_PROCESS');
          return {
            key,
            completedPhases: phases.filter(p => p.state === 'COMPLETED').length,
            totalPhases: phases.length,
          };
        } catch {
          return { key, completedPhases: 0, totalPhases: 0 };
        }
      }),
    );

    return new Map(results.map(r => [r.key, { completedPhases: r.completedPhases, totalPhases: r.totalPhases }]));
  }

  async cancelInstance(processInstanceKey: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.usesCookieAuth) {
      const encoded = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers.Authorization = `Basic ${encoded}`;
    } else {
      headers.Authorization = `Bearer ${await this.getToken()}`;
    }
    const res = await fetch(`${this.zeebeBaseUrl}/v2/process-instances/${processInstanceKey}/cancellation`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Camunda cancel process instance failed: ${res.status} ${res.statusText}`);
    }
  }

  async completeJob(jobKey: string, variables?: Record<string, unknown>): Promise<void> {
    await this.zeebePost(`/v2/jobs/${jobKey}/complete`, { variables: variables ?? {} });
  }

  /**
   * Resolve the active element instance for `taskId` and complete it via
   * whichever Camunda API applies: bpmn:userTask elements in Camunda 8.6+ are
   * Camunda user tasks (no jobKey); older job-worker-style tasks carry a jobKey.
   * A no-op if the task isn't found active (matches prior router behavior).
   */
  async completeTask(
    processInstanceKey: string,
    taskId: string,
    variables?: Record<string, unknown>,
  ): Promise<void> {
    const elements = await this.getElementInstances(processInstanceKey);
    const el = elements.find(e => e.flowNodeId === taskId && e.state === 'ACTIVE');
    if (!el) {
      return;
    }
    if (el.jobKey) {
      await this.completeJob(el.jobKey, variables);
    } else {
      await this.completeUserTask(processInstanceKey, taskId, variables);
    }
  }

  async skipTask(processInstanceKey: string, taskId: string, reason: string): Promise<void> {
    await this.completeTask(processInstanceKey, taskId, {
      branchlineSkipped: true,
      branchlineSkipReason: reason,
    });
  }

  private async getTasklistSession(): Promise<SessionCache> {
    if (this.tasklistSessionCache && Date.now() < this.tasklistSessionCache.expiresAt) {
      return this.tasklistSessionCache;
    }
    const res = await fetch(`${this.tasklistBaseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: this.username!, password: this.password! }).toString(),
      redirect: 'manual',
    });
    if (res.status !== 204 && res.status !== 200 && res.status !== 302) {
      throw new Error(`Camunda Tasklist login failed: ${res.status} ${res.statusText}`);
    }
    const allCookies = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie?.() ?? [];
    if (allCookies.length === 0) {
      throw new Error('Camunda Tasklist login did not return a session cookie');
    }
    const cookie = allCookies.map(c => c.split(';')[0].trim()).join('; ');
    const csrfToken = res.headers.get('X-CSRF-TOKEN') ?? '';
    this.tasklistSessionCache = { cookie, csrfToken, expiresAt: Date.now() + 30 * 60 * 1000 };
    return this.tasklistSessionCache;
  }

  private async tasklistAuthHeaders(): Promise<Record<string, string>> {
    if (this.usesCookieAuth) {
      const session = await this.getTasklistSession();
      return { Cookie: session.cookie, 'X-CSRF-TOKEN': session.csrfToken };
    }
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  private async tasklistPost<T>(path: string, body: unknown): Promise<T> {
    const auth = await this.tasklistAuthHeaders();
    const res = await fetch(`${this.tasklistBaseUrl}${path}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Camunda Tasklist POST ${path} failed: ${res.status} ${res.statusText} — ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async tasklistPatch<T>(path: string, body: unknown): Promise<T> {
    const auth = await this.tasklistAuthHeaders();
    const res = await fetch(`${this.tasklistBaseUrl}${path}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Camunda Tasklist PATCH ${path} failed: ${res.status} ${res.statusText} — ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async completeUserTask(processInstanceKey: string, flowNodeId: string, variables?: Record<string, unknown>): Promise<void> {
    // Tasklist does not filter by elementId directly; search by instance and match on taskDefinitionId.
    const results = await this.tasklistPost<Array<{ id: string; taskDefinitionId: string }>>(
      '/v1/tasks/search',
      { processInstanceKey, state: 'CREATED', pageSize: 50 },
    );
    const task = results.find(t => t.taskDefinitionId === flowNodeId);
    if (!task) {
      throw new Error(`No active user task found for flowNodeId '${flowNodeId}' in instance '${processInstanceKey}'`);
    }
    // Tasklist requires the task to be assigned before it can be completed.
    await this.tasklistPatch(`/v1/tasks/${task.id}/assign`, {
      assignee: this.username ?? 'demo',
      allowOverrideAssignment: true,
    });
    const vars = variables
      ? Object.entries(variables).map(([name, value]) => ({ name, value }))
      : [];
    await this.tasklistPatch(`/v1/tasks/${task.id}/complete`, { variables: vars });
  }

  private async getDefinitionKey(bpmnProcessId: string): Promise<string> {
    const result = await this.operatePost<CamundaSearchResponse<CamundaProcessDefinition>>(
      '/v1/process-definitions/search',
      { filter: { bpmnProcessId }, size: 1, sort: [{ field: 'version', order: 'DESC' }] },
    );
    const def = result.items[0];
    if (!def) throw new Error(`No process definition found for bpmnProcessId '${bpmnProcessId}'`);
    return String(def.key);
  }

  /**
   * Resolve the candidateGroups declared on a single task in a definition's BPMN.
   * Returns [] when the task is ungrouped (self-serve) or not found.
   */
  async getTaskCandidateGroups(bpmnProcessId: string, taskId: string): Promise<string[]> {
    const phases = await this.getBpmnNodes(bpmnProcessId);
    for (const phase of phases) {
      for (const step of phase.stepSpecs) {
        for (const ref of step.taskRefs) {
          if (ref.id === taskId) {
            return ref.candidateGroups ?? [];
          }
        }
      }
    }
    return [];
  }

  private async getBpmnNodes(bpmnProcessId: string): Promise<ReturnType<typeof parseBpmnXml>> {
    const key = await this.getDefinitionKey(bpmnProcessId);
    if (this.bpmnCache.has(key)) {
      return this.bpmnCache.get(key)!;
    }
    const auth = await this.operateAuthHeaders();
    const res = await fetch(`${this.operateBaseUrl}/v1/process-definitions/${key}/xml`, {
      headers: auth,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch BPMN XML for ${bpmnProcessId}: ${res.status}`);
    }
    const xml = await res.text();
    const nodes = parseBpmnXml(xml);
    this.bpmnCache.set(key, nodes);
    return nodes;
  }

  async buildHierarchy(
    bpmnProcessId: string,
    processInstanceKey: string,
    actions: TaskActionInput[],
  ): Promise<ParallelBlock[]> {
    const [bpmnNodes, instances] = await Promise.all([
      this.getBpmnNodes(bpmnProcessId),
      this.getElementInstances(processInstanceKey),
    ]);
    return buildHierarchyFromBpmn(bpmnNodes, instances, actions);
  }

  async buildFlowGraph(
    bpmnProcessId: string,
    processInstanceKey: string,
    actions: TaskActionInput[],
  ): Promise<FlowGraph> {
    const key = await this.getDefinitionKey(bpmnProcessId);
    const auth = await this.operateAuthHeaders();
    const [xmlRes, instances] = await Promise.all([
      fetch(`${this.operateBaseUrl}/v1/process-definitions/${key}/xml`, { headers: auth }),
      this.getElementInstances(processInstanceKey),
    ]);
    if (!xmlRes.ok) {
      throw new Error(`Failed to fetch BPMN XML for ${bpmnProcessId}: ${xmlRes.status}`);
    }
    const xml = await xmlRes.text();
    return bpmnToFlowGraph(xml, instances, actions);
  }
}
