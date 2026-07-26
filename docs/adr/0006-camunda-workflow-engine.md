# ADR-0006: Deploy the Camunda 8 Workflow Engine via the Official Helm Chart

* Status: Accepted
* Deciders: Jonathan Sundquist
* Date: 2026-07-25

## Context and Problem Statement

The platform now delivers Backstage through ArgoCD GitOps. The next capability is
workflow orchestration, brought in from the **Branchline** project — a golden-path
tool built on Camunda 8. Branchline currently runs its engine locally via
`docker-compose` (`~/projects/studious-invention`): Zeebe, Operate, Tasklist, and
Elasticsearch. To run it inside `personal-idp` we need it deployed to Kubernetes
and managed by ArgoCD like every other workload. A decision is needed on **how**
to deploy Camunda: hand-written manifests translated from the compose file, or the
vendor's official Helm chart.

## Decision Drivers

* Deploying Camunda the way real platform teams do (the official chart) is more
  representative of production practice than hand-rolled manifests
* The engine must fit a single-user local k3d cluster alongside Backstage/Postgres/ArgoCD
* GitOps ownership must stay clean: Terraform bootstraps, ArgoCD delivers (ADR-0005)
* The local stack is deliberately minimal and unauthenticated (matching the compose
  file), so any full-platform default must be trimmable
* Configuration should be version-controlled and diffable, not buried in a spec

## Considered Options

* Hand-write plain Kubernetes manifests in `k8s/camunda/`, mirroring the compose services
* Deploy the official `camunda-platform` Helm chart via an ArgoCD Helm Application
* Install the chart out-of-band with Terraform (`helm_release`)

## Decision Outcome

Chosen option: **Official `camunda-platform` Helm chart (v11.12.3 → Camunda 8.6.39)
deployed as an ArgoCD multi-source Application**, trimmed to a minimal, no-auth
footprint. The chart version line `11.x` matches the compose's `8.6` pin.

### Why the chart over hand-written manifests

The chart wires the fiddly, version-specific details for us — StatefulSet layout,
health probes (`/actuator/health/*`), the Zeebe→Elasticsearch exporter, and
inter-service addressing — all of which are easy to get subtly wrong by hand and
drift across Camunda versions. It is also the deployment method used in production,
which is the point of this portfolio. The cost is that the chart defaults to the
*full* platform with authentication on, so the work shifts from writing manifests
to writing a **trimming values file**.

### Trimming for local use

`k8s/camunda/values.yaml` disables everything not needed for a local engine:

* `global.identity.auth.enabled: false` → all services fall back to built-in
  **basic-auth** (default `demo`/`demo`), removing the need for **Identity** and
  **Keycloak** entirely.
* `identity`, `identityKeycloak`, `optimize`, `connectors`, `webModeler`, `console`
  all disabled.
* Single-node engine: `zeebe.clusterSize/partitionCount/replicationFactor = 1`,
  `zeebeGateway.replicas = 1`.
* Bundled Elasticsearch reduced from a 3-node / 1 GiB-heap cluster to a single node
  with a 512 MiB heap and modest CPU/memory.

### Ownership and layout

Consistent with ADR-0005, **Terraform is not involved** — ArgoCD owns delivery. The
`camunda` namespace is created by the Application (`CreateNamespace=true`); no
pre-seeded secrets are required because auth is disabled. The Application uses ArgoCD
**multiple sources**: the chart is pulled from `https://helm.camunda.io`, while the
values file is read from this git repo via the `$values` ref, keeping configuration
under version control. `ServerSideApply=true` is set because the chart's rendered
resources carry annotations too large for client-side apply.

### UI access

Backstage already owns the k3d host port `8080` (loadbalancer → `/`), so Operate and
Tasklist are reached via `kubectl port-forward` (`make operate-ui` → :8081,
`make tasklist-ui` → :8082) rather than an Ingress. Adding host port mappings would
require recreating the k3d cluster; port-forward is the pragmatic local interim.

### Positive Consequences

* Production-representative deployment method; one values file to maintain instead of ~10 manifests
* The chart tracks Camunda's own probe/exporter/service wiring across patch releases
* Camunda workloads auto-appear in the Backstage catalog (the `kubernetesIngestor`
  excludes only `kube-*` namespaces)
* Reinforces the Terraform-bootstraps / ArgoCD-delivers boundary and exercises ArgoCD
  Helm + multi-source features

### Negative Consequences

* The chart's full-platform defaults must be understood well enough to trim safely
* Even trimmed, the stack adds ~2.5–3 GiB of memory requests on the local cluster
* Auth is disabled — acceptable only for a local sandbox; a real deployment would
  re-enable Identity/OIDC (the same gap tracked for Backstage guest auth)
* The bundled Elasticsearch uses Bitnami's archived `bitnamilegacy` images (a
  consequence of Bitnami's 2025 registry change); fine locally, revisit for anything real

## Pros and Cons of the Options

### Hand-written manifests in `k8s/camunda/`

* Good, because maximum transparency and uniformity with `k8s/backstage/`
* Good, because no chart abstraction to learn
* Bad, because we hand-maintain probes, the ES exporter, and service wiring, and must
  update them on every Camunda version bump
* Bad, because it is not how Camunda is deployed in practice

### Official Helm chart via ArgoCD (chosen)

* Good, because it is the vendor-supported, production-representative path
* Good, because ArgoCD manages Helm natively — no Terraform change, ownership stays clean
* Good, because a single values file captures all local customization, diffable in git
* Bad, because the chart ships a full platform that must be explicitly trimmed
* Bad, because more moving parts sit behind the abstraction than a flat manifest

### Terraform `helm_release`

* Good, because Terraform already installs ArgoCD this way
* Bad, because it puts application delivery back into Terraform, violating the ADR-0005
  boundary that ArgoCD owns app workloads
* Bad, because it loses ArgoCD's sync/drift visibility for the engine
