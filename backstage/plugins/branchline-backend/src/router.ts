import { HttpAuthService, LoggerService, PermissionsService } from '@backstage/backend-plugin-api';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { ConflictError, InputError, NotAllowedError } from '@backstage/errors';
import { branchlineWorkflowActPermission } from '@internal/backstage-plugin-branchline-common';
import express from 'express';
import Router from 'express-promise-router';
import { z } from 'zod/v3';
import { CamundaClient } from './camunda/CamundaClient';
import { GroupMembershipChecker } from './catalog/GroupMembershipChecker';
import { BranchlineDatabase } from './db/BranchlineDatabase';
import { AuditEventType } from './types';
import type { AuditEvent, FlowGraph, ParallelBlock } from './types';

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

// Compare group refs by their short name — candidateGroups in BPMN are bare
// names ("arb"); getGroupsForUser returns full refs ("group:default/arb").
const shortGroupName = (ref: string): string =>
  ref.split('/').pop()!.toLowerCase();

const feedbackSchema = z.object({
  body: z.string().min(1, 'Feedback body is required'),
});

const commentSchema = z.object({
  body: z.string().min(1, 'Comment body is required'),
});

const closeFeedbackSchema = z
  .object({
    status: z.enum(['resolved', 'exception']),
    exceptionReason: z.string().optional(),
  })
  .refine(
    d =>
      d.status !== 'exception' ||
      (typeof d.exceptionReason === 'string' && d.exceptionReason.trim().length > 0),
    { message: 'An exception requires a reason', path: ['exceptionReason'] },
  );

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

  // Authorize the "act" permission (owning-group member) on an instance and
  // return the acting user's entity ref. Used by gate actions + feedback closure.
  async function authorizeAct(
    req: express.Request,
    instanceId: string,
    deniedMessage: string,
  ): Promise<string> {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const [decision] = await permissions.authorize(
      [{ permission: branchlineWorkflowActPermission, resourceRef: instanceId }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError(deniedMessage);
    }
    return credentials.principal.userEntityRef;
  }

  // Enforce the task's Camunda candidateGroups: a task with candidate groups can
  // only be acted on by a member of one of them; an ungrouped task is self-serve.
  async function assertCanActOnTask(
    userEntityRef: string,
    definitionId: string,
    taskId: string,
  ): Promise<void> {
    const groups = await camunda.getTaskCandidateGroups(definitionId, taskId);
    if (groups.length === 0) {
      return;
    }
    const userGroups = await membership.getGroupsForUser(userEntityRef);
    const userShort = new Set(userGroups.map(shortGroupName));
    if (!groups.some(g => userShort.has(shortGroupName(g)))) {
      throw new NotAllowedError(
        `This task is restricted to members of: ${groups.join(', ')}`,
      );
    }
  }

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

    // Record who started the workflow (for the audit trail's kickoff event).
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const createdBy = credentials.principal.userEntityRef;

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
      createdBy,
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

    // Attach approval-gate feedback tallies to each task (keyed by BPMN flowNodeId).
    try {
      const feedbackByTask = await db.feedbackCountsForInstance(instance.id);
      for (const block of parallelBlocks) {
        for (const step of block.steps) {
          for (const task of step.tasks) {
            const counts = feedbackByTask[task.id];
            if (counts) {
              task.feedbackCounts = counts;
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`Failed to attach feedback counts for ${instance.id}`, err as Error);
    }

    // Compute per-task canAct for the requesting user from each task's candidateGroups.
    try {
      const credentials = await httpAuth.credentials(req, { allow: ['user'] });
      const userGroups = await membership.getGroupsForUser(credentials.principal.userEntityRef);
      const userShort = new Set(userGroups.map(shortGroupName));
      for (const block of parallelBlocks) {
        for (const step of block.steps) {
          for (const task of step.tasks) {
            const groups = task.candidateGroups ?? [];
            task.canAct =
              groups.length === 0 || groups.some(g => userShort.has(shortGroupName(g)));
          }
        }
      }
    } catch (err) {
      logger.warn(`Failed to compute per-task canAct for ${instance.id}`, err as Error);
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

    // Per-task team gate: only members of the task's candidateGroups may act.
    await assertCanActOnTask(userEntityRef, instance.definitionId, req.params.taskId);

    // Completion-blocking rule: a gate cannot be completed while it has open
    // feedback. Every feedback item must be resolved or excepted first.
    const counts = await db.feedbackCountsForTask(instance.id, req.params.taskId);
    if (counts.open > 0) {
      throw new ConflictError(
        `Cannot complete this task: ${counts.open} open feedback item(s) must be resolved or granted an exception first`,
      );
    }

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

    // Per-task team gate: only members of the task's candidateGroups may act.
    await assertCanActOnTask(userEntityRef, instance.definitionId, req.params.taskId);

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

  // ── Approval-gate feedback ─────────────────────────────────────────────────

  // GET /workflows/:id/tasks/:taskId/feedback — list items + counts for a task
  router.get('/workflows/:id/tasks/:taskId/feedback', async (req, res) => {
    // Any authenticated user who can view the workflow may read feedback.
    await httpAuth.credentials(req, { allow: ['user'] });
    const [items, counts] = await Promise.all([
      db.listFeedbackForTask(req.params.id, req.params.taskId),
      db.feedbackCountsForTask(req.params.id, req.params.taskId),
    ]);
    res.json({ items, counts });
  });

  // POST /workflows/:id/tasks/:taskId/feedback — owning team logs feedback
  router.post('/workflows/:id/tasks/:taskId/feedback', async (req, res) => {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InputError(parsed.error.toString());
    }
    const author = await authorizeAct(
      req,
      req.params.id,
      'You do not have permission to add feedback on this workflow',
    );
    const instance = await db.getInstance(req.params.id);
    // Only the task's candidate group may log feedback on it.
    await assertCanActOnTask(author, instance.definitionId, req.params.taskId);
    const item = await db.createFeedback({
      instanceId: instance.id,
      taskId: req.params.taskId,
      authorGroup: instance.owningGroup,
      author,
      body: parsed.data.body,
    });
    res.status(201).json(item);
  });

  // POST /workflows/:id/feedback/:feedbackId/comments — any participant comments
  router.post('/workflows/:id/feedback/:feedbackId/comments', async (req, res) => {
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InputError(parsed.error.toString());
    }
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const author = credentials.principal.userEntityRef;

    const feedback = await db.getFeedback(req.params.feedbackId);
    if (feedback.instanceId !== req.params.id) {
      throw new InputError('Feedback item does not belong to this workflow');
    }
    const comment = await db.addComment({
      feedbackId: feedback.id,
      author,
      body: parsed.data.body,
    });
    res.status(201).json(comment);
  });

  // PATCH /workflows/:id/feedback/:feedbackId — resolve / grant exception (owning team)
  router.patch('/workflows/:id/feedback/:feedbackId', async (req, res) => {
    const parsed = closeFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InputError(parsed.error.toString());
    }
    const closedBy = await authorizeAct(
      req,
      req.params.id,
      'You do not have permission to close feedback on this workflow',
    );

    const feedback = await db.getFeedback(req.params.feedbackId);
    if (feedback.instanceId !== req.params.id) {
      throw new InputError('Feedback item does not belong to this workflow');
    }
    // Only the task's candidate group may resolve/except its feedback.
    const patchInstance = await db.getInstance(req.params.id);
    await assertCanActOnTask(closedBy, patchInstance.definitionId, feedback.taskId);
    if (feedback.status !== 'open') {
      throw new ConflictError(`Feedback item is already ${feedback.status}`);
    }
    const updated = await db.closeFeedback({
      feedbackId: feedback.id,
      status: parsed.data.status,
      closedBy,
      exceptionReason: parsed.data.exceptionReason,
    });
    res.json(updated);
  });

  // GET /workflows/:id/audit — time-sorted milestone timeline for the workflow
  router.get('/workflows/:id/audit', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user'] });
    const instance = await db.getInstance(req.params.id);
    const [actions, feedback] = await Promise.all([
      db.getActionsForInstance(instance.id),
      db.listFeedbackForInstance(instance.id),
    ]);

    const events: AuditEvent[] = [];

    events.push({
      type: AuditEventType.WorkflowStarted,
      timestamp: instance.createdAt,
      actor: instance.createdBy,
    });

    for (const a of actions) {
      events.push({
        type:
          a.action === 'skipped'
            ? AuditEventType.TaskSkipped
            : AuditEventType.TaskCompleted,
        timestamp: a.occurredAt,
        actor: a.actor,
        taskId: a.taskId,
        detail: a.skipReason,
      });
    }

    for (const f of feedback) {
      events.push({
        type: AuditEventType.FeedbackCreated,
        timestamp: f.createdAt,
        actor: f.author,
        taskId: f.taskId,
        detail: f.body,
      });
      if (f.status !== 'open' && f.closedAt) {
        events.push({
          type:
            f.status === 'exception'
              ? AuditEventType.FeedbackException
              : AuditEventType.FeedbackResolved,
          timestamp: f.closedAt,
          actor: f.closedBy,
          taskId: f.taskId,
          detail: f.status === 'exception' ? f.exceptionReason : undefined,
        });
      }
    }

    if (instance.status === 'completed') {
      events.push({
        type: AuditEventType.WorkflowCompleted,
        timestamp: instance.updatedAt,
      });
    } else if (instance.status === 'cancelled') {
      events.push({
        type: AuditEventType.WorkflowCancelled,
        timestamp: instance.updatedAt,
      });
    }

    // ISO-8601 timestamps sort correctly as strings.
    events.sort((x, y) => x.timestamp.localeCompare(y.timestamp));
    res.json(events);
  });

  return router;
}
