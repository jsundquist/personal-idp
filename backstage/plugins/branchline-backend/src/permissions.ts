import { z } from 'zod/v3';
import {
  createConditionExports,
  createPermissionResourceRef,
  createPermissionRule,
} from '@backstage/plugin-permission-node';
import {
  WORKFLOW_INSTANCE_RESOURCE_TYPE,
} from '@internal/backstage-plugin-branchline-common';
import type { WorkflowInstance } from '@internal/backstage-plugin-branchline-common';

/**
 * Typed resource ref for workflow instances — used with the new createPermissionRule API
 * to avoid the deprecated overload that accepts TResource/TQuery/TResourceType generics directly.
 */
const workflowInstanceRef = createPermissionResourceRef<
  WorkflowInstance,
  { property: string; values: string[] }
>().with({
  pluginId: 'branchline',
  resourceType: WORKFLOW_INSTANCE_RESOURCE_TYPE,
});

/**
 * Permission rule: allow if the workflow's owningGroup is in the provided list of groups.
 * The policy passes the requesting user's ownershipEntityRefs (group refs) as owningGroups.
 */
export const isOwnerGroupMember = createPermissionRule({
  name: 'IS_OWNER_GROUP_MEMBER',
  description: 'Allow if the requesting user is a member of the workflow owning group',
  resourceRef: workflowInstanceRef,
  paramsSchema: z.object({ owningGroups: z.array(z.string()) }),
  apply(resource, { owningGroups }) {
    return owningGroups.includes(resource.owningGroup);
  },
  toQuery({ owningGroups }) {
    return { property: 'owning_group', values: owningGroups };
  },
});

/**
 * Condition creators and conditional decision factory for use in a PermissionPolicy.
 *
 * Usage in your policy:
 *   import { branchlineConditions, createBranchlineConditionalDecision } from
 *     '@internal/backstage-plugin-branchline-backend';
 *
 *   if (isPermission(request.permission, branchlineWorkflowActPermission)) {
 *     const userGroups = (user?.info.ownershipEntityRefs ?? []).filter(r => r.startsWith('group:'));
 *     return createBranchlineConditionalDecision(
 *       request.permission,
 *       branchlineConditions.isOwnerGroupMember({ owningGroups: userGroups }),
 *     );
 *   }
 */
export const {
  conditions: branchlineConditions,
  createConditionalDecision: createBranchlineConditionalDecision,
} = createConditionExports({
  resourceRef: workflowInstanceRef,
  rules: { isOwnerGroupMember },
});

/**
 * The resourceRef and rules to pass to permissionsRegistry.addResourceType() in plugin.ts.
 * getResources requires DB access so it is wired in plugin.ts directly.
 */
export { workflowInstanceRef };
