# ADR-0002: Infrastructure as Code with Terraform

* Status: Accepted
* Deciders: Jonathan Sundquist
* Date: 2026-07-23

## Context and Problem Statement

The local Kubernetes cluster needs to be provisioned and configured in a repeatable, declarative way. Rather than running ad-hoc `kubectl` or `helm` commands, we want a single tool that can bring the environment from zero to a running state idempotently. This tool should also reflect what is commonly used in production platform engineering roles.

## Decision Drivers

* Declarative — desired state is committed to Git, not a sequence of imperative commands
* Idempotent — re-running produces the same result without side effects
* Supports both Kubernetes resource management and Helm chart deployment
* Widely adopted in the industry; directly applicable to target job requirements
* Suitable for managing the bootstrap layer of the cluster (namespaces, secrets, base infrastructure)

## Considered Options

* Terraform (HashiCorp) with `kubernetes` and `helm` providers
* Pulumi
* Raw `kubectl apply` with YAML manifests
* Helm CLI directly

## Decision Outcome

Chosen option: **Terraform**, because it is the de facto standard for infrastructure as code in the industry, has mature Kubernetes and Helm providers, and provides declarative state management that maps well to the learning goals of this project.

**Scope boundary:** Terraform owns the bootstrap layer — cluster namespaces, RBAC, secrets, and (when added in milestone 2) the ArgoCD installation itself. It does not manage application deployments (Backstage, PostgreSQL); those will be managed by ArgoCD in milestone 2 and by Terraform directly in milestone 1 as a stepping stone.

### Positive Consequences

* Environment can be fully recreated with `terraform apply` after a cluster wipe
* State file makes drift detection explicit
* The `kubernetes` and `helm` providers are mature and well-documented
* Directly applicable to Terragrunt, Atlantis, and other Terraform-adjacent tools common in platform roles
* Encourages thinking in terms of desired state rather than procedural scripts

### Negative Consequences

* Terraform state must be managed — for a local sandbox this means a local `.tfstate` file, which is not shareable or backed up without additional setup
* Mixing Terraform-managed and manually-applied resources leads to drift; discipline required to keep everything in Terraform
* The Kubernetes provider can be slower than `kubectl apply` for iterating on individual resources

## Pros and Cons of the Options

### Terraform with `kubernetes` and `helm` providers

* Good, because it is the industry standard IaC tool — maximum transferability
* Good, because `helm` provider allows Helm chart deployment declaratively within the same workflow
* Good, because state management makes environment reproducibility explicit
* Good, because large ecosystem of modules and providers
* Bad, because state file is local by default — needs a backend (S3, GCS, etc.) to share or persist properly
* Bad, because provider version pinning and initialization adds boilerplate

### Pulumi

Uses general-purpose programming languages (TypeScript, Go, Python) to define infrastructure.

* Good, because infrastructure defined in a real language enables loops, conditionals, and abstractions without HCL workarounds
* Good, because strong Kubernetes support
* Bad, because less prevalent than Terraform in job postings and production environments
* Bad, because learning Pulumi's SDK is an additional context switch on top of learning Kubernetes

### Raw `kubectl apply` with YAML manifests

* Good, because zero abstraction — exactly what Kubernetes expects
* Good, because useful for learning what resources actually look like
* Bad, because no state management — drift is invisible
* Bad, because no idempotency guarantees without wrapper tooling
* Bad, because Helm chart deployment requires separate tooling

### Helm CLI directly

* Good, because Helm is the Kubernetes package manager — important to understand
* Bad, because managing multiple releases and their dependencies is error-prone without a higher-level orchestrator
* Bad, because no state management across the full environment
* Bad, because does not handle raw Kubernetes resources (namespaces, RBAC) elegantly
