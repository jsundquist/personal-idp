/**
 * BpmnAdapter — converts a BPMN 2.0 XML document + Camunda execution state
 * into the orchestrator-agnostic FlowGraph consumed by the frontend renderer.
 *
 * Mapping:
 *   subProcess            → phase node (container)
 *   userTask / serviceTask / …  → task node
 *   parallelGateway (split)     → parallel-fork node
 *   parallelGateway (join)      → parallel-join node
 *   exclusiveGateway (split)    → choice node
 *   exclusiveGateway (join)     → suppressed; branch tails connect directly
 *                                 to the post-merge node
 *   sequenceFlow                → FlowEdge (name → label on choice branches)
 */

import { DOMParser } from '@xmldom/xmldom';
import type { FlowEdge, FlowGraph, FlowNode, FlowNodeType, TaskStatus } from '../types';
import type { CamundaElementInstance } from './types';

const TASK_TYPES = new Set([
  'serviceTask',
  'userTask',
  'manualTask',
  'receiveTask',
  'sendTask',
]);

// ── XML helpers ──────────────────────────────────────────────────────────────

function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? '';
}

function childElements(el: Element): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes.item(i);
    if (n.nodeType === 1) out.push(n as Element);
  }
  return out;
}

function getDocumentation(el: Element): string | undefined {
  for (const child of childElements(el)) {
    if (child.localName === 'documentation') {
      return child.textContent?.trim() || undefined;
    }
  }
  return undefined;
}

// ── Internal graph structures ────────────────────────────────────────────────

interface ElementMeta {
  id: string;
  name?: string;
  type: string; // BPMN local name
  documentation?: string;
}

interface SequenceFlow {
  id: string;
  source: string;
  target: string;
  name?: string;
}

interface SubGraph {
  elements: Map<string, ElementMeta>;
  flows: SequenceFlow[];
  outgoing: Map<string, string[]>; // elementId → [targetIds]
  incoming: Map<string, string[]>; // elementId → [sourceIds]
  startId: string;
}

function buildSubGraph(el: Element): SubGraph {
  const elements = new Map<string, ElementMeta>();
  const flows: SequenceFlow[] = [];
  let startId = '';

  for (const child of childElements(el)) {
    const id = attr(child, 'id');
    const localName = child.localName;
    if (!id) continue;

    if (localName === 'startEvent') {
      startId = id;
      elements.set(id, { id, type: localName });
    } else if (localName === 'endEvent') {
      elements.set(id, { id, type: localName });
    } else if (TASK_TYPES.has(localName) || localName === 'exclusiveGateway' || localName === 'parallelGateway') {
      const documentation = TASK_TYPES.has(localName) ? getDocumentation(child) : undefined;
      elements.set(id, { id, name: attr(child, 'name') || undefined, type: localName, documentation });
    } else if (localName === 'sequenceFlow') {
      const source = attr(child, 'sourceRef');
      const target = attr(child, 'targetRef');
      const name = attr(child, 'name') || undefined;
      if (source && target) flows.push({ id, source, target, name });
    }
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const f of flows) {
    if (!outgoing.has(f.source)) outgoing.set(f.source, []);
    outgoing.get(f.source)!.push(f.target);
    if (!incoming.has(f.target)) incoming.set(f.target, []);
    incoming.get(f.target)!.push(f.source);
  }

  return { elements, flows, outgoing, incoming, startId };
}

// ── Execution state helpers ──────────────────────────────────────────────────

type ActionRecord = {
  taskId: string;
  action: string;
  actor: string;
  occurredAt: string;
  skipReason?: string;
};

function deriveStatus(
  id: string,
  stateMap: Map<string, CamundaElementInstance>,
  actionMap: Map<string, ActionRecord>,
): TaskStatus {
  const action = actionMap.get(id);
  if (action?.action === 'skipped') return 'skipped';
  const inst = stateMap.get(id);
  if (!inst) return 'pending';
  if (inst.state === 'ACTIVE') return 'active';
  if (inst.state === 'COMPLETED') return 'completed';
  return 'pending';
}

// ── Core adapter ─────────────────────────────────────────────────────────────

