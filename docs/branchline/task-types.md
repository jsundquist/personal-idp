# Task types

Branchline supports five ways a BPMN task can be worked. All five are just
plain BPMN task elements (`userTask`, `serviceTask`, `manualTask`,
`receiveTask`, or `sendTask` — see [workflow-shape.md](./workflow-shape.md))
distinguished by the presence or absence of a small set of extension
elements. Nothing about the task *type* is declared explicitly — Branchline
infers it from what's attached to the element.

## 1. Automated task

A task with no candidate groups and no `branchlineFormKey` header, intended
to be completed by a job worker or another system rather than a person.

- Model it as a `serviceTask` (or `receiveTask`/`sendTask`) with a Zeebe job
  type, so an external worker picks up the job and calls Zeebe's job-complete
  API directly.
- Branchline still shows the task in the phase/step list with a live status
  (`pending` → `active` → `completed`), but no one takes action on it from
  the Branchline UI — there's no "Details" button with actions, because
  `task.status` never becomes actionable by a user.
- If a human ever *does* need to intervene (e.g. to unblock a stuck job),
  the same `complete`/`skip` endpoints Branchline uses for human tasks will
  also complete a job-backed task, because the backend picks the Zeebe
  job-complete API automatically when the active flow-node instance carries
  a `jobKey` (`router.ts`, `POST /workflows/:id/tasks/:taskId/complete`).

## 2. Human approval

The default for a `userTask` with no `zeebe:assignmentDefinition` and no
`branchlineFormKey` header. Self-serve — any authenticated user with the
`branchline.workflow.act` permission on the workflow instance can act on it.

- Rendered in the task drawer with **Mark Complete** and **Skip Task**
  buttons.
- Skipping requires a free-text reason, recorded in Branchline's audit trail
  and sent to Camunda as `branchlineSkipReason`/`branchlineSkipped`
  variables on job/task completion.
- Any markdown in the task's `<bpmn:documentation>` element is rendered in
  the drawer above the action buttons — use it for instructions to the
  approver.

## 3. Human approval with team permissions (gated task)

Same as a plain human approval, but restricted to members of one or more
Backstage catalog groups.

- Add a `zeebe:assignmentDefinition` extension element with a literal
  (non-FEEL) `candidateGroups` attribute, e.g.
  `candidateGroups="platform-team,security-review"`. A FEEL expression
  (starting with `=`) is treated as "no static group" and the task falls
  back to self-serve.
- The backend enforces this on every action: `assertCanActOnTask` resolves
  the task's `candidateGroups` from the deployed BPMN and checks the acting
  user's Backstage group memberships (`GroupMembershipChecker`) before
  allowing complete, skip, feedback creation, or feedback resolution on that
  task. Group names are compared case-insensitively by their short name
  (`platform-team`, not `group:default/platform-team`).
- The frontend mirrors this as `task.canAct`, computed per-request from the
  same group check, and shows a "Requires: \<group\>" chip plus a read-only
  notice in the drawer for users who aren't members. Non-members can still
  read documentation and add comments to existing feedback, just not act.
- This is the only way to scope a task to a specific team — there's no
  separate "permissions" mechanism beyond `candidateGroups`.

## 4. Custom forms

A `userTask` carrying a `zeebe:taskHeaders` entry with key
`branchlineFormKey`, used when the default Mark Complete/Skip UI isn't
enough — e.g. the task needs structured input before it can be completed.

```xml
<bpmn:extensionElements>
  <zeebe:taskHeaders>
    <zeebe:header key="branchlineFormKey" value="my-plugin.deploy-approval" />
  </zeebe:taskHeaders>
</bpmn:extensionElements>
```

- A consuming plugin registers a React component for that `formKey` using
  `TaskFormBlueprint` from `@internal/backstage-plugin-branchline`
  (`backstage/plugins/branchline/src/taskForms/TaskFormBlueprint.tsx`):

  ```tsx
  TaskFormBlueprint.make({
    params: {
      formKey: 'my-plugin.deploy-approval',
      component: DeployApprovalForm,
    },
  });
  ```

  The component receives `{ instanceId, taskId, formKey, task, onSubmitted,
  onClose }` (see `taskForms/types.ts`) and is responsible for calling
  Branchline's complete API itself (typically via `branchlineApiRef`) and
  invoking `onSubmitted()` when done.
- When a task has a `formKey`, the drawer renders the registered component
  in place of the Mark Complete button. **Skip Task** remains available
  alongside it. If no component is registered for the `formKey`, the drawer
  shows a warning and falls back to the default Mark Complete/Skip actions.
- Custom forms can be combined with `candidateGroups` — the form only
  renders for users who can act on the task.

## 5. Feedback loop (approval-gate feedback)

A code-review-style discussion thread attachable to *any* task (most useful
on gated human-approval tasks). This is entirely Branchline application
state, keyed by `(instanceId, taskId)` — it has no BPMN representation and
requires no extension elements to enable. It's always available in the task
drawer.

- The task's owning group (its `candidateGroups`, or anyone if ungrouped)
  logs a feedback item via **Add feedback** in the drawer.
- Any participant can add comments to an open feedback item.
- The owning group closes each item as either **resolved** or an
  **exception** (which requires a reason).
- **Completion is blocked while a task has open feedback** — the backend
  rejects `POST .../complete` with a 409 until every feedback item on that
  task is resolved or excepted (`router.ts`, feedback open-count check).
  The drawer reflects this by disabling Mark Complete and showing a tooltip
  explaining why.
- All feedback create/comment/resolve events appear in the workflow's audit
  trail (`GET /workflows/:id/audit`).
