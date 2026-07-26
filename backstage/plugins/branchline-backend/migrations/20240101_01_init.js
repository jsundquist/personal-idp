// @ts-check
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('workflow_instances', table => {
    table.string('id').primary();
    table.string('camunda_key').notNullable().unique();
    table.string('definition_id').notNullable();
    table.string('title').notNullable();
    table.text('description').nullable();
    table.string('owning_group').notNullable();
    table.string('entity_ref').nullable();
    table.string('status').notNullable().defaultTo('active');
    table.dateTime('created_at').notNullable();
    table.dateTime('updated_at').notNullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTable('workflow_instances');
};
