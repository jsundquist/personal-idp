import {
  mockServices,
  mockErrorHandler,
} from '@backstage/backend-test-utils';
import express from 'express';
import request from 'supertest';
import { createRouter } from './router';

describe('createRouter', () => {
  let app: express.Express;

  beforeEach(async () => {
    const mockDb = {
      listInstances: jest.fn().mockResolvedValue([]),
      getInstance: jest.fn().mockRejectedValue(new Error('not found')),
      getActionsForInstance: jest.fn().mockResolvedValue([]),
    };
    const mockCamunda = {
      listDefinitions: jest.fn().mockResolvedValue([]),
      startInstance: jest.fn(),
      getElementInstances: jest.fn().mockResolvedValue([]),
      completeJob: jest.fn(),
      buildTaskHierarchy: jest.fn().mockReturnValue([]),
    };
    const mockMembership = {
      isMember: jest.fn().mockResolvedValue(true),
    };

    const router = createRouter({
      httpAuth: mockServices.httpAuth(),
      db: mockDb as any,
      camunda: mockCamunda as any,
      membership: mockMembership as any,
      permissions: mockServices.permissions() as any,
      logger: mockServices.logger.mock() as any,
    });
    app = express();
    app.use(router);
    app.use(mockErrorHandler());
  });

  it('GET /definitions returns empty array', async () => {
    const res = await request(app).get('/definitions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /workflows returns empty array', async () => {
    const res = await request(app).get('/workflows');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
