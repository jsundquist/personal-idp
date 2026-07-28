/**
 * Common types and utilities for the branchline plugin.
 * Shared between frontend and backend — no runtime dependencies.
 *
 * @packageDocumentation
 */

// ── Permissions ──────────────────────────────────────────────────────────────
export { branchlinePermissions, branchlineWorkflowActPermission, WORKFLOW_INSTANCE_RESOURCE_TYPE } from './permissions';

// ── Status enums ────────────────────────────────────────────────────────────

export type WorkflowStatus = 'active' | 'completed' | 'cancelled' | 'failed';
export type TaskStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'skipped'
  | 'not-taken'
  | 'failed'
  | 'caught-error'; // error caught by a catch/compensate handler (sfn.js CaughtError)

// ── Orchestrator-agnostic FlowGraph ─────────────────────────────────────────
// All orchestrators (Camunda BPMN, AWS Step Functions, GCP Workflows, …) are
// adapted into this graph before being sent to the UI. The renderer only ever
// sees FlowGraph — never orchestrator-specific constructs.

export type FlowNodeType =
  | 'task'           // a human / service task
  | 'choice'         // exclusive gateway / Choice state — one branch is taken
  | 'parallel-fork'  // parallel gateway (split) — all branches run
  | 'parallel-join'  // parallel gateway (join) — waits for all branches
  | 'phase';         // named container / sub-process grouping a set of nodes

export interface FlowNode {
  id: string;
  label: string;
  type: FlowNodeType;
  /** Execution status — undefined for structural nodes (phase, fork, join) */
  status?: TaskStatus;
  /** ID of the parent phase node, if this node lives inside a phase */
  parentId?: string;
  /** Markdown documentation from the BPMN <documentation> element */
  documentation?: string;
  // Task completion / skip metadata
  completedBy?: string;
  completedAt?: string;
  skippedBy?: string;
  skippedAt?: string;
  skipReason?: string;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** Displayed on choice branches, e.g. "Path A", "Default" */
  label?: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ── Legacy task-list types (used by WorkflowDetailPage during transition) ───
// These will eventually be derived from FlowGraph on the frontend.

export interface Task {
  id: string;
  label: string;
  status: TaskStatus;
  /** Markdown documentation from the BPMN <documentation> element */
  documentation?: string;
  completedBy?: string;
  completedAt?: string;
  skippedBy?: string;
  skippedAt?: string;
  skipReason?: string;
  /** Approval-gate feedback tallies for this task, if any has been logged */
  feedbackCounts?: FeedbackCounts;
  /** Responsible groups from the BPMN zeebe:assignmentDefinition candidateGroups (short names) */
  candidateGroups?: string[];
  /**
   * Whether the requesting user may act on this task — true when the task has no
   * candidateGroups (self-serve) or the user is a member of one. Computed per request.
   */
  canAct?: boolean;
}

export interface Step {
  id: string;
  label: string;
  parallelTasks: boolean;
  branchType?: 'exclusive' | 'parallel';
  tasks: Task[];
}

export interface ParallelBlock {
  id: string;
  label: string;
  steps: Step[];
}

// ── API contract types ───────────────────────────────────────────────────────

export interface WorkflowInstance {
  id: string;
  camundaKey: string;
  definitionId: string;
  title: string;
  description?: string;
  owningGroup: string;
  entityRef?: string;
  status: WorkflowStatus;
  /** Entity ref of the user who started the workflow (captured at start) */
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  completedPhases?: number;
  totalPhases?: number;
  /** Legacy task-list hierarchy — kept while WorkflowDetailPage migrates */
  parallelBlocks?: ParallelBlock[];
  /** Orchestrator-agnostic graph for the flow visualisation */
  flowGraph?: FlowGraph;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  bpmnProcessId: string;
}

export interface StartWorkflowRequest {
  definitionId: string;
  title: string;
  description?: string;
  owningGroup: string;
  entityRef?: string;
}

// ── Approval-gate feedback ───────────────────────────────────────────────────
// A code-review-style feedback layer on any human gate. Branchline application
// state keyed by (instanceId, taskId) — NOT a Camunda/BPMN concern.

export type FeedbackStatus = 'open' | 'resolved' | 'exception';

export interface FeedbackComment {
  id: string;
  feedbackId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface FeedbackItem {
  id: string;
  instanceId: string;
  taskId: string;
  /** The group that logged the feedback (the owning approval team) */
  authorGroup: string;
  author: string;
  body: string;
  status: FeedbackStatus;
  /** Set on either close (resolve OR exception); `status` says which */
  closedBy?: string;
  closedAt?: string;
  /** Required only when status === 'exception' */
  exceptionReason?: string;
  comments: FeedbackComment[];
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackCounts {
  open: number;
  total: number;
}

// ── Audit trail ──────────────────────────────────────────────────────────────
// A time-sorted timeline of a workflow's milestones, assembled from
// workflow_instances, task_actions, and feedback_items. Milestones only —
// individual feedback comments are NOT audit events.

export enum AuditEventType {
  WorkflowStarted = 'workflow-started',
  WorkflowCompleted = 'workflow-completed',
  WorkflowCancelled = 'workflow-cancelled',
  TaskCompleted = 'task-completed',
  TaskSkipped = 'task-skipped',
  FeedbackCreated = 'feedback-created',
  FeedbackResolved = 'feedback-resolved',
  FeedbackException = 'feedback-exception',
}

export interface AuditEvent {
  type: AuditEventType;
  timestamp: string;
  /** User/group entity ref; the UI renders parseEntityRef(actor).name */
  actor?: string;
  /** BPMN flowNodeId — the UI maps this to a task label via parallelBlocks */
  taskId?: string;
  /** Skip reason / exception reason / feedback body, where applicable */
  detail?: string;
}
