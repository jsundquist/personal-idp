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
