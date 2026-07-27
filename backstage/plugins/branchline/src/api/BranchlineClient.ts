import {
  DiscoveryApi,
  FetchApi,
} from '@backstage/core-plugin-api';
import type { BranchlineApi, TaskFeedback } from './BranchlineApi';
import type {
  WorkflowDefinition,
  WorkflowInstance,
  StartWorkflowRequest,
  FeedbackItem,
  FeedbackComment,
} from '../types';

export class BranchlineClient implements BranchlineApi {
  constructor(
    private readonly discoveryApi: DiscoveryApi,
    private readonly fetchApi: FetchApi,
  ) {}

  private async baseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl('branchline');
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${await this.baseUrl()}${path}`;
    const res = await this.fetchApi.fetch(url, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Branchline API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async getWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
    return this.fetch<WorkflowDefinition[]>('/definitions');
  }

  async listWorkflowInstances(opts?: { entityRef?: string }): Promise<WorkflowInstance[]> {
    const qs = opts?.entityRef ? `?entityRef=${encodeURIComponent(opts.entityRef)}` : '';
    return this.fetch<WorkflowInstance[]>(`/workflows${qs}`);
  }

  async listMyWorkflowInstances(): Promise<WorkflowInstance[]> {
    return this.fetch<WorkflowInstance[]>('/workflows/mine');
  }

  async getWorkflowInstance(instanceId: string): Promise<WorkflowInstance> {
    return this.fetch<WorkflowInstance>(`/workflows/${instanceId}`);
  }

  async startWorkflow(req: StartWorkflowRequest): Promise<WorkflowInstance> {
    return this.fetch<WorkflowInstance>('/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  }

  async completeTask(instanceId: string, taskId: string): Promise<void> {
    await this.fetch(`/workflows/${instanceId}/tasks/${taskId}/complete`, {
      method: 'POST',
    });
  }

  async skipTask(instanceId: string, taskId: string, reason: string): Promise<void> {
    await this.fetch(`/workflows/${instanceId}/tasks/${taskId}/skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
  }

  async cancelWorkflow(instanceId: string): Promise<void> {
    await this.fetch(`/workflows/${instanceId}/cancel`, { method: 'POST' });
  }

  async listTaskFeedback(instanceId: string, taskId: string): Promise<TaskFeedback> {
    return this.fetch<TaskFeedback>(
      `/workflows/${instanceId}/tasks/${taskId}/feedback`,
    );
  }

  async addFeedback(
    instanceId: string,
    taskId: string,
    body: string,
  ): Promise<FeedbackItem> {
    return this.fetch<FeedbackItem>(
      `/workflows/${instanceId}/tasks/${taskId}/feedback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
  }

  async addFeedbackComment(
    instanceId: string,
    feedbackId: string,
    body: string,
  ): Promise<FeedbackComment> {
    return this.fetch<FeedbackComment>(
      `/workflows/${instanceId}/feedback/${feedbackId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );
  }

  async closeFeedback(
    instanceId: string,
    feedbackId: string,
    status: 'resolved' | 'exception',
    exceptionReason?: string,
  ): Promise<FeedbackItem> {
    return this.fetch<FeedbackItem>(
      `/workflows/${instanceId}/feedback/${feedbackId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, exceptionReason }),
      },
    );
  }
}