export function bpmnToFlowGraph(
  xml: string,
  instances: CamundaElementInstance[],
  actions: ActionRecord[],
): FlowGraph {
  // Build execution-state lookup maps
  const stateMap = new Map<string, CamundaElementInstance>();
  for (const inst of instances) {
    const existing = stateMap.get(inst.flowNodeId);
    if (!existing || inst.key > existing.key) stateMap.set(inst.flowNodeId, inst);
  }
  const actionMap = new Map<string, ActionRecord>();
  for (const a of actions) actionMap.set(a.taskId, a);

  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const process = doc.getElementsByTagNameNS('*', 'process')[0] as Element | undefined;
  if (!process) return { nodes: [], edges: [] };

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // ── Top-level: find subProcesses and inter-phase flows ──

  const topGraph = buildSubGraph(process as unknown as Element);

  // Collect subProcess ids in document order
  const phaseIds: string[] = [];
  for (const child of childElements(process as unknown as Element)) {
    if (child.localName === 'subProcess') phaseIds.push(attr(child, 'id'));
  }

  // Add top-level phase → phase edges from sequenceFlows between subProcesses
  for (const flow of topGraph.flows) {
    const srcIsPhase = phaseIds.includes(flow.source);
    const tgtIsPhase = phaseIds.includes(flow.target);
    if (srcIsPhase && tgtIsPhase) {
      edges.push({ id: flow.id, source: flow.source, target: flow.target });
    }
  }

  // ── Process each subProcess ──

  for (const phaseEl of childElements(process as unknown as Element)) {
    if (phaseEl.localName !== 'subProcess') continue;

    const phaseId = attr(phaseEl, 'id');
    const phaseLabel = attr(phaseEl, 'name') || phaseId;

    nodes.push({ id: phaseId, label: phaseLabel, type: 'phase' });

    const g = buildSubGraph(phaseEl);

    // Identify merge exclusive gateways: exclusiveGateway with >1 incoming, 1 outgoing
    const mergeGateways = new Set<string>();
    for (const [id, el] of g.elements) {
      if (
        el.type === 'exclusiveGateway' &&
        (g.incoming.get(id)?.length ?? 0) > 1 &&
        (g.outgoing.get(id)?.length ?? 0) <= 1
      ) {
        mergeGateways.add(id);
      }
    }

    // Helper: if a target is a merge gateway, follow through to its successor
    const resolveTarget = (targetId: string): string => {
      if (mergeGateways.has(targetId)) {
        return (g.outgoing.get(targetId) ?? [])[0] ?? targetId;
      }
      return targetId;
    };

    // Determine node type for gateways
    const gatewayType = (id: string, bpmnType: string): FlowNodeType | null => {
      if (bpmnType === 'exclusiveGateway') {
        if (mergeGateways.has(id)) return null; // suppressed
        return 'choice';
      }
      if (bpmnType === 'parallelGateway') {
        const outCount = g.outgoing.get(id)?.length ?? 0;
        return outCount > 1 ? 'parallel-fork' : 'parallel-join';
      }
      return null;
    };

    // Emit nodes
    for (const [id, el] of g.elements) {
      if (el.type === 'startEvent' || el.type === 'endEvent') continue;

      if (TASK_TYPES.has(el.type)) {
        const status = deriveStatus(id, stateMap, actionMap);
        const action = actionMap.get(id);
        nodes.push({
          id,
          label: el.name ?? id,
          type: 'task',
          status,
          parentId: phaseId,
          ...(el.documentation && { documentation: el.documentation }),
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
      } else if (el.type === 'exclusiveGateway' || el.type === 'parallelGateway') {
        const nodeType = gatewayType(id, el.type);
        if (nodeType) {
          nodes.push({ id, label: el.name ?? '', type: nodeType, parentId: phaseId });
        }
      }
    }

    // Emit edges (skipping flows where source is a merge gateway)
    for (const flow of g.flows) {
      if (mergeGateways.has(flow.source)) continue;
      // Skip flows leading from start events
      const srcEl = g.elements.get(flow.source);
      if (srcEl?.type === 'startEvent') continue;

      const resolved = resolveTarget(flow.target);
      // Skip if resolved target is a startEvent or endEvent
      const tgtEl = g.elements.get(resolved);
      if (tgtEl?.type === 'startEvent' || tgtEl?.type === 'endEvent') continue;

      edges.push({
        id: flow.id,
        source: flow.source,
        target: resolved,
        ...(flow.name ? { label: flow.name } : {}),
      });
    }
  }

  return { nodes, edges };
}
