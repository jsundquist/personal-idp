/**
 * AslHierarchyBuilder — converts an Amazon States Language document + execution
 * state into the legacy task-list hierarchy (ParallelBlock[]) consumed by
 * WorkflowDetailPage. Parallel to BpmnParser.ts's buildHierarchyFromBpmn in
 * branchline-backend-module-camunda.
 *
 * Each top-level single-branch Parallel state is a phase (see
 * AslDefinition.listPhaseNames). Within a phase's single branch, states are
 * walked in Next-chain order:
 *   Task                    → its own single-task Step
 *   Parallel (>1 branches)  → one Step (branchType: 'parallel') with each
 *                             branch's Task states flattened into `tasks`
 *   Parallel (1 branch)     → unwrapped transparently (walked inline)
 *   Choice                  → transparent routing when every outcome converges
 *                             on the same next state (the common "evaluate an
 *                             approval outcome, then continue" shape); when
 *                             outcomes genuinely diverge, becomes one Step
 *                             (branchType: 'exclusive') with each outcome's
 *                             leading task(s)
 *   Pass/Wait/Succeed/Fail/Map → transparent, followed through
 * A visited-set guards against the retry loops ASL callback tasks commonly
 * use (e.g. "check threshold → await callback → re-check"), so a loop simply
 * stops being walked further rather than recursing forever.
 */
import type { ParallelBlock, Step, Task, TaskStatus } from '@internal/backstage-plugin-branchline-common';
import type { AslDefinition, AslState } from './AslDefinition';
import { listPhaseNames } from './AslDefinition';
import { parseTaskComment } from './TaskCommentMetadata';

export interface AslHierarchyActionRecord {
  taskId: string;
  action: string;
  actor: string;
  occurredAt: string;
  skipReason?: string;
}

function resolveThroughPass(
  states: Record<string, AslState>,
  name: string,
  seen: Set<string> = new Set(),
): string | undefined {
  if (seen.has(name)) return undefined;
  const state = states[name];
  if (!state) return name;
  if (state.Type === 'Pass') {
    if (state.Next) {
      seen.add(name);
      return resolveThroughPass(states, state.Next, seen);
    }
    return undefined;
  }
  return name;
}

function toTask(
  name: string,
  statusFor: (name: string) => TaskStatus,
  actionFor: (name: string) => AslHierarchyActionRecord | undefined,
  states: Record<string, AslState>,
): Task {
  const state = states[name];
  const { candidateGroups, formKey } = parseTaskComment(state?.Comment);
  const action = actionFor(name);
  return {
    id: name,
    label: name,
    status: statusFor(name),
    ...(candidateGroups.length > 0 && { candidateGroups }),
    ...(formKey && { formKey }),
    ...(action?.action === 'completed' && {
      completedBy: action.actor,
      completedAt: action.occurredAt,
    }),
    ...(action?.action === 'skipped' && {
      skippedBy: action.actor,
      skippedAt: action.occurredAt,
      skipReason: action.skipReason,
    }),
  };
}

interface WalkCtx {
  statusFor: (name: string) => TaskStatus;
  actionFor: (name: string) => AslHierarchyActionRecord | undefined;
}

function collectTaskRun(
  states: Record<string, AslState>,
  startId: string,
  visited: Set<string>,
): { taskIds: string[]; next: string | undefined } {
  const taskIds: string[] = [];
  let cur: string | undefined = startId;
  while (cur && !visited.has(cur)) {
    const state = states[cur];
    if (!state || state.Type !== 'Task') break;
    visited.add(cur);
    taskIds.push(cur);
    cur = state.End ? undefined : state.Next;
  }
  return { taskIds, next: cur };
}

/** Collect every Task state reachable from `startId`, flattening through any
 *  nested Choice/Parallel/Pass — used when a step's `tasks` list needs every
 *  descendant task (a fork branch, or a diverging Choice outcome), not just
 *  the leading straight run `collectTaskRun` returns. A fresh `visited` set
 *  per top-level call still guards against retry loops (a Task revisited
 *  mid-walk is simply not re-added or re-descended into). */
interface DescendantTask {
  id: string;
  states: Record<string, AslState>;
}

