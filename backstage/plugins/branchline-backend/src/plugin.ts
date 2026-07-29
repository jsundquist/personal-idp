import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import type { WorkflowOrchestrator } from '@internal/backstage-plugin-branchline-node';
import { workflowOrchestratorExtensionPoint } from '@internal/backstage-plugin-branchline-node';
import { BranchlineDatabase } from './db/BranchlineDatabase';
import { GroupMembershipChecker } from './catalog/GroupMembershipChecker';
import { createRouter } from './router';
import { isOwnerGroupMember, workflowInstanceRef } from './permissions';
import { branchlinePermissions } from '@internal/backstage-plugin-branchline-common';

export const branchlinePlugin = createBackendPlugin({
  pluginId: 'branchline',
  register(env) {
    let orchestrator: WorkflowOrchestrator | undefined;
    env.registerExtensionPoint(workflowOrchestratorExtensionPoint, {
      setOrchestrator(o) {
        if (orchestrator) {
          throw new Error(
            'A workflow orchestrator has already been registered. Only one ' +
              'orchestrator module (e.g. branchline-backend-module-camunda or ' +
              '-backend-module-step-functions) may be installed at a time.',
          );
        }
        orchestrator = o;
      },
    });

    env.registerInit({
      deps: {
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        database: coreServices.database,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
        logger: coreServices.logger,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
        catalog: catalogServiceRef,
      },
      async init({ httpAuth, httpRouter, database, auth, discovery, logger, permissions, permissionsRegistry }) {
        const dbClient = await database.getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = await BranchlineDatabase.create(dbClient as any);

        const catalogClient = new CatalogClient({ discoveryApi: discovery });
        const membership = new GroupMembershipChecker(catalogClient, auth);

        if (!orchestrator) {
          throw new Error(
            'No workflow orchestrator registered. Install a module such as ' +
              '@internal/backstage-plugin-branchline-backend-module-camunda or ' +
              '@internal/backstage-plugin-branchline-backend-module-step-functions.',
          );
        }

        permissionsRegistry.addResourceType({
          resourceRef: workflowInstanceRef,
          permissions: branchlinePermissions,
          rules: [isOwnerGroupMember],
          getResources: resourceRefs =>
            Promise.all(resourceRefs.map(id => db.getInstance(id).catch(() => undefined))),
        });

        const router = createRouter({ httpAuth, db, orchestrator, membership, permissions, logger });
        httpRouter.use(router);
        httpRouter.addAuthPolicy({
          path: '/definitions',
          allow: 'unauthenticated',
        });
      },
    });
  },
});
