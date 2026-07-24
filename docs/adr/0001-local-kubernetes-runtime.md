# ADR-0001: Local Kubernetes Runtime

* Status: Accepted
* Deciders: Jonathan Sundquist
* Date: 2026-07-23

## Context and Problem Statement

This project requires a local Kubernetes cluster on macOS to deploy and iterate on Backstage and supporting services without incurring cloud costs. The chosen runtime needs to be fast to spin up, low on resource overhead, and representative of how real clusters behave so that skills transfer to production environments.

## Decision Drivers

* Must run on macOS (Apple Silicon and Intel)
* Fast cluster creation and teardown for sandbox iteration
* Supports multiple nodes (to practice realistic scheduling)
* Requires minimal manual configuration to get a working cluster
* Active maintenance and community support
* Compatible with Helm and standard `kubectl` workflows

## Considered Options

* k3d
* kind (Kubernetes in Docker)
* minikube
* Docker Desktop built-in Kubernetes

## Decision Outcome

Chosen option: **k3d**, because it meets all decision drivers and offers the best combination of speed, resource efficiency, and CLI ergonomics among the evaluated options.

### Positive Consequences

* Cluster creation takes ~30 seconds via a single `k3d cluster create` command
* Runs k3s (a CNCF-certified Kubernetes distribution) inside Docker containers — no separate VM required
* Built-in support for exposing services via a load balancer (useful for reaching Backstage from the host browser)
* Cluster config integrates directly with `kubectl` via kubeconfig merge
* Easy to script cluster creation and teardown in a Makefile or shell script

### Negative Consequences

* k3s ships with some opinionated defaults (e.g., Traefik as default ingress) that differ from vanilla Kubernetes; these need to be accounted for in Terraform config
* Docker Desktop (or an equivalent container runtime) is a prerequisite
* Not identical to a managed cloud cluster (EKS, GKE, AKS), so some cloud-specific patterns won't be exercised

## Pros and Cons of the Options

### k3d

Runs k3s (lightweight Kubernetes) inside Docker containers. Managed via the `k3d` CLI.

* Good, because cluster creation is extremely fast (~30s)
* Good, because no VM layer — runs entirely in Docker
* Good, because supports multi-node clusters and built-in load balancer
* Good, because `k3d` CLI makes common operations (create, delete, import images) ergonomic
* Bad, because k3s has some non-standard defaults (Traefik, SQLite instead of etcd) that require awareness

### kind (Kubernetes in Docker)

Runs upstream Kubernetes inside Docker containers. Originally built for testing Kubernetes itself.

* Good, because uses upstream Kubernetes (no opinionated defaults)
* Good, because well-maintained by the Kubernetes SIGs team
* Bad, because slightly slower cluster creation than k3d
* Bad, because no built-in load balancer — requires MetalLB or manual port-forwarding
* Bad, because image loading into the cluster is more verbose

### minikube

Runs a single-node Kubernetes cluster, historically via a VM, now also via Docker.

* Good, because well-documented with a large user base
* Good, because has an add-on system for common components (dashboard, ingress, etc.)
* Bad, because traditionally VM-based which adds resource overhead
* Bad, because single-node by default — doesn't reflect multi-node scheduling
* Bad, because slower to start than k3d or kind

### Docker Desktop built-in Kubernetes

Single-node Kubernetes cluster bundled with Docker Desktop on Mac.

* Good, because zero additional installation if Docker Desktop is already present
* Bad, because it is a black box — limited configurability and no CLI to manage cluster lifecycle
* Bad, because tied to Docker Desktop's release cycle
* Bad, because difficult to reset to a clean state without affecting other Docker Desktop settings
* Bad, because single-node only
