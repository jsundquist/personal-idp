import { DOMParser } from '@xmldom/xmldom';
import { CamundaElementInstance } from './types';
import { ParallelBlock, Step, Task, TaskStatus } from '../types';

const TASK_TYPES = new Set(['serviceTask', 'userTask', 'manualTask', 'receiveTask', 'sendTask']);

interface FlowElement {
  id: string;
  name?: string;
  type: string;
  documentation?: string;
  candidateGroups?: string[];
}

interface TaskRef {
  id: string;
  name?: string;
  documentation?: string;
  candidateGroups?: string[];
}

interface StepSpec {
  id: string;
  name?: string;
  branchType?: 'exclusive' | 'parallel';
  // for plain tasks: one entry; for branch steps: one entry per branch task (flat)
  taskRefs: TaskRef[];
}

interface PhaseSpec {
  id: string;
  name?: string;
  stepSpecs: StepSpec[];
}

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? '';
}

function childElements(el: Element): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes.item(i);
    if (node.nodeType === 1) result.push(node as Element);
  }
  return result;
}

function getDocumentation(el: Element): string | undefined {
  for (const child of childElements(el)) {
    if (child.localName === 'documentation') {
      return child.textContent?.trim() || undefined;
    }
  }
  return undefined;
}

/**
 * Read literal candidateGroups from a task's zeebe:assignmentDefinition.
 * FEEL expression values (starting with '=') are treated as "no static group".
 */
function getCandidateGroups(el: Element): string[] | undefined {
  for (const child of childElements(el)) {
    if (child.localName !== 'extensionElements') continue;
    for (const ext of childElements(child)) {
      if (ext.localName !== 'assignmentDefinition') continue;
      const raw = ext.getAttribute('candidateGroups') ?? '';
      if (!raw || raw.trim().startsWith('=')) return undefined;
      const groups = raw.split(',').map(g => g.trim()).filter(Boolean);
      return groups.length ? groups : undefined;
    }
  }
  return undefined;
}

