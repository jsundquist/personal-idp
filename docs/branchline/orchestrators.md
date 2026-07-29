# Workflow orchestrators

Branchline's backend doesn't talk to a workflow engine directly. It depends
on a `WorkflowOrchestrator` interface
(`@internal/backstage-plugin-branchline-node`), and the concrete engine —
Camunda, AWS Step Functions, or anything else — ships as a separate,
independently installable backend module, the same way Backstage's own
catalog plugin lets you swap `plugin-catalog-backend-module-github` for a
different source module.

Exactly one orchestrator module may be installed at a time. Which one is
active is controlled entirely by which package is registered in
`packages/backend/src/index.ts` — there's no app-config flag to flip:

```ts
backend.add(import('@internal/backstage-plugin-branchline-backend-module-camunda'));
// or:
backend.add(import('@internal/backstage-plugin-branchline-backend-module-step-functions'));
```

Installing both at once is a startup error (`workflowOrchestratorExtensionPoint`
throws if `setOrchestrator` is called twice); installing neither is also a
startup error (the plugin throws if no module registered anything).

## The `WorkflowOrchestrator` contract

```ts
interface WorkflowOrchestrator {
  listDefinitions(): Promise<OrchestratorDefinition[]>;
  startInstance(opts: { definitionId: string; variables?: Record<string, unknown> }): Promise<StartWorkflowResult>;
  cancelInstance(orchestratorInstanceKey: string): Promise<void>;
  completeTask(orchestratorInstanceKey: string, taskId: string, variables?: Record<string, unknown>): Promise<void>;
  skipTask(orchestratorInstanceKey: string, taskId: string, reason: string): Promise<void>;
  getTaskCandidateGroups(definitionId: string, taskId: string): Promise<string[]>;
  getFlownodeProgress(orchestratorInstanceKeys: string[]): Promise<Map<string, { completedPhases: number; totalPhases: number }>>;
  buildHierarchy(definitionId: string, orchestratorInstanceKey: string, actions: TaskActionInput[]): Promise<ParallelBlock[]>;
  buildFlowGraph(definitionId: string, orchestratorInstanceKey: string, actions: TaskActionInput[]): Promise<FlowGraph>;
}
```

- **`orchestratorInstanceKey`** is whatever your engine calls a running
  instance — Camunda's `processInstanceKey`, Step Functions' `executionArn`.
  It's an opaque string to Branchline; only your implementation interprets it.
- **`completeTask`/`skipTask` own all engine-specific completion mechanics.**
  Camunda's implementation resolves the active element instance and picks
  between its two completion APIs (job vs. native user task) internally.
  Step Functions' implementation looks up a stored task token and calls
  `SendTaskSuccess`. The router never branches on engine internals — it just
  calls these two methods.
- **`buildFlowGraph` is the one every implementation must support.** It
  produces the orchestrator-agnostic graph the frontend renders (see below).
  `buildHierarchy` produces the older, being-phased-out task-list format; an
  implementation with no equivalent structure (Step Functions) may return `[]`.

## The `FlowGraph` target shape

Every implementation adapts its native execution model into the same graph
vocabulary, defined in `branchline-common`:

| `FlowNodeType` | Camunda (BPMN) | Step Functions (ASL) |
|---|---|---|
| `phase` | `subProcess` | single-branch `Parallel` state |
| `task` | `userTask` / `serviceTask` / … | `Task` state (incl. `waitForTaskToken`) |
| `choice` | `exclusiveGateway` | `Choice` state |
| `parallel-fork` / `parallel-join` | `parallelGateway` split/join | multi-branch `Parallel` state |

See `BpmnAdapter.ts` (branchline-backend-module-camunda) and `AslAdapter.ts`
(branchline-backend-module-step-functions) for the exact traversal rules —
they're deliberately structured the same way: walk the definition, suppress
pass-through/merge nodes by resolving their edges to whatever follows, and
flatten everything inside a phase to that phase's `parentId` regardless of
nesting depth.

## The candidate-group gap

Camunda has a native "who can act on this task" concept
(`zeebe:assignmentDefinition candidateGroups`, see
[workflow-shape.md](./workflow-shape.md)). Not every orchestrator does — ASL
has nothing equivalent. When yours doesn't, source it from app-config
instead, keyed by an array of `(definitionId, taskId) → groups` entries
rather than nested keys (state/task names can contain characters that aren't
safe as bare YAML keys):

```yaml
branchline:
  stepFunctions:
    candidateGroups:
      - definitionId: create-backend-api
        taskId: "Request Architecture Review"
        groups: [architects]
```

This is exactly what `CandidateGroupResolver` in
branchline-backend-module-step-functions does — use it as the template if
you're missing this concept in a new engine.

## The task-token / completion-callback pattern

Some orchestrators pause a running instance at a human task and resume it via
a one-time opaque token minted when the pause happens (Step Functions'
`waitForTaskToken` + `SendTaskSuccess`/`SendTaskFailure`), rather than
exposing a stable, independently-queryable task ID the way Camunda's
Tasklist does. If your engine works this way:

1. The state/task that pauses needs to hand its token back to Branchline the
   moment it's minted — there's usually no API to re-list or re-fetch it
   later. branchline-backend-module-step-functions does this with a small
   authenticated HTTP callback route the pausing Lambda calls.
2. Persist `(instanceKey, taskId) → token` somewhere Branchline's backend can
   read it back — `TaskTokenStore` in that module is a Knex table for this,
   reachable from the module's own migrations.
3. `completeTask`/`skipTask` look the token up, use it to resume the engine,
   and delete it (single-use).

## Adding a new orchestrator module

1. Create a new package implementing `WorkflowOrchestrator` (a class is
   fine — it doesn't need a separate wrapper if its natural method surface
   already matches the interface).
2. Write a `register.ts` that calls `createBackendModule({ pluginId: 'branchline', moduleId: '<yours>', ... })`
   and, in its `init`, calls `orchestrator.setOrchestrator(new YourClient(...))`
   against `workflowOrchestratorExtensionPoint`.
3. Add the package to `packages/backend/src/index.ts` — and make sure no
   other orchestrator module is also enabled.
4. Implement `buildFlowGraph` against the shared `FlowGraph` shape above; the
   frontend needs nothing else changed.
