import { TestDatabases } from '@backstage/backend-test-utils';
import { BranchlineDatabase } from './BranchlineDatabase';

jest.setTimeout(30_000);

describe('BranchlineDatabase — feedback', () => {
  const databases = TestDatabases.create();

  async function createDbWithInstance() {
    const knex = await databases.init('SQLITE_3');
    // Cast: TestDatabases ships a different nested knex type identity than the
    // plugin's knex — the same reason plugin.ts casts its db client with `as any`.
    const db = await BranchlineDatabase.create(knex as any);
    const instance = await db.createInstance(
      {
        definitionId: 'create-backend-api',
        title: 'Test',
        owningGroup: 'group:default/platform',
      },
      `camunda-${Math.random()}`,
    );
    return { db, instanceId: instance.id };
  }

  it('creates feedback and reports open/total counts', async () => {
    const { db, instanceId } = await createDbWithInstance();

    await db.createFeedback({
      instanceId,
      taskId: 'gate-arch',
      authorGroup: 'group:default/arb',
      author: 'user:default/reviewer',
      body: 'Add rate limiting',
    });

    const items = await db.listFeedbackForTask(instanceId, 'gate-arch');
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('open');
    expect(items[0].body).toBe('Add rate limiting');
    expect(items[0].comments).toEqual([]);

    const counts = await db.feedbackCountsForTask(instanceId, 'gate-arch');
    expect(counts).toEqual({ open: 1, total: 1 });
  });

  it('threads comments under a feedback item', async () => {
    const { db, instanceId } = await createDbWithInstance();
    const item = await db.createFeedback({
      instanceId,
      taskId: 'gate-arch',
      authorGroup: 'group:default/arb',
      author: 'user:default/reviewer',
      body: 'Explain the retry policy',
    });

    await db.addComment({
      feedbackId: item.id,
      author: 'user:default/dev',
      body: 'Using exponential backoff',
    });

    const [reloaded] = await db.listFeedbackForTask(instanceId, 'gate-arch');
    expect(reloaded.comments).toHaveLength(1);
    expect(reloaded.comments[0].author).toBe('user:default/dev');
    expect(reloaded.comments[0].body).toBe('Using exponential backoff');
  });

  it('closes feedback as resolved and as exception, updating counts', async () => {
    const { db, instanceId } = await createDbWithInstance();
    const a = await db.createFeedback({
      instanceId,
      taskId: 'gate-arch',
      authorGroup: 'group:default/arb',
      author: 'user:default/reviewer',
      body: 'Item A',
    });
    const b = await db.createFeedback({
      instanceId,
      taskId: 'gate-arch',
      authorGroup: 'group:default/arb',
      author: 'user:default/reviewer',
      body: 'Item B',
    });

    const resolved = await db.closeFeedback({
      feedbackId: a.id,
      status: 'resolved',
      closedBy: 'user:default/reviewer',
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.closedBy).toBe('user:default/reviewer');
    expect(resolved.exceptionReason).toBeUndefined();

    const excepted = await db.closeFeedback({
      feedbackId: b.id,
      status: 'exception',
      closedBy: 'user:default/reviewer',
      exceptionReason: 'Accepted risk for MVP',
    });
    expect(excepted.status).toBe('exception');
    expect(excepted.exceptionReason).toBe('Accepted risk for MVP');

    const counts = await db.feedbackCountsForTask(instanceId, 'gate-arch');
    expect(counts).toEqual({ open: 0, total: 2 });
  });

  it('persists created_by and returns it across all tasks via listFeedbackForInstance', async () => {
    const knex = await databases.init('SQLITE_3');
    const db = await BranchlineDatabase.create(knex as any);
    const instance = await db.createInstance(
      {
        definitionId: 'create-backend-api',
        title: 'Test',
        owningGroup: 'group:default/platform',
      },
      `camunda-${Math.random()}`,
      'user:default/starter',
    );

    // created_by round-trips
    const reloaded = await db.getInstance(instance.id);
    expect(reloaded.createdBy).toBe('user:default/starter');

    await db.createFeedback({
      instanceId: instance.id,
      taskId: 'gate-arch',
      authorGroup: 'g',
      author: 'u',
      body: 'a',
    });
    await db.createFeedback({
      instanceId: instance.id,
      taskId: 'gate-sec',
      authorGroup: 'g',
      author: 'u',
      body: 'b',
    });

    const all = await db.listFeedbackForInstance(instance.id);
    expect(all).toHaveLength(2);
    expect(all.map(i => i.taskId).sort()).toEqual(['gate-arch', 'gate-sec']);
  });

  it('aggregates counts per task across an instance', async () => {
    const { db, instanceId } = await createDbWithInstance();
    await db.createFeedback({
      instanceId,
      taskId: 'gate-arch',
      authorGroup: 'g',
      author: 'u',
      body: 'x',
    });
    await db.createFeedback({
      instanceId,
      taskId: 'gate-sec',
      authorGroup: 'g',
      author: 'u',
      body: 'y',
    });

    const map = await db.feedbackCountsForInstance(instanceId);
    expect(map['gate-arch']).toEqual({ open: 1, total: 1 });
    expect(map['gate-sec']).toEqual({ open: 1, total: 1 });
  });
});
