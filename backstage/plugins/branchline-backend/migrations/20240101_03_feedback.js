// @ts-check
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('feedback_items', table => {
    table.string('id').primary();
    table
      .string('instance_id')
      .notNullable()
      .references('id')
      .inTable('workflow_instances')
      .onDelete('CASCADE');
    table.string('task_id').notNullable();
    table.string('author_group').notNullable();
    table.string('author').notNullable();
    table.text('body').notNullable();
    table.string('status').notNullable().defaultTo('open'); // 'open' | 'resolved' | 'exception'
    table.string('closed_by').nullable();
    table.dateTime('closed_at').nullable();
    table.text('exception_reason').nullable();
    table.dateTime('created_at').notNullable();
    table.dateTime('updated_at').notNullable();
    table.index(['instance_id', 'task_id'], 'feedback_items_instance_task_idx');
  });

  await knex.schema.createTable('feedback_comments', table => {
    table.string('id').primary();
    table
      .string('feedback_id')
      .notNullable()
      .references('id')
      .inTable('feedback_items')
      .onDelete('CASCADE');
    table.string('author').notNullable();
    table.text('body').notNullable();
    table.dateTime('created_at').notNullable();
    table.index(['feedback_id'], 'feedback_comments_feedback_idx');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTable('feedback_comments');
  await knex.schema.dropTable('feedback_items');
};
