import fs from 'fs';
import path from 'path';
import { aslToFlowGraph } from './AslAdapter';
import { parseAslDefinition, listPhaseNames } from './AslDefinition';

function loadFixture(name: string) {
  const json = fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');
  return parseAslDefinition(json);
}

describe('aslToFlowGraph', () => {
  it('maps single-branch Parallel phases and sequential tasks (simple example)', () => {
    const def = loadFixture('create-backend-service-simple-aws.json');
    expect(listPhaseNames(def)).toEqual([
      'Phase 1: Initialize Reviews',
      'Phase 2: Build Application',
      'Phase 3: Complete Application',
    ]);

    const graph = aslToFlowGraph(def, new Map(), []);

    const phaseNodes = graph.nodes.filter(n => n.type === 'phase');
    expect(phaseNodes.map(n => n.id)).toEqual(listPhaseNames(def));
    expect(phaseNodes.every(n => n.parentId === undefined)).toBe(true);

    // Phase → phase edges mirror the top-level Next chain.
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: 'Phase 1: Initialize Reviews',
        target: 'Phase 2: Build Application',
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: 'Phase 2: Build Application',
        target: 'Phase 3: Complete Application',
      }),
    );

    // Tasks inside a phase are parented to it.
    const buildApp = graph.nodes.find(n => n.id === 'Build Application');
    expect(buildApp).toMatchObject({ type: 'task', parentId: 'Phase 2: Build Application' });
  });

  it('creates a parallel-fork/join pair for multi-branch Parallel and fans branches out/in', () => {
    const def = loadFixture('create-backend-service-simple-aws.json');
    const graph = aslToFlowGraph(def, new Map(), []);

    const fork = graph.nodes.find(n => n.id === 'Phase 1 Tasks' && n.type === 'parallel-fork');
    const join = graph.nodes.find(n => n.id === 'Phase 1 Tasks::join' && n.type === 'parallel-join');
    expect(fork).toBeDefined();
    expect(join).toBeDefined();

    // Fork fans out to each branch's start task.
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: 'Phase 1 Tasks', target: 'Create Threat Model Diagram' }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: 'Phase 1 Tasks', target: 'Create Security Application Review' }),
    );

    // Each branch's terminal task fans into the join.
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: 'Create Application Architecture Review',
        target: 'Phase 1 Tasks::join',
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: 'Create Security Application Review', target: 'Phase 1 Tasks::join' }),
    );
  });

  it('redirects Choice branches through a terminal Pass state to the enclosing join (create-backend-api example)', () => {
    const def = loadFixture('create-backend-api-aws.json');
    const graph = aslToFlowGraph(def, new Map(), []);

    // "Architecture Review Outcome" is a Choice whose branches all land on
    // "Architecture Review Done" (Pass, End:true) inside the "Reviews" fork —
    // that Pass is suppressed and its incoming edges should point at the join.
    const joinId = 'Reviews::join';
    expect(graph.nodes.find(n => n.id === 'Architecture Review Done')).toBeUndefined();
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: 'Architecture Review Outcome', target: joinId, label: 'approved' }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ source: 'Architecture Review Outcome', target: joinId, label: 'Default' }),
    );
  });

  it('applies status and action metadata by state name', () => {
    const def = loadFixture('create-backend-service-simple-aws.json');
    const status = new Map([['Build Application', 'active' as const]]);
    const actions = [
      {
        taskId: 'Write E2E Tests',
        action: 'skipped',
        actor: 'user:default/dev',
        occurredAt: '2026-01-01T00:00:00.000Z',
        skipReason: 'not applicable',
      },
    ];

    const graph = aslToFlowGraph(def, status, actions);

    expect(graph.nodes.find(n => n.id === 'Build Application')).toMatchObject({ status: 'active' });
    expect(graph.nodes.find(n => n.id === 'Write E2E Tests')).toMatchObject({
      status: 'pending',
      skippedBy: 'user:default/dev',
      skipReason: 'not applicable',
    });
  });
});
