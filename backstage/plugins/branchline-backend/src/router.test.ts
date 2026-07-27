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
  camundaKey: 'ck-1',
  owningGroup: 'group:default/platform',
  status: 'active',
};

function buildApp(overrides?: {
  db?: Record<string, jest.Mock>;
  permissions?: { authorize: jest.Mock };
}) {
  const db = {
    listInstances: jest.fn().mockResolvedValue([]),
    getInstance: jest.fn().mockResolvedValue(INSTANCE),
    getActionsForInstance: jest.fn().mockResolvedValue([]),
    recordAction: jest.fn().mockResolvedValue({ id: 'a1' }),
    feedbackCountsForTask: jest.fn().mockResolvedValue({ open: 0, total: 0 }),
    feedbackCountsForInstance: jest.fn().mockResolvedValue({}),
    createFeedback: jest.fn().mockResolvedValue({ id: 'fb-1', status: 'open' }),
    getFeedback: jest
      .fn()
      .mockResolvedValue({ id: 'fb-1', instanceId: 'wf-1', status: 'open' }),
    listFeedbackForTask: jest.fn().mockResolvedValue([]),
    addComment: jest.fn().mockResolvedValue({ id: 'c-1' }),
    closeFeedback: jest.fn().mockResolvedValue({ id: 'fb-1', status: 'resolved' }),
    ...overrides?.db,
  };
  const camunda = {
    listDefinitions: jest.fn().mockResolvedValue([]),
    getElementInstances: jest.fn().mockResolvedValue([]),
    completeJob: jest.fn(),
    completeUserTask: jest.fn(),
    buildHierarchy: jest.fn().mockResolvedValue([]),
    buildFlowGraph: jest.fn().mockResolvedValue(undefined),
    getFlownodeProgress: jest.fn().mockResolvedValue(new Map()),
  };
  const membership = { isMember: jest.fn().mockResolvedValue(true) };

  const router = createRouter({
    httpAuth: mockServices.httpAuth(),
    db: db as any,
    camunda: camunda as any,
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
});
