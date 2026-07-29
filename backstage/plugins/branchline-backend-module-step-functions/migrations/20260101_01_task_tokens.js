// @ts-check
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('step_functions_task_tokens', table => {
    table.string('execution_arn').notNullable();
    table.string('state_name').notNullable();
    table.text('task_token').notNullable();
    table.dateTime('created_at').notNullable();
    table.primary(['execution_arn', 'state_name']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTable('step_functions_task_tokens');
};
