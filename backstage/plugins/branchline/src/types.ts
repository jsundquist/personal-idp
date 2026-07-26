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
} from '@internal/backstage-plugin-branchline-common';
