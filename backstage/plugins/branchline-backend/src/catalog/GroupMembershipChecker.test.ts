import { GroupMembershipChecker } from './GroupMembershipChecker';

function buildDeps(memberOf: string[] = ['group:default/arb']) {
  const getEntityByRef = jest.fn().mockResolvedValue({
    kind: 'User',
    spec: { memberOf },
  });
  const catalog = { getEntityByRef } as any;
  const auth = {
    getOwnServiceCredentials: jest.fn().mockResolvedValue({}),
    getPluginRequestToken: jest.fn().mockResolvedValue({ token: 'tok' }),
  } as any;
  return { catalog, auth, getEntityByRef };
}

describe('GroupMembershipChecker.getGroupsForUser caching', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('serves a second call within the TTL from cache, without re-fetching', async () => {
    const { catalog, auth, getEntityByRef } = buildDeps();
    const checker = new GroupMembershipChecker(catalog, auth);

    const first = await checker.getGroupsForUser('user:default/alice');
    const second = await checker.getGroupsForUser('user:default/alice');

    expect(first).toEqual(['group:default/arb']);
    expect(second).toEqual(['group:default/arb']);
    expect(getEntityByRef).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after the TTL expires', async () => {
    jest.useFakeTimers({ now: 0 });
    const { catalog, auth, getEntityByRef } = buildDeps();
    const checker = new GroupMembershipChecker(catalog, auth);

    await checker.getGroupsForUser('user:default/alice');
    jest.advanceTimersByTime(60_001);
    await checker.getGroupsForUser('user:default/alice');

    expect(getEntityByRef).toHaveBeenCalledTimes(2);
  });

  it('caches an empty result for a user not found in the catalog', async () => {
    const getEntityByRef = jest.fn().mockResolvedValue(undefined);
    const catalog = { getEntityByRef } as any;
    const auth = {
      getOwnServiceCredentials: jest.fn().mockResolvedValue({}),
      getPluginRequestToken: jest.fn().mockResolvedValue({ token: 'tok' }),
    } as any;
    const checker = new GroupMembershipChecker(catalog, auth);

    expect(await checker.getGroupsForUser('user:default/ghost')).toEqual([]);
    expect(await checker.getGroupsForUser('user:default/ghost')).toEqual([]);
    expect(getEntityByRef).toHaveBeenCalledTimes(1);
  });
});
