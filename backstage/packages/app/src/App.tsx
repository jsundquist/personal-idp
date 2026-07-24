import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import kubernetesPlugin from '@backstage/plugin-kubernetes/alpha';
import { topologyCatalogModule } from '@backstage-community/plugin-topology/alpha';
import { navModule } from './modules/nav';

export default createApp({
  features: [catalogPlugin, kubernetesPlugin, topologyCatalogModule, navModule],
});
