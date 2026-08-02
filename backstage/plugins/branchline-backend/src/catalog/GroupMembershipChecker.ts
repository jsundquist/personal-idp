import { AuthService } from '@backstage/backend-plugin-api';
import { CatalogApi } from '@backstage/catalog-client';
import { GroupEntity, UserEntity } from '@backstage/catalog-model';

interface CachedGroups {
  groups: string[];
  expiresAt: number;
}

const GROUPS_CACHE_TTL_MS = 60_000;

export class GroupMembershipChecker {
  private readonly groupsCache = new Map<string, CachedGroups>();

  constructor(
    private readonly catalog: CatalogApi,
    private readonly auth: AuthService,
  ) {}

  async isMember(userEntityRef: string, groupEntityRef: string): Promise<boolean> {
    const { token } = await this.auth.getPluginRequestToken({
      onBehalfOf: await this.auth.getOwnServiceCredentials(),
      targetPluginId: 'catalog',
    });

    const group = await this.catalog.getEntityByRef(groupEntityRef, { token });
    if (!group) {
      return false;
    }

    const groupEntity = group as GroupEntity;
    const members: string[] = groupEntity.spec?.members ?? [];

    // Normalize entity refs for comparison — strip "user:default/" prefix when matching
    const normalizedUser = this.normalizeRef(userEntityRef);
    return members.some(m => this.normalizeRef(m) === normalizedUser);
  }

  async getGroupsForUser(userEntityRef: string): Promise<string[]> {
    const cached = this.groupsCache.get(userEntityRef);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.groups;
    }

    const { token } = await this.auth.getPluginRequestToken({
      onBehalfOf: await this.auth.getOwnServiceCredentials(),
      targetPluginId: 'catalog',
    });
    const userEntity = await this.catalog.getEntityByRef(userEntityRef, { token });
    const memberOf: string[] = userEntity
      ? ((userEntity as UserEntity).spec?.memberOf ?? []).map(g => (g.includes(':') ? g : `group:default/${g}`))
      : [];

    this.groupsCache.set(userEntityRef, { groups: memberOf, expiresAt: Date.now() + GROUPS_CACHE_TTL_MS });
    return memberOf;
  }

  private normalizeRef(ref: string): string {
    // Handle "user:default/alice" -> "alice" and "alice" -> "alice"
    const parts = ref.split('/');
    return parts[parts.length - 1].toLowerCase();
  }
}
