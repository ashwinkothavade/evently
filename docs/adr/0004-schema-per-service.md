# 0004: One Postgres schema per service on a shared instance

**Status:** Accepted · 2026-10-24

## Context
Microservices should own their data. Running five separate Postgres instances is expensive, especially on free hosting tiers, and heavy to run locally.

## Decision
One Postgres instance with **one schema per service** (`auth`, `catalog`, `booking`, `notify`). Each service connects with `search_path=<its schema>`, applies only its own migrations (under an advisory lock, so replicas can boot together), and **never queries another service's schema**. Cross-service data flows only through APIs and events.

## Alternatives considered
- **Database per service:** the strongest isolation, but 5× the cost and operational load for this project's scale.
- **Shared tables:** cheapest, but couples services through the schema and defeats independent deployment.

## Consequences
- ➕ Ownership is clear and enforced by convention and code review; moving a service to its own database is a connection-string change.
- ➕ Cheap to host; simple local setup (one container).
- ➖ The Postgres instance is a shared failure domain and shares capacity (connection limits, I/O). Per-service pool sizes are tuned accordingly.
- ➖ Isolation relies on discipline rather than credentials. Production hardening would give each service its own role, with grants only on its schema.
