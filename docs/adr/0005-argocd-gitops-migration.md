# ADR-0005: Migrate Application Delivery to ArgoCD (GitOps)

* Status: Accepted
* Deciders: Jonathan Sundquist
* Date: 2026-07-23

## Context and Problem Statement

Milestone 1 established a working Backstage environment in a local k3d cluster managed entirely by Terraform. Every change to application configuration requires running `terraform apply` manually. As the number of applications grows, this approach does not scale and does not reflect how production platform teams operate. A decision is needed on how to introduce GitOps-based continuous delivery while preserving Terraform's role in cluster bootstrap.

## Decision Drivers

* The GitOps pattern (Git as the source of truth for cluster state) is foundational to modern platform engineering and is a named requirement at target employers
* ArgoCD was explicitly deferred to Milestone 2 in ADR-0004; this ADR fulfills that decision
* A clean ownership boundary between Terraform and ArgoCD prevents conflicts and drift
* The migration from `terraform apply` to ArgoCD sync should itself be a demonstrable, documented exercise rather than a "big bang" switch

## Considered Options

* Keep all Kubernetes resources managed by Terraform (no change)
* Migrate all Kubernetes resources to ArgoCD, remove Terraform entirely
* Split ownership: Terraform bootstraps the cluster and ArgoCD; ArgoCD owns application delivery

## Decision Outcome

Chosen option: **Split ownership — Terraform bootstraps, ArgoCD delivers**, because it preserves Terraform's strengths (idempotent cluster setup, secret management) while giving ArgoCD ownership of the application lifecycle where GitOps provides the most value.

### Ownership boundary

**Terraform continues to own:**
- k3d cluster lifecycle (via Makefile)
- Kubernetes namespaces (`argocd`, `backstage`)
- ArgoCD installation (via Helm release)
- The `ArgoCD Application` CRD that registers the app with ArgoCD
- Kubernetes Secrets containing sensitive values (postgres password, etc.)

**ArgoCD takes ownership of:**
- Backstage Deployment, Service, Ingress, ServiceAccount, ClusterRole, ClusterRoleBinding
- PostgreSQL StatefulSet and Service
- Any future application workloads added to `k8s/`

### Manifest layout

Application manifests live in `k8s/<app-name>/` directories tracked in this repository. ArgoCD is configured to watch `k8s/backstage/` on the `main` branch of `https://github.com/jsundquist/personal-idp`. A push to `main` that modifies any file under `k8s/backstage/` triggers an automatic sync.

### Secret handling

Secrets containing sensitive values are excluded from `k8s/` and remain managed by Terraform. This is acceptable for a local sandbox; a production environment would use an external secrets operator (e.g., External Secrets Operator with a vault backend).

### Positive Consequences

* Changes to application configuration require only a `git push` — no `terraform apply`
* ArgoCD provides a visual sync status UI showing drift between Git and live cluster state
* The Backstage ArgoCD plugin surfaces sync status directly on catalog entity pages
* The migration produces a concrete "before and after" narrative: direct Terraform deployment → GitOps with ArgoCD
* Future workloads added to `k8s/` are automatically picked up by ArgoCD

### Negative Consequences

* Two systems (Terraform and ArgoCD) now share ownership of the cluster — the boundary must be respected to avoid conflicts
* Secrets management is simplified (left in Terraform) rather than fully GitOps-native
* ArgoCD adds cluster resource overhead (~200 MB RAM) which is noticeable in a local k3d environment

## Pros and Cons of the Options

### Keep all resources in Terraform

* Good, because single tool owns everything — no ownership boundary to maintain
* Good, because simpler mental model during initial learning
* Bad, because `terraform apply` for every app change is slow and does not reflect production patterns
* Bad, because Terraform state becomes a bottleneck as the number of apps grows
* Bad, because misses the GitOps pattern that is a core skill gap to close

### Migrate everything to ArgoCD, remove Terraform

* Good, because fully GitOps-native including cluster bootstrap
* Bad, because cluster bootstrap (namespace creation, ArgoCD install itself) needs to be managed somehow — this typically requires a bootstrap mechanism (Terraform, Helm, or cluster-api), making "no Terraform" impractical
* Bad, because eliminates Terraform experience which is also a named requirement at target employers

### Split ownership — Terraform bootstraps, ArgoCD delivers (chosen)

* Good, because each tool is used where it excels
* Good, because the ownership boundary is clean and documentable
* Good, because both Terraform and ArgoCD appear in the portfolio as intentional, distinct skills
* Bad, because requires understanding two systems and their interaction
* Bad, because secret management remains outside the GitOps flow
