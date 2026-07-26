// @ts-check
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('task_actions', table => {
    table.string('id').primary();
    table
      .string('instance_id')
      .notNullable()
      .references('id')
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table.string('task_id').notNullable();
    table.string('action').notNullable(); // 'completed' | 'skipped'
    table.string('actor').notNullable();
    table.text('skip_reason').nullable();
    table.dateTime('occurred_at').notNullable();
    table.index(['instance_id'], 'task_actions_instance_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTable('task_actions');
};
