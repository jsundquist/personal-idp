import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { workflowOrchestratorExtensionPoint } from '@internal/backstage-plugin-branchline-node';
import { CamundaClient } from './CamundaClient';

export const branchlineModuleCamunda = createBackendModule({
  pluginId: 'branchline',
  moduleId: 'camunda',
  register(env) {
    env.registerInit({
      deps: {
        orchestrator: workflowOrchestratorExtensionPoint,
        config: coreServices.rootConfig,
      },
      async init({ orchestrator, config }) {
        orchestrator.setOrchestrator(new CamundaClient(config));
      },
    });
  },
});
