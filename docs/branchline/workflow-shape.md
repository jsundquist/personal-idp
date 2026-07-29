# BPMN workflow shape

This page is specific to the Camunda orchestrator module
(`branchline-backend-module-camunda`) and its BPMN authoring conventions. For
the orchestrator-agnostic layer — the `WorkflowOrchestrator` interface, the
`FlowGraph` shape every engine adapts into, and how to add a different engine
(e.g. AWS Step Functions) — see [orchestrators.md](./orchestrators.md).

Branchline parses whatever BPMN 2.0 XML Camunda hands back for a process
definition. It doesn't require a special Camunda feature, but it does expect
a specific structural convention so it can group tasks into the phase/step
hierarchy the UI renders. A diagram that doesn't follow this shape will
either show up empty or lose grouping/branch information — Camunda will
still execute it fine either way.

## Top level: phases are subprocesses

Only `<bpmn:subProcess>` elements that are direct children of the
`<bpmn:process>` become **phases**. Anything else at the top level (a task
sitting directly in the process, not inside a subprocess) is ignored by the
phase/step parser (`BpmnParser.parseBpmnXml`).

```xml
<bpmn:process id="my-process" isExecutable="true">
  <bpmn:subProcess id="Phase_intake" name="Intake">
    ...
  </bpmn:subProcess>
  <bpmn:subProcess id="Phase_review" name="Review">
    ...
  </bpmn:subProcess>
  <bpmn:sequenceFlow sourceRef="Phase_intake" targetRef="Phase_review" />
</bpmn:process>
```

- Phases render as the stepper across the top of the workflow detail page
  and as accordions below it, in document order.
- Sequence flows directly between two subprocesses become phase→phase edges
  in the visual flow graph.
- A phase's progress (`completedPhases`/`totalPhases` on the workflow list)
  counts `SUB_PROCESS`-type flow-node instances in Camunda, so give each
  phase's subprocess a `name` — it's what users see.

## Inside a phase: steps

Within a subprocess, Branchline walks from the `startEvent` following
`sequenceFlow`s and turns what it finds into an ordered list of **steps**:

| BPMN element(s) | Step produced |
|---|---|
| A single task element | A plain step with one task |
| `exclusiveGateway` with >1 outgoing flow | A step with `branchType: 'exclusive'` — one task per branch, rendered as "OR" alternatives; only one branch's task will actually run |
| `parallelGateway` with >1 outgoing flow | A step with `branchType: 'parallel'` — all branch tasks run concurrently |

Supported task element types: `userTask`, `serviceTask`, `manualTask`,
`receiveTask`, `sendTask`. Any of these can carry the task-type extension
elements described in [task-types.md](./task-types.md).

Rules that fall out of the traversal:

- Each branch of a gateway must contain exactly a run of task elements
  before rejoining at a matching gateway of the same type (an
  `exclusiveGateway` branch rejoins at an `exclusiveGateway`; a
  `parallelGateway` branch rejoins at a `parallelGateway`). The join gateway
  itself isn't rendered — traversal resumes from whatever follows it.
- Nested gateways within a single branch aren't supported by the step
  parser — keep branching to one level per phase. (The BPMN itself can still
  express more complex control flow; it just won't be reflected in the step
  hierarchy Branchline renders. Consider splitting a deeply nested flow into
  additional phases instead.)
- If a subprocess has no reachable `startEvent` (or a broken flow), the
  parser falls back to listing every task element found in document order,
  ungrouped by branch.
- A phase is considered complete once every task across all its steps is
  `completed`, `skipped`, or `not-taken` (the status a task in a
  not-taken exclusive branch gets).

## Task-level extension elements

All optional; add whichever apply to a given task element.

| Extension | Purpose | Doc |
|---|---|---|
| `<bpmn:documentation>` | Markdown shown in the task drawer | any task |
| `zeebe:assignmentDefinition[candidateGroups]` | Restrict who can act on the task to members of one or more Backstage groups (comma-separated, literal names — not a FEEL expression) | [task-types.md #3](./task-types.md#3-human-approval-with-team-permissions-gated-task) |
| `zeebe:taskHeaders` entry `branchlineFormKey` | Render a consumer-registered custom form instead of the default Mark Complete button | [task-types.md #4](./task-types.md#4-custom-forms) |

## Process instance variables Branchline sets

When a workflow is started from the Branchline UI, it passes two variables
into the Zeebe process instance start call — available to your process if
you need them (e.g. in FEEL expressions or job worker logic):

- `branchlineTitle` — the title the user gave the workflow instance.
- `branchlineOwner` — the owning group.

When a task is completed via **Skip Task**, Branchline completes the
job/user task with:

- `branchlineSkipped: true`
- `branchlineSkipReason: <the reason text>`

If your process needs to branch differently on a skip vs. a normal
completion (e.g. an exclusive gateway right after the task), read these
variables in the outgoing sequence flow conditions.

## Two Camunda task-completion mechanisms — you don't need to choose

Camunda 8.6+ distinguishes native "user tasks" (backed by Tasklist, no job)
from older job-worker-style tasks (backed by a Zeebe job). Branchline
detects which one an active task is per completion and calls the matching
API automatically (`CamundaClient.completeJob` vs
`.completeUserTask`) — model the task with whichever `userTask` style your
Camunda version and tooling default to; no extra configuration is needed on
the BPMN side.

## Deployment

Branchline discovers process definitions via Camunda Operate
(`GET /definitions`, deduplicated to the highest version per
`bpmnProcessId`). Deploy your BPMN to the connected Camunda cluster through
your normal deployment path (`zbctl`, CI, Camunda Modeler, etc.) — Branchline
doesn't deploy or version diagrams itself, it only reads what's already
deployed.
