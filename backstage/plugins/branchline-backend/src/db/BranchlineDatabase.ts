import { resolvePackagePath } from '@backstage/backend-plugin-api';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import type {
  WorkflowInstance,
  TaskActionRecord,
  StartWorkflowRequest,
  TaskAction,
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
    camundaKey: string,
  ): Promise<WorkflowInstance> {
    const id = uuidv4();
    const now = new Date().toISOString();

    // If camundaKey already exists (e.g. Camunda reset in dev), retire the stale record first.
    await this.db('workflow_instances')
      .where({ camunda_key: camundaKey })
      .update({ status: 'cancelled', updated_at: now });

    await this.db('workflow_instances').insert({
      id,
      camunda_key: camundaKey,
      definition_id: req.definitionId,
      title: req.title,
      description: req.description ?? null,
      owning_group: req.owningGroup,
      entity_ref: req.entityRef ?? null,
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

  async getInstanceByCamundaKey(camundaKey: string): Promise<WorkflowInstance> {
    const row = await this.db('workflow_instances')
      .where({ camunda_key: camundaKey })
      .first();
    if (!row) {
      throw new Error(`Workflow instance with camunda key '${camundaKey}' not found`);
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

  private rowToInstance(row: Record<string, unknown>): WorkflowInstance {
    return {
      id: row.id as string,
      camundaKey: row.camunda_key as string,
      definitionId: row.definition_id as string,
      title: row.title as string,
      description: (row.description as string | null) ?? undefined,
      owningGroup: row.owning_group as string,
      entityRef: (row.entity_ref as string | null) ?? undefined,
      status: row.status as WorkflowInstance['status'],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
