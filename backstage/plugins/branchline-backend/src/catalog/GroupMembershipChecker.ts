import { AuthService } from '@backstage/backend-plugin-api';
import { CatalogApi } from '@backstage/catalog-client';
import { GroupEntity, UserEntity } from '@backstage/catalog-model';

export class GroupMembershipChecker {
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
    const { token } = await this.auth.getPluginRequestToken({
      onBehalfOf: await this.auth.getOwnServiceCredentials(),
      targetPluginId: 'catalog',
    });
    const userEntity = await this.catalog.getEntityByRef(userEntityRef, { token });
    if (!userEntity) return [];
    const memberOf: string[] = (userEntity as UserEntity).spec?.memberOf ?? [];
    return memberOf.map(g => (g.includes(':') ? g : `group:default/${g}`));
  }

  private normalizeRef(ref: string): string {
    // Handle "user:default/alice" -> "alice" and "alice" -> "alice"
    const parts = ref.split('/');
    return parts[parts.length - 1].toLowerCase();
  }
}
