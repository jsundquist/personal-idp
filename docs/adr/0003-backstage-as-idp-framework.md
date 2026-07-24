# ADR-0003: Backstage as IDP Framework

* Status: Accepted
* Deciders: Jonathan Sundquist
* Date: 2026-07-23

## Context and Problem Statement

This project needs an Internal Developer Platform framework to serve as its core application. The chosen framework should be self-hostable (to run locally in Kubernetes), extensible (to support custom plugin development as a learning objective), and representative of what production platform teams actually use. It should also serve as a portfolio artifact that maps directly to target employer requirements.

## Decision Drivers

* Must be self-hostable — runs in a local Kubernetes cluster without requiring a SaaS subscription
* Supports custom plugin development to demonstrate engineering depth beyond configuration
* Actively used in production by real platform teams — not a toy or niche tool
* Directly mirrors the IDP used at Thrivent (Shipwright), the primary target employer
* Open source with strong community and CNCF backing
* Enables a "golden path" Software Template as the milestone 2 core deliverable

## Considered Options

* Backstage (CNCF / Spotify)
* Port
* Cortex
* Build from scratch

## Decision Outcome

Chosen option: **Backstage**, because it is the only option that is simultaneously open source, self-hostable, extensible via a plugin architecture, CNCF-backed, and directly mirrors the production IDP at the primary target employer (Thrivent Shipwright).

### Positive Consequences

* The core deliverable — a Software Template that scaffolds a new service, wires up CI/CD, and deploys it to the cluster — is a first-class Backstage feature, not a workaround
* Custom plugin development in React + Node.js demonstrates full-stack capability in the context of platform engineering
* Backstage knowledge is directly transferable to Shipwright and is a signal in job applications for Vanta, Attentive, Salesforce, and similar targets
* Large plugin ecosystem means integrations (GitHub, Kubernetes, TechDocs) are available without building from scratch

### Negative Consequences

* Backstage is a Node.js monorepo with significant startup complexity — initial setup requires more effort than a SaaS alternative
* Requires building and managing a Docker image for Kubernetes deployment
* Needs PostgreSQL as a backing store (SQLite only for local dev mode, not suitable for a cluster deployment)
* Active development means breaking changes between versions are common

## Pros and Cons of the Options

### Backstage (CNCF / Spotify)

Open source IDP framework with a plugin architecture, Software Templates, a service catalog, and TechDocs.

* Good, because open source and self-hostable — runs in the local cluster at zero cost
* Good, because CNCF incubating project with strong long-term backing
* Good, because plugin architecture allows writing custom frontend and backend plugins
* Good, because Software Templates are a first-class feature that directly mirrors the Shipwright golden path pattern
* Good, because direct match to Thrivent Shipwright — the strongest possible interview signal
* Bad, because initial setup is complex (Node.js monorepo, Docker image build, PostgreSQL dependency)
* Bad, because frequent breaking changes between minor versions

### Port

SaaS-based IDP with a no-code/low-code portal builder and a strong API.

* Good, because extremely fast to get a portal running
* Good, because good documentation and UX
* Bad, because SaaS — cannot run locally in a Kubernetes cluster without internet dependency
* Bad, because no custom plugin development — extensibility is limited to their API
* Bad, because does not reflect how self-hosted IDPs work in production platform teams

### Cortex

SaaS IDP focused on service maturity scoring and catalog management.

* Good, because strong service catalog features
* Bad, because SaaS only — not self-hostable
* Bad, because narrower focus than Backstage; lacks Software Templates and golden path patterns
* Bad, because less relevant to target job requirements

### Build from scratch

Implement a custom portal using a frontend framework (React, Next.js) and a custom backend.

* Good, because complete control over the implementation
* Good, because demonstrates full-stack engineering independently of a framework
* Bad, because misses the point of the learning objective — the goal is to learn IDP patterns, not reinvent them
* Bad, because no portfolio signal around Backstage specifically, which is a named requirement at several target employers
* Bad, because significantly higher time investment with lower return on learning objectives
