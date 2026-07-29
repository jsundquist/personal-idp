/**
 * AslAdapter — converts an Amazon States Language document + execution state
 * into the orchestrator-agnostic FlowGraph consumed by the frontend renderer.
 * Parallel to BpmnAdapter.ts in branchline-backend-module-camunda.
 *
 * Mapping:
 *   Parallel (1 branch)    → phase node (container) — mirrors a BPMN subProcess
 *   Parallel (>1 branches) → parallel-fork + parallel-join node pair
 *   Choice                 → choice node
 *   Task                   → task node (incl. .waitForTaskToken human/callback tasks)
 *   Pass                   → suppressed; treated as a transparent passthrough,
 *                             like a BPMN merge gateway. A Pass with End:true
 *                             marks "this branch is done" — its incoming edges
 *                             are redirected to the enclosing fork's join node
 *                             (or dropped, for a phase-level dead end).
 */
import type { FlowEdge, FlowGraph, FlowNode, TaskStatus } from '@internal/backstage-plugin-branchline-common';
import type { AslDefinition, AslState } from './AslDefinition';

export interface AslActionRecord {
  taskId: string;
  action: string;
  actor: string;
  occurredAt: string;
  skipReason?: string;
}

interface WalkCtx {
  nodes: FlowNode[];
  edges: FlowEdge[];
  edgeSeq: number;
  statusFor: (name: string) => TaskStatus | undefined;
  actionFor: (name: string) => AslActionRecord | undefined;
}

function shortLabel(condition: string | undefined): string | undefined {
  if (!condition) return undefined;
  // Pull a trailing string-literal comparison out of a JSONata condition,
  // e.g. "{% $states.input.outcome = 'approved' %}" → "approved".
  const match = condition.match(/=\s*'([^']*)'/);
  return match ? match[1] : undefined;
}

/** Resolve a Next/Choices/Default target through any chain of Pass states.
 *  Returns undefined if the chain dead-ends with no exit target. */
function resolveTarget(
  states: Record<string, AslState>,
  name: string,
  exitId: string | undefined,
  seen: Set<string> = new Set(),
): string | undefined {
  if (seen.has(name)) return undefined;
  const state = states[name];
  if (!state) return exitId;
  if (state.Type === 'Pass') {
    if (state.Next) {
      seen.add(name);
      return resolveTarget(states, state.Next, exitId, seen);
    }
    return exitId;
  }
  return name;
}

function addEdge(
  ctx: WalkCtx,
  states: Record<string, AslState>,
  source: string,
  targetName: string,
  exitId: string | undefined,
  label?: string,
): void {
  const resolved = resolveTarget(states, targetName, exitId);
  if (!resolved) return;
  ctx.edges.push({
    id: `e${ctx.edgeSeq++}`,
    source,
    target: resolved,
    ...(label ? { label } : {}),
  });
}

function processRegion(
  states: Record<string, AslState>,
  parentId: string | undefined,
  exitId: string | undefined,
  ctx: WalkCtx,
): void {
  for (const [name, state] of Object.entries(states)) {
    if (state.Type === 'Pass') continue; // suppressed — resolved at edge-creation sites

    if (state.Type === 'Task') {
      const status = ctx.statusFor(name) ?? 'pending';
      const action = ctx.actionFor(name);
      ctx.nodes.push({
        id: name,
        label: name,
        type: 'task',
        status,
        parentId,
        ...(action?.action === 'completed' && {
          completedBy: action.actor,
          completedAt: action.occurredAt,
        }),
        ...(action?.action === 'skipped' && {
          skippedBy: action.actor,
          skippedAt: action.occurredAt,
          skipReason: action.skipReason,
        }),
      });
      if (state.End) {
        if (exitId) ctx.edges.push({ id: `e${ctx.edgeSeq++}`, source: name, target: exitId });
      } else if (state.Next) {
        addEdge(ctx, states, name, state.Next, exitId);
      }
      continue;
    }

    if (state.Type === 'Choice') {
      ctx.nodes.push({ id: name, label: name, type: 'choice', parentId });
      for (const choice of state.Choices ?? []) {
        addEdge(ctx, states, name, choice.Next, exitId, shortLabel(choice.Condition));
      }
      if (state.Default) {
        addEdge(ctx, states, name, state.Default, exitId, 'Default');
      }
      continue;
    }

    if (state.Type === 'Parallel') {
      const branches = state.Branches ?? [];
      if (branches.length === 1) {
        // Phase grouping — mirrors a BPMN subProcess.
        ctx.nodes.push({ id: name, label: name, type: 'phase', parentId });
        processRegion(branches[0].States, name, undefined, ctx);
        if (state.Next && !state.End) {
          addEdge(ctx, states, name, state.Next, exitId);
        }
      } else {
        // True concurrency — mirrors a BPMN parallelGateway fork/join.
        const joinId = `${name}::join`;
        ctx.nodes.push({ id: name, label: name, type: 'parallel-fork', parentId });
        ctx.nodes.push({ id: joinId, label: name, type: 'parallel-join', parentId });
        for (const branch of branches) {
          ctx.edges.push({ id: `e${ctx.edgeSeq++}`, source: name, target: branch.StartAt });
          processRegion(branch.States, parentId, joinId, ctx);
        }
        if (state.Next && !state.End) {
          addEdge(ctx, states, joinId, state.Next, exitId);
        }
      }
      continue;
    }

    // Wait/Succeed/Fail/Map or anything else unmodeled: render as a task-like
    // passthrough node so it isn't silently dropped from the graph.
    ctx.nodes.push({ id: name, label: name, type: 'task', parentId });
    if (state.End) {
      if (exitId) ctx.edges.push({ id: `e${ctx.edgeSeq++}`, source: name, target: exitId });
    } else if (state.Next) {
      addEdge(ctx, states, name, state.Next, exitId);
    }
  }
}

export function aslToFlowGraph(
  definition: AslDefinition,
  statusByStateName: Map<string, TaskStatus>,
  actions: AslActionRecord[],
): FlowGraph {
  const actionMap = new Map<string, AslActionRecord>();
  for (const a of actions) actionMap.set(a.taskId, a);

  const ctx: WalkCtx = {
    nodes: [],
    edges: [],
    edgeSeq: 0,
    statusFor: nm => statusByStateName.get(nm),
    actionFor: nm => actionMap.get(nm),
  };
  processRegion(definition.States, undefined, undefined, ctx);
  return { nodes: ctx.nodes, edges: ctx.edges };
}
