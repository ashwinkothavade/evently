# 0001: Split services along the consistency boundary

**Status:** Accepted · 2026-10-24

## Context
The platform is built as microservices. The one invariant that must never break is *tickets sold ≤ capacity* (and *one live booking per seat*). Checking capacity, creating the booking, assigning seats and handing freed tickets to the waitlist all read and write the same data and must succeed or fail together.

## Decision
Five services, with boundaries drawn around **what must be transactionally consistent**:

| Service | Owns |
|---|---|
| auth | users, credentials, JWT issuing |
| catalog | event descriptions, search, admin editing |
| **booking** | **capacity (inventory), seats, bookings, waitlist** |
| notify | notifications, analytics read models |
| gateway | no data: authentication, rate limiting, routing |

Everything that participates in the no-oversell invariant lives in booking-service, so a booking is one local ACID transaction.

## Alternatives considered
- **Separate "events" and "bookings" services, with capacity in the events service.** Every booking would then need a distributed protocol (a saga with compensations, or 2PC). That means more failure modes and a window where both sides disagree, which is unacceptable for this invariant.
- **Separate waitlist service.** Promotion would then be asynchronous after cancellation, letting someone else grab the freed tickets first.
- **A single service.** Simpler, but it doesn't meet the architecture requirement or allow independent scaling of the booking hot path.

## Consequences
- ➕ The core guarantee rests on plain database transactions and is easy to reason about and test.
- ➕ booking-service can be scaled and tuned (pool size, replicas) independently of the rest.
- ➖ booking-service is the largest service, and catalog must keep it in sync (see [0003](0003-outbox-and-redis-streams.md) and the synchronous inventory command).
- ➖ Event data is duplicated (catalog's description vs booking's inventory). The inventory sync is versioned and idempotent to manage this.
