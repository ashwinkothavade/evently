# Architecture Decision Records

Short records of the significant decisions behind Evently: the context, what was decided and what it costs. Each ADR is immutable once accepted; a change of mind gets a new ADR that supersedes the old one.

| # | Decision | Status |
|---|---|---|
| [0001](0001-service-boundaries.md) | Split services along the consistency boundary | Accepted |
| [0002](0002-booking-concurrency.md) | Atomic conditional UPDATE (row lock) for booking concurrency | Accepted |
| [0003](0003-outbox-and-redis-streams.md) | Transactional outbox + Redis Streams for integration events | Accepted |
| [0004](0004-schema-per-service.md) | One Postgres schema per service on a shared instance | Accepted |
| [0005](0005-optimistic-locking-admin-edits.md) | Optimistic locking for admin event edits | Accepted |
| [0006](0006-edge-authentication.md) | Authenticate at the gateway; internal token between services | Accepted |
| [0007](0007-cqrs-analytics.md) | Analytics from event-fed read models (CQRS) | Accepted |
| [0008](0008-waitlist-auto-promotion.md) | Waitlist auto-promotion, FIFO first-fit, in the freeing transaction | Accepted |

Template: **Context** (forces at play) → **Decision** → **Alternatives considered** → **Consequences** (good and bad).
