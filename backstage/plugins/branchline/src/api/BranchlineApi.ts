import { createApiRef } from '@backstage/frontend-plugin-api';
import type {
  WorkflowDefinition,
  WorkflowInstance,
  StartWorkflowRequest,
  FeedbackItem,
  FeedbackComment,
  FeedbackCounts,
} from '../types';

export interface TaskFeedback {
  items: FeedbackItem[];
  counts: FeedbackCounts;
}

export interface BranchlineApi {
  getWorkflowDefinitions(): Promise<WorkflowDefinition[]>;
  listWorkflowInstances(opts?: { entityRef?: string }): Promise<WorkflowInstance[]>;
  listMyWorkflowInstances(): Promise<WorkflowInstance[]>;
  getWorkflowInstance(instanceId: string): Promise<WorkflowInstance>;
  startWorkflow(req: StartWorkflowRequest): Promise<WorkflowInstance>;
  completeTask(instanceId: string, taskId: string): Promise<void>;
  skipTask(instanceId: string, taskId: string, reason: string): Promise<void>;
  cancelWorkflow(instanceId: string): Promise<void>;
  listTaskFeedback(instanceId: string, taskId: string): Promise<TaskFeedback>;
  addFeedback(instanceId: string, taskId: string, body: string): Promise<FeedbackItem>;
  addFeedbackComment(
    instanceId: string,
    feedbackId: string,
    body: string,
  ): Promise<FeedbackComment>;
  closeFeedback(
    instanceId: string,
    feedbackId: string,
    status: 'resolved' | 'exception',
    exceptionReason?: string,
  ): Promise<FeedbackItem>;
}

export const branchlineApiRef = createApiRef<BranchlineApi>({
  id: 'plugin.branchline.service',
});
