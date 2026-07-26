import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { BranchlineDatabase } from './db/BranchlineDatabase';
import { CamundaClient } from './camunda/CamundaClient';
import { GroupMembershipChecker } from './catalog/GroupMembershipChecker';
import { createRouter } from './router';
import { isOwnerGroupMember, workflowInstanceRef } from './permissions';
import { branchlinePermissions } from '@internal/backstage-plugin-branchline-common';

export const branchlinePlugin = createBackendPlugin({
  pluginId: 'branchline',
  register(env) {
    env.registerInit({
      deps: {
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        database: coreServices.database,
        config: coreServices.rootConfig,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
        logger: coreServices.logger,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
        catalog: catalogServiceRef,
      },
      async init({ httpAuth, httpRouter, database, config, auth, discovery, logger, permissions, permissionsRegistry }) {
        const dbClient = await database.getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = await BranchlineDatabase.create(dbClient as any);

        const catalogClient = new CatalogClient({ discoveryApi: discovery });
        const camunda = new CamundaClient(config);
        const membership = new GroupMembershipChecker(catalogClient, auth);

        permissionsRegistry.addResourceType({
          resourceRef: workflowInstanceRef,
          permissions: branchlinePermissions,
          rules: [isOwnerGroupMember],
          getResources: resourceRefs =>
            Promise.all(resourceRefs.map(id => db.getInstance(id).catch(() => undefined))),
        });

        const router = createRouter({ httpAuth, db, camunda, membership, permissions, logger });
        httpRouter.use(router);
        httpRouter.addAuthPolicy({
          path: '/definitions',
          allow: 'unauthenticated',
        });
      },
    });
  },
});
