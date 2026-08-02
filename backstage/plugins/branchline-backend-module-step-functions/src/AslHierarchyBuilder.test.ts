import fs from 'fs';
import path from 'path';
import { buildHierarchyFromAsl } from './AslHierarchyBuilder';
import { parseAslDefinition } from './AslDefinition';
import type { TaskStatus } from '@internal/backstage-plugin-branchline-common';

function loadFixture(name: string) {
  const json = fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');
  return parseAslDefinition(json);
}

describe('buildHierarchyFromAsl', () => {
  it('walks single-branch phases and flattens multi-branch Parallel into one step (simple example)', () => {
    const def = loadFixture('create-backend-service-simple-aws.json');
    const blocks = buildHierarchyFromAsl(def, new Map(), []);

    expect(blocks.map(b => b.id)).toEqual([
      'Phase 1: Initialize Reviews',
      'Phase 2: Build Application',
      'Phase 3: Complete Application',
    ]);

    const phase1Tasks = blocks[0].steps.flatMap(s => s.tasks).map(t => t.id);
    expect(phase1Tasks).toEqual(
      expect.arrayContaining([
        'Create Threat Model Diagram',
        'Create Application Architecture Review',
        'Create Security Application Review',
        'Setup SonarQube',
      ]),
    );
    // The nested fork/join collapses into a single parallel step.
    const parallelStep = blocks[0].steps.find(s => s.branchType === 'parallel');
    expect(parallelStep?.tasks.length).toBe(4);
  });

  it('walks a sequential phase with Choice outcome-routing transparently (create-backend-api example)', () => {
    const def = loadFixture('create-backend-api-aws.json');
    const blocks = buildHierarchyFromAsl(def, new Map(), []);

    const phase3 = blocks.find(b => b.id === 'Phase 3: Development');
    const taskIds = phase3?.steps.flatMap(s => s.tasks).map(t => t.id);
    // Each task is followed by a Choice whose outcomes all converge on the
    // same next task — should walk through as a plain sequential chain, with
    // no separate step for the Choice itself.
    expect(taskIds).toEqual(['Develop Project', 'Write Unit Tests', 'Write End-to-End Tests']);
    expect(phase3?.steps.every(s => s.branchType === undefined)).toBe(true);
  });

  it('does not infinite-loop on a retry loop (Phase 4 SonarCloud/Snyk/GitGuardian recheck)', () => {
    const def = loadFixture('create-backend-api-aws.json');
    const blocks = buildHierarchyFromAsl(def, new Map(), []);

    const phase4 = blocks.find(b => b.id === 'Phase 4: Resolve Security Findings');
    expect(phase4).toBeDefined();
    const taskIds = phase4!.steps.flatMap(s => s.tasks).map(t => t.id);
    expect(taskIds).toEqual(
      expect.arrayContaining(['Check SonarCloud Threshold', 'Await SonarCloud Cleared', 'Request Security Sign-off']),
    );
  });

  it('applies status and action metadata by state name', () => {
    const def = loadFixture('create-backend-service-simple-aws.json');
    const status = new Map<string, TaskStatus>([['Build Application', 'active']]);
    const actions = [
      {
        taskId: 'Write E2E Tests',
        action: 'skipped',
        actor: 'user:default/dev',
        occurredAt: '2026-01-01T00:00:00.000Z',
        skipReason: 'not applicable',
      },
    ];

    const blocks = buildHierarchyFromAsl(def, status, actions);
    const tasks = blocks.flatMap(b => b.steps.flatMap(s => s.tasks));
    const byId = Object.fromEntries(tasks.map(t => [t.id, t]));

    expect(byId['Build Application']).toMatchObject({ status: 'active' });
    expect(byId['Write E2E Tests']).toMatchObject({
      skippedBy: 'user:default/dev',
      skipReason: 'not applicable',
    });
  });

  it('attaches candidateGroups and formKey parsed from a task Comment', () => {
    const def = parseAslDefinition(
      JSON.stringify({
        StartAt: 'Phase 1',
        States: {
          'Phase 1': {
            Type: 'Parallel',
            Branches: [
              {
                StartAt: 'Legal Review',
                States: {
                  'Legal Review': {
                    Type: 'Task',
                    Comment: JSON.stringify({ candidateGroups: ['legal-team'], formKey: 'legal-review-form' }),
                    End: true,
                  },
                },
              },
            ],
            End: true,
          },
        },
      }),
    );

    const blocks = buildHierarchyFromAsl(def, new Map(), []);
    const task = blocks[0].steps[0].tasks[0];
    expect(task.candidateGroups).toEqual(['legal-team']);
    expect(task.formKey).toBe('legal-review-form');
  });

  it('leaves candidateGroups unset for a task with no gating comment', () => {
    const def = loadFixture('create-backend-service-simple-aws.json');
    const blocks = buildHierarchyFromAsl(def, new Map(), []);
    const task = blocks[0].steps.flatMap(s => s.tasks).find(t => t.id === 'Create Threat Model Diagram');
    expect(task?.candidateGroups).toBeUndefined();
  });
});