function collectDescendantTaskIds(
  states: Record<string, AslState>,
  startId: string,
  visited: Set<string>,
): DescendantTask[] {
  const found: DescendantTask[] = [];

  function walk(id: string | undefined, currentStates: Record<string, AslState>): void {
    if (!id || visited.has(id)) return;
    const state = currentStates[id];
    if (!state) return;

    if (state.Type === 'Task') {
      visited.add(id);
      found.push({ id, states: currentStates });
      if (!state.End && state.Next) walk(state.Next, currentStates);
      return;
    }

    if (state.Type === 'Parallel') {
      visited.add(id);
      for (const branch of state.Branches ?? []) {
        found.push(...collectDescendantTaskIds(branch.States, branch.StartAt, visited));
      }
      if (!state.End && state.Next) walk(state.Next, currentStates);
      return;
    }

    if (state.Type === 'Choice') {
      visited.add(id);
      const targets = new Set<string>();
      for (const choice of state.Choices ?? []) if (choice.Next) targets.add(choice.Next);
      if (state.Default) targets.add(state.Default);
      for (const target of targets) walk(target, currentStates);
      return;
    }

    // Pass/Wait/Succeed/Fail/Map — transparent, follow through.
    visited.add(id);
    if (!state.End && state.Next) walk(state.Next, currentStates);
  }

  walk(startId, states);
  return found;
}

function walkBranch(
  states: Record<string, AslState>,
  startAt: string,
  ctx: WalkCtx,
): Step[] {
  const steps: Step[] = [];
  const visited = new Set<string>();

  function traverse(id: string | undefined): void {
    if (!id || visited.has(id)) return;
    const state = states[id];
    if (!state) return;

    if (state.Type === 'Task') {
      const { taskIds, next } = collectTaskRun(states, id, visited);
      for (const taskId of taskIds) {
        steps.push({
          id: taskId,
          label: taskId,
          parallelTasks: false,
          tasks: [toTask(taskId, ctx.statusFor, ctx.actionFor, states)],
        });
      }
      traverse(next);
      return;
    }

    if (state.Type === 'Parallel') {
      visited.add(id);
      const branches = state.Branches ?? [];
      if (branches.length === 1) {
        // Nested single-branch grouping within a phase's branch — unwrap
        // transparently rather than emitting a nested phase-like Step.
        steps.push(...walkBranch(branches[0].States, branches[0].StartAt, ctx));
      } else {
        const tasks: Task[] = [];
        for (const branch of branches) {
          const descendants = collectDescendantTaskIds(branch.States, branch.StartAt, new Set());
          for (const d of descendants) {
            tasks.push(toTask(d.id, ctx.statusFor, ctx.actionFor, d.states));
          }
        }
        steps.push({ id, label: id, parallelTasks: true, branchType: 'parallel', tasks });
      }
      if (!state.End && state.Next) traverse(state.Next);
      return;
    }

    if (state.Type === 'Choice') {
      visited.add(id);
      const targets = new Set<string>();
      for (const choice of state.Choices ?? []) {
        const resolved = choice.Next && resolveThroughPass(states, choice.Next);
        if (resolved) targets.add(resolved);
      }
      if (state.Default) {
        const resolved = resolveThroughPass(states, state.Default);
        if (resolved) targets.add(resolved);
      }
      if (targets.size <= 1) {
        // Every outcome converges on the same next state (or there's nowhere
        // to go) — transparent routing, no separate step for the decision.
        for (const target of targets) traverse(target);
      } else {
        const tasks: Task[] = [];
        for (const target of targets) {
          const descendants = collectDescendantTaskIds(states, target, new Set());
          for (const d of descendants) {
            tasks.push(toTask(d.id, ctx.statusFor, ctx.actionFor, d.states));
          }
        }
        steps.push({ id, label: id, parallelTasks: false, branchType: 'exclusive', tasks });
        for (const target of targets) traverse(target);
      }
      return;
    }

    // Pass/Wait/Succeed/Fail/Map — transparent, follow through.
    visited.add(id);
    if (!state.End && state.Next) traverse(state.Next);
  }

  traverse(startAt);
  return steps;
}

export function buildHierarchyFromAsl(
  definition: AslDefinition,
  statusByStateName: Map<string, TaskStatus>,
  actions: AslHierarchyActionRecord[],
): ParallelBlock[] {
  const actionMap = new Map<string, AslHierarchyActionRecord>();
  for (const a of actions) actionMap.set(a.taskId, a);

  const ctx: WalkCtx = {
    statusFor: name => statusByStateName.get(name) ?? 'pending',
    actionFor: name => actionMap.get(name),
  };

  const phaseNames = listPhaseNames(definition);
  return phaseNames.map(phaseName => {
    const phaseState = definition.States[phaseName];
    const branch = phaseState.Branches![0];
    return {
      id: phaseName,
      label: phaseName,
      steps: walkBranch(branch.States, branch.StartAt, ctx),
    };
  });
}
