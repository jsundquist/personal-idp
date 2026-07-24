# ADR-0004: Defer GitOps (ArgoCD) to Milestone 2

* Status: Accepted
* Deciders: Jonathan Sundquist
* Date: 2026-07-23

## Context and Problem Statement

ArgoCD is a GitOps continuous delivery tool for Kubernetes that would provide a realistic, production-representative deployment model for this project. However, including it from day one adds complexity at a point when the foundational Kubernetes and Terraform skills are still being developed. A decision is needed on when to introduce it.

## Decision Drivers

* Milestone 1 should be achievable without being overwhelmed — getting Backstage running in a local cluster is already non-trivial
* ArgoCD's value is most apparent after experiencing the friction of managing deployments without it
* The GitOps migration (Terraform-managed → ArgoCD-managed app delivery) is itself a valuable learning exercise and a stronger interview narrative than having had it from the start
* ArgoCD is a named technology at several target employers and should be in the final stack, just not immediately

## Considered Options

* Include ArgoCD from day 1 alongside k3d, Terraform, and Backstage
* Defer ArgoCD to milestone 2, after the baseline environment is stable
* Skip ArgoCD entirely, rely on Terraform for all deployments throughout

## Decision Outcome

Chosen option: **Defer ArgoCD to milestone 2**, because the learning value of the GitOps pattern is higher once there is a concrete baseline to migrate from, and because reducing milestone 1 scope improves the likelihood of completing it successfully.

**Milestone 1 deployment model:** Terraform manages everything — namespaces, PostgreSQL (via Helm), and Backstage (via Helm or raw manifests). All changes are applied via `terraform apply`.

**Milestone 2 migration:** Terraform retains ownership of the bootstrap layer (cluster setup, namespaces, ArgoCD installation). ArgoCD takes over application delivery (Backstage, PostgreSQL) by watching the Git repository.

### Positive Consequences

* Milestone 1 scope is contained and completable
* Kubernetes fundamentals (pods, services, deployments, config maps, secrets) are learned without GitOps indirection obscuring what is happening
* The milestone 1 → milestone 2 migration produces a concrete "before and after" narrative: "I started with direct Terraform-managed deployments, identified the limitations, and migrated to a GitOps model with ArgoCD"
* ArgoCD's UI and sync model are more meaningful when there is already a working deployment to observe changing

### Negative Consequences

* Milestone 1 does not reflect how most production platform teams operate (most use GitOps)
* Changes to application config in milestone 1 require `terraform apply` rather than a Git push, which is slower for iteration
* ArgoCD installation in milestone 2 will require refactoring some Terraform resources to hand off ownership

## Pros and Cons of the Options

### Include ArgoCD from day 1

* Good, because the environment reflects production patterns immediately
* Good, because all learning happens in the final target architecture
* Bad, because adds significant complexity to milestone 1 — cluster bootstrap, ArgoCD installation, Application CRD configuration, and Backstage deployment all at once
* Bad, because GitOps indirection (push to Git → ArgoCD syncs) makes it harder to understand what Kubernetes is actually doing during initial learning

### Defer ArgoCD to milestone 2 (chosen)

* Good, because milestone 1 remains focused and achievable
* Good, because the migration itself is a learning exercise and a portfolio story
* Good, because ArgoCD's value is viscerally understood after experiencing deployment without it
* Bad, because milestone 1 does not reflect production deployment patterns
* Bad, because some Terraform refactoring is required when ArgoCD is introduced

### Skip ArgoCD entirely

* Good, because removes one technology from the learning surface
* Bad, because ArgoCD (or Flux) is a named requirement or strong signal at most platform engineering target roles
* Bad, because the GitOps pattern is foundational to modern Kubernetes operations — skipping it leaves a significant gap
