import { HttpAuthService, LoggerService, PermissionsService } from '@backstage/backend-plugin-api';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { InputError, NotAllowedError } from '@backstage/errors';
import { branchlineWorkflowActPermission } from '@internal/backstage-plugin-branchline-common';
import express from 'express';
import Router from 'express-promise-router';
import { z } from 'zod/v3';
import { CamundaClient } from './camunda/CamundaClient';
import { GroupMembershipChecker } from './catalog/GroupMembershipChecker';
import { BranchlineDatabase } from './db/BranchlineDatabase';
import type { FlowGraph, ParallelBlock } from './types';

const startWorkflowSchema = z.object({
  definitionId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  owningGroup: z.string().min(1),
  entityRef: z.string().optional(),
});

const skipSchema = z.object({
  reason: z.string().min(1, 'Skip reason is required'),
});

export function createRouter(opts: {
  httpAuth: HttpAuthService;
  db: BranchlineDatabase;
  camunda: CamundaClient;
  membership: GroupMembershipChecker;
  permissions: PermissionsService;
  logger: LoggerService;
}): express.Router {
  const { httpAuth, db, camunda, membership, permissions, logger } = opts;
  const router = Router();
  router.use(express.json());

  // GET /definitions — list Camunda process definitions
  router.get('/definitions', async (_req, res) => {
    try {
      const defs = await camunda.listDefinitions();
      const latest = new Map<string, typeof defs[number]>();
      for (const d of defs) {
        const existing = latest.get(d.bpmnProcessId);
        if (!existing || d.version > existing.version) {
          latest.set(d.bpmnProcessId, d);
        }
      }
      res.json(
        Array.from(latest.values()).map(d => ({
          id: d.bpmnProcessId,
          name: d.name,
          version: d.version,
        })),
      );
    } catch (err) {
      logger.warn('Failed to fetch Camunda definitions, returning empty list', err as Error);
      res.json([]);
    }
  });

  // GET /workflows — list workflow instances (optionally filtered by entityRef)
  router.get('/workflows', async (req, res) => {
    const { entityRef } = req.query as { entityRef?: string };
    const instances = entityRef
      ? await db.listInstancesByEntityRef(entityRef)
      : await db.listInstances();
    let progressMap = new Map<string, { completedPhases: number; totalPhases: number }>();
    try {
      progressMap = await camunda.getFlownodeProgress(instances.map(i => i.camundaKey));
    } catch (err) {
      logger.warn('Failed to fetch phase progress from Camunda', err as Error);
    }
    res.json(
      instances.map(i => ({
        ...i,
        ...(progressMap.get(i.camundaKey) ?? { completedPhases: 0, totalPhases: 0 }),
      })),
    );
  });

  // GET /workflows/mine — list instances owned by groups the requesting user belongs to
  // Must be registered before GET /workflows/:id to avoid treating "mine" as an ID.
  router.get('/workflows/mine', async (req, res) => {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const groups = await membership.getGroupsForUser(credentials.principal.userEntityRef);
    const instances = await db.listInstancesByOwningGroups(groups);
    res.json(instances);
  });

  // POST /workflows — start a new workflow instance
  router.post('/workflows', async (req, res) => {
    const parsed = startWorkflowSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InputError(parsed.error.toString());
    }

    const { definitionId, title, description, owningGroup, entityRef } = parsed.data;

    let camundaKey: string;
    try {
      const result = await camunda.startInstance({
        processDefinitionId: definitionId,
        variables: { branchlineTitle: title, branchlineOwner: owningGroup },
      });
      camundaKey = result.processInstanceKey;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      logger.error('Failed to start Camunda process instance', err as Error);
      throw new Error(`Failed to start workflow in Camunda: ${msg}`);
    }

    const instance = await db.createInstance(
      { definitionId, title, description, owningGroup, entityRef },
      camundaKey,
    );
    res.status(201).json(instance);
  });

  // GET /workflows/:id — get instance with full task hierarchy
  router.get('/workflows/:id', async (req, res) => {
    let instance = await db.getInstance(req.params.id);
    const actions = await db.getActionsForInstance(instance.id);

    const actionPayload = actions.map(a => ({
      taskId: a.taskId,
      action: a.action,
      actor: a.actor,
      skipReason: a.skipReason,
      occurredAt: a.occurredAt,
    }));

    let parallelBlocks: ParallelBlock[] = [];
    let flowGraph: FlowGraph | undefined;
    try {
      [parallelBlocks, flowGraph] = await Promise.all([
        camunda.buildHierarchy(instance.definitionId, instance.camundaKey, actionPayload),
        camunda.buildFlowGraph(instance.definitionId, instance.camundaKey, actionPayload),
      ]);
    } catch (err) {
      logger.warn(`Failed to build task hierarchy for ${instance.id}`, err as Error);
    }

    // Auto-complete: if all phases are done and the DB still says active, update it.
    if (instance.status === 'active' && parallelBlocks.length > 0) {
      const allDone = parallelBlocks.every(block =>
        block.steps.every(step =>
          step.tasks.every(
            t => t.status === 'completed' || t.status === 'skipped' || t.status === 'not-taken',
          ),
        ),
      );
      if (allDone) {
        await db.updateInstanceStatus(instance.id, 'completed');
        instance = { ...instance, status: 'completed' };
      }
    }

    res.json({ ...instance, parallelBlocks, flowGraph });
  });

  // POST /workflows/:id/cancel
  router.post('/workflows/:id/cancel', async (req, res) => {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });

    const [decision] = await permissions.authorize(
      [{ permission: branchlineWorkflowActPermission, resourceRef: req.params.id }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError('You do not have permission to cancel this workflow');
    }

    const instance = await db.getInstance(req.params.id);

    if (instance.status !== 'active') {
      throw new InputError(`Workflow is already ${instance.status} and cannot be cancelled`);
    }

    try {
      await camunda.cancelInstance(instance.camundaKey);
    } catch (err) {
      logger.warn(`Failed to cancel Camunda process instance for ${instance.id}`, err as Error);
    }

    await db.updateInstanceStatus(instance.id, 'cancelled');
    res.json({ status: 'cancelled' });
  });

  // POST /workflows/:id/tasks/:taskId/complete
  router.post('/workflows/:id/tasks/:taskId/complete', async (req, res) => {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const userEntityRef = credentials.principal.userEntityRef;

    const [decision] = await permissions.authorize(
      [{ permission: branchlineWorkflowActPermission, resourceRef: req.params.id }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError('You do not have permission to complete tasks on this workflow');
    }

    const instance = await db.getInstance(req.params.id);

    // Resolve the element instance and complete via the appropriate Camunda API.
    // bpmn:userTask elements in Camunda 8.6+ are Camunda user tasks (no jobKey);
    // older job-worker-style tasks carry a jobKey.
    try {
      const elements = await camunda.getElementInstances(instance.camundaKey);
      const el = elements.find(e => e.flowNodeId === req.params.taskId && e.state === 'ACTIVE');
      if (el) {
        if (el.jobKey) {
          await camunda.completeJob(el.jobKey);
        } else {
          await camunda.completeUserTask(instance.camundaKey, req.params.taskId);
        }
      }
    } catch (err) {
      logger.warn('Could not signal task completion to Camunda', err as Error);
    }

    const record = await db.recordAction({
      instanceId: instance.id,
      taskId: req.params.taskId,
      action: 'completed',
      actor: userEntityRef,
    });
    res.json(record);
  });

  // POST /workflows/:id/tasks/:taskId/skip
  router.post('/workflows/:id/tasks/:taskId/skip', async (req, res) => {
    const parsed = skipSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InputError(parsed.error.toString());
    }

    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const userEntityRef = credentials.principal.userEntityRef;

    const [decision] = await permissions.authorize(
      [{ permission: branchlineWorkflowActPermission, resourceRef: req.params.id }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError('You do not have permission to skip tasks on this workflow');
    }

    const instance = await db.getInstance(req.params.id);

    // Complete the job in Camunda with a skipReason variable
    try {
      const elements = await camunda.getElementInstances(instance.camundaKey);
      const el = elements.find(e => e.flowNodeId === req.params.taskId && e.state === 'ACTIVE');
      if (el) {
        const vars = { branchlineSkipped: true, branchlineSkipReason: parsed.data.reason };
        if (el.jobKey) {
          await camunda.completeJob(el.jobKey, vars);
        } else {
          await camunda.completeUserTask(instance.camundaKey, req.params.taskId, vars);
        }
      }
    } catch (err) {
      logger.warn('Could not signal task skip to Camunda', err as Error);
    }

    const record = await db.recordAction({
      instanceId: instance.id,
      taskId: req.params.taskId,
      action: 'skipped',
      actor: userEntityRef,
      skipReason: parsed.data.reason,
    });
    res.json(record);
  });

  return router;
}
