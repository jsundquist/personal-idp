import { createPermission } from '@backstage/plugin-permission-common';

export const WORKFLOW_INSTANCE_RESOURCE_TYPE = 'workflow-instance' as const;

/**
 * Permission required to act on a workflow instance (complete tasks, skip tasks, cancel).
 * This is a resource permission — resourceRef is the workflow instance ID when calling
 * usePermission() on the frontend or permissions.authorize() on the backend.
 *
 * The isOwnerGroupMember rule (exported from branchline-backend) is evaluated by the
 * permission integration router to resolve conditional policy decisions.
 */
export const branchlineWorkflowActPermission = createPermission({
  name: 'branchline.workflow.act',
  attributes: { action: 'update' },
  resourceType: WORKFLOW_INSTANCE_RESOURCE_TYPE,
});

export const branchlinePermissions = [branchlineWorkflowActPermission];
