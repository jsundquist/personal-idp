# personal-idp

A local Internal Developer Platform sandbox that mirrors the patterns used in production IDP implementations (Backstage, Kubernetes, Terraform). Built as a hands-on learning environment and portfolio project.

## Architecture Decisions

All major technology choices are documented as Architecture Decision Records before implementation begins.

See [`docs/adr/`](docs/adr/) for the full list.

## Stack

| Layer | Technology |
|---|---|
| IDP Framework | [Backstage](https://backstage.io) |
| Local Kubernetes | [k3d](https://k3d.io) |
| Infrastructure as Code | [Terraform](https://terraform.io) |
| GitOps (milestone 2) | [ArgoCD](https://argoproj.github.io/cd/) |
