import { resolvePackagePath } from '@backstage/backend-plugin-api';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import type {
  WorkflowInstance,
  TaskActionRecord,
  StartWorkflowRequest,
  TaskAction,
  FeedbackItem,
  FeedbackComment,
  FeedbackCounts,
} from '../types';

const migrationsDir = resolvePackagePath(
  '@internal/backstage-plugin-branchline-backend',
  'migrations',
);

export class BranchlineDatabase {
  private constructor(private readonly db: Knex) {}

  static async create(db: Knex): Promise<BranchlineDatabase> {
    await db.migrate.latest({ directory: migrationsDir });
    return new BranchlineDatabase(db);
  }

  async createInstance(
    req: StartWorkflowRequest,
    orchestratorInstanceKey: string,
    createdBy?: string,
  ): Promise<WorkflowInstance> {
    const id = uuidv4();
    const now = new Date().toISOString();

    // If this key already exists (e.g. the orchestrator was reset in dev), retire the stale record first.
    await this.db('workflow_instances')
      .where({ orchestrator_instance_key: orchestratorInstanceKey })
      .update({ status: 'cancelled', updated_at: now });

    await this.db('workflow_instances').insert({
      id,
      orchestrator_instance_key: orchestratorInstanceKey,
      definition_id: req.definitionId,
      title: req.title,
      description: req.description ?? null,
      owning_group: req.owningGroup,
      entity_ref: req.entityRef ?? null,
      created_by: createdBy ?? null,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    return this.getInstance(id);
  }

  async getInstance(id: string): Promise<WorkflowInstance> {
    const row = await this.db('workflow_instances').where({ id }).first();
    if (!row) {
      throw new Error(`Workflow instance '${id}' not found`);
    }
    return this.rowToInstance(row);
  }

  async getInstanceByOrchestratorKey(orchestratorInstanceKey: string): Promise<WorkflowInstance> {
    const row = await this.db('workflow_instances')
      .where({ orchestrator_instance_key: orchestratorInstanceKey })
      .first();
    if (!row) {
      throw new Error(`Workflow instance with orchestrator key '${orchestratorInstanceKey}' not found`);
    }
    return this.rowToInstance(row);
  }

  async listInstances(): Promise<WorkflowInstance[]> {
    const rows = await this.db('workflow_instances').orderBy(
      'created_at',
      'desc',
    );
    return rows.map(r => this.rowToInstance(r));
  }

  async listInstancesByEntityRef(entityRef: string): Promise<WorkflowInstance[]> {
    const rows = await this.db('workflow_instances')
      .where('entity_ref', entityRef)
      .orderBy('created_at', 'desc');
    return rows.map(r => this.rowToInstance(r));
  }

  async listInstancesByOwningGroups(groups: string[]): Promise<WorkflowInstance[]> {
    if (groups.length === 0) return [];
    const rows = await this.db('workflow_instances')
      .whereIn('owning_group', groups)
      .orderBy('created_at', 'desc');
    return rows.map(r => this.rowToInstance(r));
  }

  async updateInstanceStatus(
    id: string,
    status: WorkflowInstance['status'],
  ): Promise<void> {
    await this.db('workflow_instances')
      .where({ id })
      .update({ status, updated_at: new Date().toISOString() });
  }

  async recordAction(opts: {
    instanceId: string;
    taskId: string;
    action: TaskAction;
    actor: string;
    skipReason?: string;
  }): Promise<TaskActionRecord> {
    const id = uuidv4();
    const now = new Date().toISOString();
    await this.db('task_actions').insert({
      id,
      instance_id: opts.instanceId,
      task_id: opts.taskId,
      action: opts.action,
      actor: opts.actor,
      skip_reason: opts.skipReason ?? null,
      occurred_at: now,
    });
    return {
      id,
      instanceId: opts.instanceId,
      taskId: opts.taskId,
      action: opts.action,
      actor: opts.actor,
      skipReason: opts.skipReason,
      occurredAt: now,
    };
  }

  async getActionsForInstance(instanceId: string): Promise<TaskActionRecord[]> {
    const rows = await this.db('task_actions')
      .where({ instance_id: instanceId })
      .orderBy('occurred_at', 'asc');
    return rows.map(r => ({
      id: r.id,
      instanceId: r.instance_id,
      taskId: r.task_id,
      action: r.action as TaskAction,
      actor: r.actor,
      skipReason: r.skip_reason ?? undefined,
      occurredAt: r.occurred_at,
    }));
  }

  // ── Approval-gate feedback ─────────────────────────────────────────────────

  async createFeedback(opts: {
    instanceId: string;
    taskId: string;
    authorGroup: string;
    author: string;
    body: string;
  }): Promise<FeedbackItem> {
    const id = uuidv4();
    const now = new Date().toISOString();
    await this.db('feedback_items').insert({
      id,
      instance_id: opts.instanceId,
      task_id: opts.taskId,
      author_group: opts.authorGroup,
      author: opts.author,
      body: opts.body,
      status: 'open',
      created_at: now,
      updated_at: now,
    });
    return this.getFeedback(id);
  }

  async getFeedback(id: string): Promise<FeedbackItem> {
    const row = await this.db('feedback_items').where({ id }).first();
    if (!row) {
      throw new Error(`Feedback item '${id}' not found`);
    }
    const comments = await this.db('feedback_comments')
      .where({ feedback_id: id })
      .orderBy('created_at', 'asc');
    return this.rowToFeedback(row, comments.map(c => this.rowToComment(c)));
  }

  async listFeedbackForTask(
    instanceId: string,
    taskId: string,
  ): Promise<FeedbackItem[]> {
    const items = await this.db('feedback_items')
      .where({ instance_id: instanceId, task_id: taskId })
      .orderBy('created_at', 'asc');
    if (items.length === 0) {
      return [];
    }
    const comments = await this.db('feedback_comments')
      .whereIn(
        'feedback_id',
        items.map(i => i.id),
      )
      .orderBy('created_at', 'asc');
    const byFeedback = new Map<string, FeedbackComment[]>();
    for (const c of comments) {
      const list = byFeedback.get(c.feedback_id) ?? [];
      list.push(this.rowToComment(c));
      byFeedback.set(c.feedback_id, list);
    }
    return items.map(row => this.rowToFeedback(row, byFeedback.get(row.id) ?? []));
  }

  async feedbackCountsForTask(
    instanceId: string,
    taskId: string,
  ): Promise<FeedbackCounts> {
    const rows = await this.db('feedback_items')
      .where({ instance_id: instanceId, task_id: taskId })
      .select('status');
    return {
      total: rows.length,
      open: rows.filter(r => r.status === 'open').length,
    };
  }

  async listFeedbackForInstance(instanceId: string): Promise<FeedbackItem[]> {
    // Milestones only — the audit trail does not need comment threads, so this
    // returns items with an empty comments array (avoids the extra query).
    const items = await this.db('feedback_items')
      .where({ instance_id: instanceId })
      .orderBy('created_at', 'asc');
    return items.map(row => this.rowToFeedback(row, []));
  }

  async feedbackCountsForInstance(
    instanceId: string,
  ): Promise<Record<string, FeedbackCounts>> {
    const rows = await this.db('feedback_items')
      .where({ instance_id: instanceId })
      .select('task_id', 'status');
    const map: Record<string, FeedbackCounts> = {};
    for (const r of rows) {
      const counts = map[r.task_id] ?? { open: 0, total: 0 };
      counts.total += 1;
      if (r.status === 'open') {
        counts.open += 1;
      }
      map[r.task_id] = counts;
    }
    return map;
  }

  async addComment(opts: {
    feedbackId: string;
    author: string;
    body: string;
  }): Promise<FeedbackComment> {
    const id = uuidv4();
    const now = new Date().toISOString();
    await this.db('feedback_comments').insert({
      id,
      feedback_id: opts.feedbackId,
      author: opts.author,
      body: opts.body,
      created_at: now,
    });
    // Touch the parent item so listings reflect recent activity.
    await this.db('feedback_items')
      .where({ id: opts.feedbackId })
      .update({ updated_at: now });
    return {
      id,
      feedbackId: opts.feedbackId,
      author: opts.author,
      body: opts.body,
      createdAt: now,
    };
  }

  async closeFeedback(opts: {
    feedbackId: string;
    status: 'resolved' | 'exception';
    closedBy: string;
    exceptionReason?: string;
  }): Promise<FeedbackItem> {
    const now = new Date().toISOString();
    await this.db('feedback_items')
      .where({ id: opts.feedbackId })
      .update({
        status: opts.status,
        closed_by: opts.closedBy,
        closed_at: now,
        exception_reason: opts.exceptionReason ?? null,
        updated_at: now,
      });
    return this.getFeedback(opts.feedbackId);
  }

  private rowToFeedback(
    row: Record<string, unknown>,
    comments: FeedbackComment[],
  ): FeedbackItem {
    return {
      id: row.id as string,
      instanceId: row.instance_id as string,
      taskId: row.task_id as string,
      authorGroup: row.author_group as string,
      author: row.author as string,
      body: row.body as string,
      status: row.status as FeedbackItem['status'],
      closedBy: (row.closed_by as string | null) ?? undefined,
      closedAt: (row.closed_at as string | null) ?? undefined,
      exceptionReason: (row.exception_reason as string | null) ?? undefined,
      comments,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToComment(row: Record<string, unknown>): FeedbackComment {
    return {
      id: row.id as string,
      feedbackId: row.feedback_id as string,
      author: row.author as string,
      body: row.body as string,
      createdAt: row.created_at as string,
    };
  }

  private rowToInstance(row: Record<string, unknown>): WorkflowInstance {
    return {
      id: row.id as string,
      orchestratorInstanceKey: row.orchestrator_instance_key as string,
      definitionId: row.definition_id as string,
      title: row.title as string,
      description: (row.description as string | null) ?? undefined,
      owningGroup: row.owning_group as string,
      entityRef: (row.entity_ref as string | null) ?? undefined,
      status: row.status as WorkflowInstance['status'],
      createdBy: (row.created_by as string | null) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