function parseSubProcessSteps(el: Element): StepSpec[] {
  const elements = new Map<string, FlowElement>();
  const outgoing = new Map<string, string[]>();
  let startId = '';

  for (const child of childElements(el)) {
    const id = attr(child, 'id');
    const localName = child.localName;
    if (!id) continue;

    elements.set(id, { id, name: attr(child, 'name') || undefined, type: localName });

    if (localName === 'startEvent') {
      startId = id;
    } else if (TASK_TYPES.has(localName)) {
      elements.set(id, {
        id,
        name: attr(child, 'name') || undefined,
        type: localName,
        documentation: getDocumentation(child),
        candidateGroups: getCandidateGroups(child),
      });
      continue;
    } else if (localName === 'sequenceFlow') {
      const src = attr(child, 'sourceRef');
      const tgt = attr(child, 'targetRef');
      if (src && tgt) {
        if (!outgoing.has(src)) outgoing.set(src, []);
        outgoing.get(src)!.push(tgt);
      }
    }
  }

  const steps: StepSpec[] = [];
  const visited = new Set<string>();

  function collectBranchTasks(
    startNodeId: string,
    mergeType: string,
  ): { taskRefs: TaskRef[]; mergeId: string } {
    const taskRefs: TaskRef[] = [];
    let mergeId = '';
    let cur = startNodeId;
    while (cur) {
      if (visited.has(cur)) break;
      const node = elements.get(cur);
      if (!node) break;
      if (TASK_TYPES.has(node.type)) {
        taskRefs.push({ id: cur, name: node.name, documentation: node.documentation, candidateGroups: node.candidateGroups });
        cur = (outgoing.get(cur) ?? [])[0] ?? '';
      } else if (node.type === mergeType) {
        mergeId = cur;
        break;
      } else {
        cur = (outgoing.get(cur) ?? [])[0] ?? '';
      }
    }
    return { taskRefs, mergeId };
  }

  function traverse(nodeId: string): void {
    if (!nodeId || visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = elements.get(nodeId);
    if (!node) return;

    const nexts = outgoing.get(nodeId) ?? [];

    if (TASK_TYPES.has(node.type)) {
      steps.push({ id: nodeId, name: node.name, taskRefs: [{ id: nodeId, name: node.name, documentation: node.documentation, candidateGroups: node.candidateGroups }] });
      traverse(nexts[0] ?? '');
    } else if (node.type === 'exclusiveGateway' && nexts.length > 1) {
      const allTaskRefs: TaskRef[] = [];
      let mergeId = '';
      for (const branchStart of nexts) {
        const result = collectBranchTasks(branchStart, 'exclusiveGateway');
        allTaskRefs.push(...result.taskRefs);
        if (result.mergeId) mergeId = result.mergeId;
      }
      for (const ref of allTaskRefs) visited.add(ref.id);
      steps.push({
        id: nodeId,
        name: node.name || 'Choice',
        branchType: 'exclusive',
        taskRefs: allTaskRefs,
      });
      if (mergeId) {
        visited.add(mergeId);
        traverse((outgoing.get(mergeId) ?? [])[0] ?? '');
      }
    } else if (node.type === 'parallelGateway' && nexts.length > 1) {
      const allTaskRefs: TaskRef[] = [];
      let mergeId = '';
      for (const branchStart of nexts) {
        const result = collectBranchTasks(branchStart, 'parallelGateway');
        allTaskRefs.push(...result.taskRefs);
        if (result.mergeId) mergeId = result.mergeId;
      }
      for (const ref of allTaskRefs) visited.add(ref.id);
      steps.push({
        id: nodeId,
        name: node.name || 'Parallel',
        branchType: 'parallel',
        taskRefs: allTaskRefs,
      });
      if (mergeId) {
        visited.add(mergeId);
        traverse((outgoing.get(mergeId) ?? [])[0] ?? '');
      }
    } else {
      // join gateway, start/end event — skip and follow
      traverse(nexts[0] ?? '');
    }
  }

  traverse(startId);

  // Fallback: if traversal yielded nothing (e.g. no start event), collect tasks in order
  if (steps.length === 0) {
    for (const [id, node] of elements) {
      if (TASK_TYPES.has(node.type)) {
        steps.push({ id, name: node.name, taskRefs: [{ id, name: node.name, documentation: node.documentation, candidateGroups: node.candidateGroups }] });
      }
    }
  }

  return steps;
}

function deriveTaskStatus(
  flowNodeId: string,
  stateMap: Map<string, CamundaElementInstance>,
  actionMap: Map<string, { action: string; actor: string; occurredAt: string; skipReason?: string }>,
): TaskStatus {
  const action = actionMap.get(flowNodeId);
  if (action?.action === 'skipped') return 'skipped';

  const instance = stateMap.get(flowNodeId);
  if (!instance) return 'pending';
  if (instance.state === 'ACTIVE') return 'active';
  if (instance.state === 'COMPLETED') return 'completed';
  return 'pending';
}


export function parseBpmnXml(xml: string): PhaseSpec[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const process = doc.getElementsByTagNameNS('*', 'process')[0];
  if (!process) return [];

  const phases: PhaseSpec[] = [];
  for (const child of childElements(process as unknown as Element)) {
    if (child.localName === 'subProcess') {
      phases.push({
        id: attr(child, 'id'),
        name: attr(child, 'name') || undefined,
        stepSpecs: parseSubProcessSteps(child),
      });
    }
  }
  return phases;
}

export function buildHierarchyFromBpmn(
  phases: PhaseSpec[],
  instances: CamundaElementInstance[],
  actions: Array<{ taskId: string; action: string; actor: string; occurredAt: string; skipReason?: string }>,
): ParallelBlock[] {
  const stateMap = new Map<string, CamundaElementInstance>();
  for (const inst of instances) {
    const existing = stateMap.get(inst.flowNodeId);
    if (!existing || inst.key > existing.key) {
      stateMap.set(inst.flowNodeId, inst);
    }
  }

  const actionMap = new Map<string, (typeof actions)[0]>();
  for (const a of actions) {
    actionMap.set(a.taskId, a);
  }

  return phases.map(phase => {
    const steps: Step[] = phase.stepSpecs.map(spec => {
      if (spec.branchType) {
        return {
          id: spec.id,
          label: spec.name ?? spec.id,
          parallelTasks: spec.branchType === 'parallel',
          branchType: spec.branchType,
          tasks: spec.taskRefs.map(ref => {
            const status = deriveTaskStatus(ref.id, stateMap, actionMap);
            const action = actionMap.get(ref.id);
            return {
              id: ref.id,
              label: ref.name ?? ref.id,
              status,
              ...(ref.documentation && { documentation: ref.documentation }),
              ...(ref.candidateGroups && { candidateGroups: ref.candidateGroups }),
              ...(action?.action === 'completed' && {
                completedBy: action.actor,
                completedAt: action.occurredAt,
              }),
              ...(action?.action === 'skipped' && {
                skippedBy: action.actor,
                skippedAt: action.occurredAt,
                skipReason: action.skipReason,
              }),
            } satisfies Task;
          }),
        };
      }
      // Single task step
      const [ref] = spec.taskRefs;
      const taskId = ref.id;
      const status = deriveTaskStatus(taskId, stateMap, actionMap);
      const action = actionMap.get(taskId);
      return {
        id: taskId,
        label: spec.name ?? taskId,
        parallelTasks: false,
        tasks: [
          {
            id: taskId,
            label: spec.name ?? taskId,
            status,
            ...(ref.documentation && { documentation: ref.documentation }),
            ...(ref.candidateGroups && { candidateGroups: ref.candidateGroups }),
            ...(action?.action === 'completed' && {
              completedBy: action.actor,
              completedAt: action.occurredAt,
            }),
            ...(action?.action === 'skipped' && {
              skippedBy: action.actor,
              skippedAt: action.occurredAt,
              skipReason: action.skipReason,
            }),
          } satisfies Task,
        ],
      };
    });

    return {
      id: phase.id,
      label: phase.name ?? phase.id,
      steps,
    };
  });
}
