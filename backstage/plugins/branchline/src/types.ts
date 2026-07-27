// All shared types live in branchline-common. Re-export everything from there
// so existing imports within this plugin continue to work unchanged.
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
