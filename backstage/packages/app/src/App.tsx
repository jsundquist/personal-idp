import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import kubernetesPlugin from '@backstage/plugin-kubernetes/alpha';
import { topologyCatalogModule } from '@backstage-community/plugin-topology/alpha';
import argoCdPlugin from '@roadiehq/backstage-plugin-argo-cd/alpha';
import branchlinePlugin from '@internal/backstage-plugin-branchline';
import { navModule } from './modules/nav';

export default createApp({
  features: [
    catalogPlugin,
    kubernetesPlugin,
    topologyCatalogModule,
    argoCdPlugin,
    branchlinePlugin,
    navModule,
  ],
});
