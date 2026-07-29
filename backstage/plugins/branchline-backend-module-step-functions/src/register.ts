import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError } from '@backstage/errors';
import { workflowOrchestratorExtensionPoint } from '@internal/backstage-plugin-branchline-node';
import express from 'express';
import Router from 'express-promise-router';
import { z } from 'zod/v3';
import { StepFunctionsOrchestrator } from './StepFunctionsOrchestrator';
import { TaskTokenStore } from './TaskTokenStore';

const tokenCallbackSchema = z.object({
  executionArn: z.string().min(1),
  stateName: z.string().min(1),
  taskToken: z.string().min(1),
});

/**
 * Route the state machine's `waitForTaskToken` Lambda calls to hand Branchline
 * the token it was just given — Step Functions has no API to re-list or
 * re-query an outstanding token later, so it must be captured here, at mint
 * time. Authenticated with a shared secret (branchline.stepFunctions.callbackToken)
 * since the caller is a Lambda, not a Backstage user; tighten this (mTLS,
 * SigV4, a VPC-only listener, …) for a production deployment.
 */
function createTokenCallbackRouter(opts: {
  tokenStore: TaskTokenStore;
  callbackToken?: string;
}): express.Router {
  const router = Router();
  router.use(express.json());

  router.post('/step-functions/tasks/token', async (req, res) => {
    if (opts.callbackToken) {
      const provided = req.header('authorization')?.replace(/^Bearer\s+/i, '');
      if (provided !== opts.callbackToken) {
        throw new NotAllowedError('Invalid or missing callback token');
      }
    }
    const parsed = tokenCallbackSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InputError(parsed.error.toString());
    }
    await opts.tokenStore.save(parsed.data.executionArn, parsed.data.stateName, parsed.data.taskToken);
    res.status(204).end();
  });

  return router;
}

export const branchlineModuleStepFunctions = createBackendModule({
  pluginId: 'branchline',
  moduleId: 'step-functions',
  register(env) {
    env.registerInit({
      deps: {
        orchestrator: workflowOrchestratorExtensionPoint,
        config: coreServices.rootConfig,
        database: coreServices.database,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      async init({ orchestrator, config, database, httpRouter, logger }) {
        const dbClient = await database.getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tokenStore = await TaskTokenStore.create(dbClient as any);

        const callbackToken = config.getOptionalString('branchline.stepFunctions.callbackToken');
        if (!callbackToken) {
          logger.warn(
            'branchline.stepFunctions.callbackToken is not set — the task-token ' +
              'callback endpoint is unauthenticated. Set it before deploying to production.',
          );
        }
        httpRouter.use(createTokenCallbackRouter({ tokenStore, callbackToken }));

        orchestrator.setOrchestrator(new StepFunctionsOrchestrator(config, tokenStore));
      },
    });
  },
});
