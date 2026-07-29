# Branchline

Branchline is a Backstage plugin that renders and drives workflow instances
as human-friendly workflows. The workflow engine — Camunda by default, AWS
Step Functions as an alternative — owns execution; Branchline owns
presentation, per-task team permissions, approval-gate feedback, and an audit
trail, all layered on top via a `WorkflowOrchestrator` interface so the
engine can be swapped by installing a different backend module. See
[orchestrators.md](./orchestrators.md) for that layer.

This directory documents the things a workflow author needs to know:

- **[Orchestrators](./orchestrators.md)** — the `WorkflowOrchestrator`
  interface, the orchestrator-agnostic `FlowGraph` shape, and how to add a
  new engine.
- **[Task types](./task-types.md)** — the five ways a task can require or
  receive input in Branchline, and what to put in the BPMN to get each one
  (Camunda-specific).
- **[Workflow shape](./workflow-shape.md)** — the structural conventions a
  BPMN diagram must follow for Branchline to parse it into phases, steps, and
  branches (Camunda-specific).

## How a workflow gets from definition to UI (Camunda module)

1. A BPMN diagram is deployed to Camunda (Zeebe). Branchline discovers it via
   `GET /definitions`, keyed by `bpmnProcessId`.
2. A user starts an instance from the Branchline UI (`POST /workflows`),
   which calls Zeebe's `POST /v2/process-instances` and stores a local
   `workflow_instances` row (title, owning group, entity link, etc.).
3. On every load of a workflow's detail page, the backend fetches the
   deployed BPMN XML plus live Camunda flow-node state, and reduces the two
   into:
   - `parallelBlocks` — the phase/step/task hierarchy the task list renders
     (`backstage/plugins/branchline-backend-module-camunda/src/BpmnParser.ts`).
   - `flowGraph` — the orchestrator-agnostic node/edge graph for the visual
     flow diagram (`.../BpmnAdapter.ts`).
4. Task actions (complete / skip), approval-gate feedback, and the audit
   trail are Branchline application state — recorded in Branchline's own
   database, not in the orchestrator — but every completion/skip is also
   signaled back to the orchestrator so the instance actually advances.

The AWS Step Functions module (`branchline-backend-module-step-functions`)
follows the same shape against `StartExecution`/`DescribeExecution`/
`GetExecutionHistory`/`SendTaskSuccess` instead — see
[orchestrators.md](./orchestrators.md) for the mapping.
