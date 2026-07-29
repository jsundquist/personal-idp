import { TestDatabases } from '@backstage/backend-test-utils';
import { TaskTokenStore } from './TaskTokenStore';

jest.setTimeout(30_000);

describe('TaskTokenStore', () => {
  const databases = TestDatabases.create();

  async function createStore() {
    const knex = await databases.init('SQLITE_3');
    return TaskTokenStore.create(knex as any);
  }

  it('returns undefined for a token that was never saved', async () => {
    const store = await createStore();
    await expect(store.get('exec-1', 'Await SonarCloud Cleared')).resolves.toBeUndefined();
  });

  it('saves and retrieves a token by execution + state name', async () => {
    const store = await createStore();
    await store.save('exec-1', 'Await SonarCloud Cleared', 'token-abc');
    await expect(store.get('exec-1', 'Await SonarCloud Cleared')).resolves.toBe('token-abc');
  });

  it('is single-use: remove deletes the token', async () => {
    const store = await createStore();
    await store.save('exec-1', 'Await SonarCloud Cleared', 'token-abc');
    await store.remove('exec-1', 'Await SonarCloud Cleared');
    await expect(store.get('exec-1', 'Await SonarCloud Cleared')).resolves.toBeUndefined();
  });

  it('re-saving the same execution+state overwrites the prior token', async () => {
    const store = await createStore();
    await store.save('exec-1', 'Await SonarCloud Cleared', 'token-old');
    await store.save('exec-1', 'Await SonarCloud Cleared', 'token-new');
    await expect(store.get('exec-1', 'Await SonarCloud Cleared')).resolves.toBe('token-new');
  });

  it('keys tokens independently per execution', async () => {
    const store = await createStore();
    await store.save('exec-1', 'Await SonarCloud Cleared', 'token-1');
    await store.save('exec-2', 'Await SonarCloud Cleared', 'token-2');
    await expect(store.get('exec-1', 'Await SonarCloud Cleared')).resolves.toBe('token-1');
    await expect(store.get('exec-2', 'Await SonarCloud Cleared')).resolves.toBe('token-2');
  });
});
