// @ts-check
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.alterTable('workflow_instances', table => {
    // Entity ref of the user who started the workflow. Nullable — existing
    // rows predate the column and render as "Unknown" in the audit trail.
    table.string('created_by').nullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('workflow_instances', table => {
    table.dropColumn('created_by');
  });
};
