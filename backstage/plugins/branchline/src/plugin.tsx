import {
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import {
  createFrontendPlugin,
  PageBlueprint,
  ApiBlueprint,
  createApiFactory,
} from '@backstage/frontend-plugin-api';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { createElement } from 'react';
import { branchlineApiRef } from './api/BranchlineApi';
import { BranchlineClient } from './api/BranchlineClient';
import { rootRouteRef } from './routes';
import { taskFormsCollectorExtension } from './taskForms/TaskFormBlueprint';

const branchlineApi = ApiBlueprint.make({
  name: 'branchline-api',
  params: defineParams =>
    defineParams(
      createApiFactory({
        api: branchlineApiRef,
        deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
        factory: ({ discoveryApi, fetchApi }) =>
          new BranchlineClient(discoveryApi, fetchApi),
      }),
    ),
});

const listPage = PageBlueprint.make({
  name: 'list-page',
  params: {
    path: '/branchline',
    routeRef: rootRouteRef,
    title: 'Workflows',
    icon: createElement(AccountTreeIcon),
    loader: async () => {
      const { WorkflowListPage } = await import('./pages/WorkflowListPage');
      return createElement(WorkflowListPage);
    },
  },
});

const detailPage = PageBlueprint.make({
  name: 'detail-page',
  params: {
    path: '/branchline/:workflowId',
    loader: async () => {
      const { WorkflowDetailPage } = await import('./pages/WorkflowDetailPage');
      return createElement(WorkflowDetailPage);
    },
  },
});

export const branchlinePlugin = createFrontendPlugin({
  pluginId: 'branchline',
  extensions: [branchlineApi, listPage, detailPage, taskFormsCollectorExtension],
  routes: {
    root: rootRouteRef,
  },
});
