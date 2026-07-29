// @ts-check
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('workflow_instances', table => {
    table.renameColumn('camunda_key', 'orchestrator_instance_key');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('workflow_instances', table => {
    table.renameColumn('orchestrator_instance_key', 'camunda_key');
  });
};
