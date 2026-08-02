import { TestDatabases } from '@backstage/backend-test-utils';
import { BranchlineDatabase } from './BranchlineDatabase';

jest.setTimeout(30_000);

describe('BranchlineDatabase — getInstances (batch)', () => {
  const databases = TestDatabases.create();

  async function createDb() {
    const knex = await databases.init('SQLITE_3');
    return BranchlineDatabase.create(knex as any);
  }

  it('returns results in input order, undefined for a missing id', async () => {
    const db = await createDb();
    const a = await db.createInstance(
      { definitionId: 'create-backend-api', title: 'A', owningGroup: 'group:default/platform' },
      `camunda-a-${Math.random()}`,
    );
    const b = await db.createInstance(
      { definitionId: 'create-backend-api', title: 'B', owningGroup: 'group:default/platform' },
      `camunda-b-${Math.random()}`,
    );

    const results = await db.getInstances([b.id, 'missing-id', a.id]);
    expect(results.map(r => r?.id)).toEqual([b.id, undefined, a.id]);
    expect(results[0]?.title).toBe('B');
    expect(results[2]?.title).toBe('A');
  });

  it('returns [] for an empty id list without querying', async () => {
    const db = await createDb();
    expect(await db.getInstances([])).toEqual([]);
  });
});
