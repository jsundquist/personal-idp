import { createApiRef } from '@backstage/frontend-plugin-api';
import type {
  WorkflowDefinition,
  WorkflowInstance,
  StartWorkflowRequest,
} from '../types';

export interface BranchlineApi {
  getWorkflowDefinitions(): Promise<WorkflowDefinition[]>;
  listWorkflowInstances(opts?: { entityRef?: string }): Promise<WorkflowInstance[]>;
  listMyWorkflowInstances(): Promise<WorkflowInstance[]>;
  getWorkflowInstance(instanceId: string): Promise<WorkflowInstance>;
  startWorkflow(req: StartWorkflowRequest): Promise<WorkflowInstance>;
  completeTask(instanceId: string, taskId: string): Promise<void>;
  skipTask(instanceId: string, taskId: string, reason: string): Promise<void>;
  cancelWorkflow(instanceId: string): Promise<void>;
}

export const branchlineApiRef = createApiRef<BranchlineApi>({
  id: 'plugin.branchline.service',
});
