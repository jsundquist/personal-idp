// Shared types — imported from the common package
export type {
  WorkflowStatus,
  TaskStatus,
  FlowNodeType,
  FlowNode,
  FlowEdge,
  FlowGraph,
  Task,
  Step,
  ParallelBlock,
  WorkflowInstance,
  WorkflowDefinition,
  StartWorkflowRequest,
  FeedbackStatus,
  FeedbackComment,
  FeedbackItem,
  FeedbackCounts,
  AuditEvent,
} from '@internal/backstage-plugin-branchline-common';

// AuditEventType is a runtime enum — re-export as a value, not a type.
export { AuditEventType } from '@internal/backstage-plugin-branchline-common';

// Backend-only types (not shared with the frontend)

export type { TaskAction } from '@internal/backstage-plugin-branchline-node';
import type { TaskAction } from '@internal/backstage-plugin-branchline-node';

export interface TaskActionRecord {
  id: string;
  instanceId: string;
  taskId: string;
  action: TaskAction;
  actor: string;
  skipReason?: string;
  occurredAt: string;
}
