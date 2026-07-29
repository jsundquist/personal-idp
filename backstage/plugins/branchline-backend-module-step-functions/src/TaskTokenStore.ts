import { resolvePackagePath } from '@backstage/backend-plugin-api';
import { Knex } from 'knex';

const migrationsDir = resolvePackagePath(
  '@internal/backstage-plugin-branchline-backend-module-step-functions',
  'migrations',
);

/**
 * Persists task tokens minted by a `waitForTaskToken` Lambda so a later
 * completeTask/skipTask call can resolve which execution+state the token
 * belongs to. Step Functions has no API to re-list or re-query an
 * outstanding task token once minted, so it must be captured out-of-band
 * when the Lambda receives it (see the callback route in register.ts).
 */
export class TaskTokenStore {
  private constructor(private readonly db: Knex) {}

  static async create(db: Knex): Promise<TaskTokenStore> {
    await db.migrate.latest({ directory: migrationsDir });
    return new TaskTokenStore(db);
  }

  async save(executionArn: string, stateName: string, taskToken: string): Promise<void> {
    await this.db('step_functions_task_tokens')
      .insert({
        execution_arn: executionArn,
        state_name: stateName,
        task_token: taskToken,
        created_at: new Date().toISOString(),
      })
      .onConflict(['execution_arn', 'state_name'])
      .merge();
  }

  async get(executionArn: string, stateName: string): Promise<string | undefined> {
    const row = await this.db('step_functions_task_tokens')
      .where({ execution_arn: executionArn, state_name: stateName })
      .first();
    return row?.task_token;
  }

  /** Single-use: remove the token once it's been sent back to Step Functions. */
  async remove(executionArn: string, stateName: string): Promise<void> {
    await this.db('step_functions_task_tokens')
      .where({ execution_arn: executionArn, state_name: stateName })
      .delete();
  }
}
