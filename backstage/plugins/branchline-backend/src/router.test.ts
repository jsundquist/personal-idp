import {
  mockServices,
  mockErrorHandler,
} from '@backstage/backend-test-utils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import express from 'express';
import request from 'supertest';
import { createRouter } from './router';

const INSTANCE = {
  id: 'wf-1',
  orchestratorInstanceKey: 'ck-1',
  owningGroup: 'group:default/platform',
  status: 'active',
  createdBy: 'user:default/starter',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function buildApp(overrides?: {
  db?: Record<string, jest.Mock>;
  orchestrator?: Record<string, jest.Mock>;
  membership?: Record<string, jest.Mock>;
  permissions?: { authorize: jest.Mock };
}) {
  const db = {
    listInstances: jest.fn().mockResolvedValue([]),
    getInstance: jest.fn().mockResolvedValue(INSTANCE),
    getActionsForInstance: jest.fn().mockResolvedValue([]),
    recordAction: jest.fn().mockResolvedValue({ id: 'a1' }),
    feedbackCountsForTask: jest.fn().mockResolvedValue({ open: 0, total: 0 }),
    feedbackCountsForInstance: jest.fn().mockResolvedValue({}),
    listFeedbackForInstance: jest.fn().mockResolvedValue([]),
    createFeedback: jest.fn().mockResolvedValue({ id: 'fb-1', status: 'open' }),
    getFeedback: jest
      .fn()
      .mockResolvedValue({ id: 'fb-1', instanceId: 'wf-1', status: 'open' }),
    listFeedbackForTask: jest.fn().mockResolvedValue([]),
    addComment: jest.fn().mockResolvedValue({ id: 'c-1' }),
    closeFeedback: jest.fn().mockResolvedValue({ id: 'fb-1', status: 'resolved' }),
    ...overrides?.db,
  };
  const orchestrator = {
    listDefinitions: jest.fn().mockResolvedValue([]),
    startInstance: jest.fn().mockResolvedValue({ orchestratorInstanceKey: 'ck-1' }),
    cancelInstance: jest.fn(),
    completeTask: jest.fn(),
    skipTask: jest.fn(),
    buildHierarchy: jest.fn().mockResolvedValue([]),
    buildFlowGraph: jest.fn().mockResolvedValue(undefined),
    getFlownodeProgress: jest.fn().mockResolvedValue(new Map()),
    getTaskCandidateGroups: jest.fn().mockResolvedValue([]),
    ...overrides?.orchestrator,
  };
  const membership = {
    isMember: jest.fn().mockResolvedValue(true),
    getGroupsForUser: jest.fn().mockResolvedValue([]),
    ...overrides?.membership,
  };

  const router = createRouter({
    httpAuth: mockServices.httpAuth(),
    db: db as any,
    orchestrator: orchestrator as any,
    membership: membership as any,
    permissions: (overrides?.permissions ?? mockServices.permissions()) as any,
    logger: mockServices.logger.mock() as any,
  });
  const app = express();
  app.use(router);
  app.use(mockErrorHandler());
  return { app, db };
}

const denyPermissions = () => ({
  authorize: jest.fn().mockResolvedValue([{ result: AuthorizeResult.DENY }]),
});

describe('createRouter', () => {
  it('GET /definitions returns empty array', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/definitions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /workflows returns empty array', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/workflows');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  describe('feedback', () => {
    it('POST feedback creates an item tagged with the instance owning group', async () => {
      const { app, db } = buildApp();
      const res = await request(app)
        .post('/workflows/wf-1/tasks/gate-arch/feedback')
        .send({ body: 'Add rate limiting' });

      expect(res.status).toBe(201);
      expect(db.createFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          instanceId: 'wf-1',
          taskId: 'gate-arch',
          authorGroup: 'group:default/platform',
          body: 'Add rate limiting',
        }),
      );
    });

    it('POST feedback with empty body is rejected', async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post('/workflows/wf-1/tasks/gate-arch/feedback')
        .send({ body: '' });
      expect(res.status).toBe(400);
    });

    it('POST feedback is denied without the act permission', async () => {
      const { app } = buildApp({ permissions: denyPermissions() });
      const res = await request(app)
        .post('/workflows/wf-1/tasks/gate-arch/feedback')
        .send({ body: 'x' });
      expect(res.status).toBe(403);
    });

    it('GET feedback returns items and counts', async () => {
      const { app } = buildApp({
        db: {
          listFeedbackForTask: jest
            .fn()
            .mockResolvedValue([{ id: 'fb-1', status: 'open' }]),
          feedbackCountsForTask: jest
            .fn()
            .mockResolvedValue({ open: 1, total: 1 }),
        },
      });
      const res = await request(app).get('/workflows/wf-1/tasks/gate-arch/feedback');
      expect(res.status).toBe(200);
      expect(res.body.counts).toEqual({ open: 1, total: 1 });
      expect(res.body.items).toHaveLength(1);
    });

    it('POST comment succeeds for any authenticated user', async () => {
      const { app, db } = buildApp({ permissions: denyPermissions() });
      const res = await request(app)
        .post('/workflows/wf-1/feedback/fb-1/comments')
        .send({ body: 'Working on it' });
      expect(res.status).toBe(201);
      expect(db.addComment).toHaveBeenCalled();
    });

    it('PATCH resolve closes the feedback item', async () => {
      const { app, db } = buildApp();
      const res = await request(app)
        .patch('/workflows/wf-1/feedback/fb-1')
        .send({ status: 'resolved' });
      expect(res.status).toBe(200);
      expect(db.closeFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ feedbackId: 'fb-1', status: 'resolved' }),
      );
    });

    it('PATCH exception without a reason is rejected', async () => {
      const { app } = buildApp();
      const res = await request(app)
        .patch('/workflows/wf-1/feedback/fb-1')
        .send({ status: 'exception' });
      expect(res.status).toBe(400);
    });

    it('PATCH exception with a reason succeeds', async () => {
      const { app, db } = buildApp();
      const res = await request(app)
        .patch('/workflows/wf-1/feedback/fb-1')
        .send({ status: 'exception', exceptionReason: 'accepted risk' });
      expect(res.status).toBe(200);
      expect(db.closeFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'exception',
          exceptionReason: 'accepted risk',
        }),
      );
    });

    it('PATCH is denied without the act permission', async () => {
      const { app } = buildApp({ permissions: denyPermissions() });
      const res = await request(app)
        .patch('/workflows/wf-1/feedback/fb-1')
        .send({ status: 'resolved' });
      expect(res.status).toBe(403);
    });
  });

  describe('completion blocking', () => {
    it('returns 409 when the task has open feedback', async () => {
      const { app } = buildApp({
        db: {
          feedbackCountsForTask: jest
            .fn()
            .mockResolvedValue({ open: 2, total: 3 }),
        },
      });
      const res = await request(app).post('/workflows/wf-1/tasks/gate-arch/complete');
      expect(res.status).toBe(409);
    });

    it('completes when there is no open feedback', async () => {
      const { app, db } = buildApp();
      const res = await request(app).post('/workflows/wf-1/tasks/gate-arch/complete');
      expect(res.status).toBe(200);
      expect(db.recordAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'completed', taskId: 'gate-arch' }),
      );
    });
  });

  describe('audit trail', () => {
    it('assembles milestone events in ascending time order', async () => {
      const { app } = buildApp({
        db: {
          getInstance: jest
            .fn()
            .mockResolvedValue({ ...INSTANCE, status: 'completed' }),
          getActionsForInstance: jest.fn().mockResolvedValue([
            {
              taskId: 't1',
              action: 'completed',
              actor: 'user:default/dev',
              occurredAt: '2026-01-01T02:00:00.000Z',
            },
          ]),
          listFeedbackForInstance: jest.fn().mockResolvedValue([
            {
              id: 'fb-1',
              taskId: 't1',
              author: 'user:default/rev',
              body: 'Add rate limiting',
              status: 'resolved',
              closedBy: 'user:default/rev',
              closedAt: '2026-01-01T01:30:00.000Z',
              createdAt: '2026-01-01T01:00:00.000Z',
            },
            {
              id: 'fb-2',
              taskId: 't1',
              author: 'user:default/rev',
              body: 'Nice to have',
              status: 'exception',
              closedBy: 'user:default/rev',
              closedAt: '2026-01-01T01:45:00.000Z',
              exceptionReason: 'deferred',
              createdAt: '2026-01-01T01:10:00.000Z',
            },
          ]),
        },
      });

      const res = await request(app).get('/workflows/wf-1/audit');
      expect(res.status).toBe(200);
      const types = res.body.map((e: { type: string }) => e.type);
      expect(types).toEqual([
        'workflow-started',
        'feedback-created',
        'feedback-created',
        'feedback-resolved',
        'feedback-exception',
        'task-completed',
        'workflow-completed',
      ]);
      // kickoff carries the starter
      expect(res.body[0]).toMatchObject({
        type: 'workflow-started',
        actor: 'user:default/starter',
      });
      // exception carries its reason
      expect(res.body.find((e: { type: string }) => e.type === 'feedback-exception')).toMatchObject({
        detail: 'deferred',
      });
    });

    it('emits no terminal event for an active workflow', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/workflows/wf-1/audit');
      expect(res.status).toBe(200);
      const types = res.body.map((e: { type: string }) => e.type);
      expect(types).toEqual(['workflow-started']);
      expect(types).not.toContain('workflow-completed');
    });
  });

  describe('per-task team gate (candidateGroups)', () => {
    it('403s when the user is not in the task candidate group', async () => {
      const { app } = buildApp({
        orchestrator: { getTaskCandidateGroups: jest.fn().mockResolvedValue(['arb']) },
        membership: {
          getGroupsForUser: jest.fn().mockResolvedValue(['group:default/developers']),
        },
      });
      const res = await request(app).post('/workflows/wf-1/tasks/arch-review/complete');
      expect(res.status).toBe(403);
    });

    it('allows when the user shares the candidate group (short-name match)', async () => {
      const { app } = buildApp({
        orchestrator: { getTaskCandidateGroups: jest.fn().mockResolvedValue(['arb']) },
        membership: {
          getGroupsForUser: jest.fn().mockResolvedValue(['group:default/arb']),
        },
      });
      const res = await request(app).post('/workflows/wf-1/tasks/arch-review/complete');
      expect(res.status).toBe(200);
    });

    it('allows an ungrouped (self-serve) task for anyone', async () => {
      const { app } = buildApp();
      const res = await request(app).post('/workflows/wf-1/tasks/submit/complete');
      expect(res.status).toBe(200);
    });

    it('GET /workflows/:id computes per-task canAct from the user groups', async () => {
      const hierarchy = [
        {
          id: 'p1',
          label: 'Phase 1',
          steps: [
            {
              id: 's1',
              label: '',
              parallelTasks: false,
              tasks: [
                { id: 'arch-review', label: 'Arch', status: 'active', candidateGroups: ['arb'] },
                { id: 'submit', label: 'Submit', status: 'active' },
              ],
            },
          ],
        },
      ];
      const { app } = buildApp({
        orchestrator: { buildHierarchy: jest.fn().mockResolvedValue(hierarchy) },
        membership: {
          getGroupsForUser: jest.fn().mockResolvedValue(['group:default/developers']),
        },
      });
      const res = await request(app).get('/workflows/wf-1');
      expect(res.status).toBe(200);
      const tasks = res.body.parallelBlocks[0].steps[0].tasks;
      const byId = Object.fromEntries(tasks.map((t: any) => [t.id, t]));
      expect(byId['arch-review'].canAct).toBe(false); // not in arb
      expect(byId.submit.canAct).toBe(true); // ungrouped self-serve
    });
  });
});
