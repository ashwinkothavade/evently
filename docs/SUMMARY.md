# Evently: Design Summary

*The short version (about 2 pages). The full design with all diagrams is in [DESIGN.md](DESIGN.md).*

## What it is
Evently is a ticketing platform. Users browse events, book tickets (general admission or reserved seats), cancel, join waitlists and get notifications. Admins create and manage events and see analytics. It is built as **five backend services behind an API gateway** plus a **React + Chakra UI** web app.

```
Browser ──▶ Gateway (JWT, rate limits, routing, Swagger)
              ├─▶ auth-service      users, login, JWT              [schema auth]
              ├─▶ catalog-service   event catalog, admin CRUD      [schema catalog]
              ├─▶ booking-service   capacity, seats, bookings,     [schema booking]
              │                     waitlist (consistency core)
              └─▶ notify-service    notifications + analytics      [schema notify]
      Services publish events through a transactional outbox into Redis Streams;
      consumers apply them exactly once.
```

## Major design decisions and trade-offs

**1. Concurrency: one atomic conditional update per booking.**
A booking is a single short transaction whose first statement is
`UPDATE inventory SET booked_count = booked_count + n WHERE event_id = $1 AND booked_count + n <= capacity …`.
Postgres row-locks the event, so concurrent buyers queue on that lock and the capacity check plus increment is one atomic step. If no row is updated, the booking is rejected with a precise reason (`SOLD_OUT`, `INSUFFICIENT_CAPACITY`, …). A `CHECK (booked_count BETWEEN 0 AND capacity)` constraint makes overselling impossible even if application code were wrong.
*Rejected:* optimistic locking for bookings (a stampede turns into a retry storm), `SERIALIZABLE` (many aborts), and Redis counters as the source of truth (they can drift from the database). *Trade-off:* writes for one event serialize on one row, which handles hundreds to low thousands of bookings per second per event; beyond that the next step is a per-event booking queue.

**2. Seats, retries and the waitlist are also enforced by the database.**
A partial unique index `UNIQUE (seat_id) WHERE active` means one seat can never be in two live bookings. `UNIQUE (user_id, idempotency_key)` makes `POST /bookings` idempotent, so client retries never double-book. When a booking is cancelled, the **same transaction** books the freed tickets for waitlisted users (FIFO, first-fit, one savepoint per promotion), so nobody can grab them in between.

**3. Service boundaries follow the consistency boundary.**
Capacity, seats, bookings and the waitlist must change together, so they all live in **booking-service** and every booking is a plain ACID transaction with no distributed transactions. Splitting them across services would have needed sagas and weakened the no-oversell guarantee. Each service owns one Postgres schema and never reads another's tables. A single Postgres instance keeps hosting cheap; any schema can move to its own database with a connection-string change.

**4. Two communication styles, chosen deliberately.**
*Commands that need an answer* are synchronous internal HTTP. For example, catalog asks booking-service to apply a capacity change, and booking-service rejects it if the new capacity is below tickets already sold. *Facts* (`booking.confirmed`, `event.updated`, …) go out asynchronously: written to an **outbox table in the same transaction** as the change, relayed to **Redis Streams**, and consumed by **idempotent consumers** (deduplicated through a `processed_events` table). An event is published if and only if its transaction committed, and redelivery never applies an effect twice.

**5. Optimistic locking where contention is low.**
Admin edits carry the event version (`If-Match: "3"`). A stale version returns `412 VERSION_MISMATCH`, so two admins can't silently overwrite each other.

**6. CQRS for analytics.**
notify-service builds read models (`event_stats`, `booking_facts`) from the event stream. Analytics queries never touch the booking database, so admin dashboards can't slow down ticket sales.

## Scalability
- **Stateless services** that scale horizontally. Every background worker is safe with any number of replicas: outbox relays take an advisory lock, consumers use consumer groups and `SKIP LOCKED`, migrations take an advisory lock.
- **Read path:** catalog responses are cached in Redis (5s TTL). Admin writes invalidate everything instantly by bumping a cache namespace. Keyset pagination, trigram indexes for search, and `Cache-Control` headers for CDNs.
- **Write path:** a **sold-out fast path** (a 2s Redis flag rejects requests for a sold-out event without touching Postgres), short transactions, bounded connection pools, `lock_timeout` so overload fails fast (`503` + `Retry-After`) instead of piling up, and per-user and per-IP **rate limits stored in Redis** (shared across gateway replicas).
- **Next steps:** read replicas, sharding booking-service by `event_id` (every booking transaction touches a single event, so it never crosses shards), and queue-based admission for mega on-sales.

## Fault tolerance
- Postgres is the single source of truth. Cache errors **fail open** to the database.
- If Redis is down, writes still commit and events wait in the outbox until Redis returns.
- Crashed consumers' messages are reclaimed (`XAUTOCLAIM`). Poison messages go to a dead-letter stream after 5 attempts.
- Read models use version guards, so out-of-order or replayed events can't move them backwards.
- Graceful shutdown drains HTTP, relays and consumers. Health and readiness endpoints exist per service, and `/health/services` at the gateway shows all of them.

## Creative features and optimizations
- **Seat maps:** users pick seats, or get *best available* seats that keep a party together in one row.
- **Automatic waitlist promotion** with live queue positions and "You're in!" notifications.
- **Idempotent booking** end to end: the frontend generates one key per booking attempt.
- **Notifications when an event's time or venue changes**, sent to every ticket holder.
- **`.ics` calendar export** for bookings.
- **Integrity audit endpoint** that recomputes every counter from the bookings, shown as a badge on the dashboard.
- **Load-test script** that proves "exactly capacity sold" against any deployment and reports p50/p95/p99 latency.
- **Contract test** that fails if the OpenAPI spec and the gateway routing ever disagree.
- **Consistent UI:** one Chakra UI design system, light and dark mode, and charts built on a colorblind-validated palette.

## Evidence
| Check | Result |
|---|---|
| 200 concurrent requests for 50 tickets | exactly 50 confirmed, 150 × `409` |
| 50 users racing for one seat | exactly 1 winner |
| 20 concurrent retries with one Idempotency-Key | 1 booking |
| End-to-end load test (250 users → 100 tickets, through the gateway) | 100 sold, 150 `SOLD_OUT`, integrity audit OK, p95 ≈ 280 ms locally |
| Automated test suite | 41 / 41 passing |

## API documentation
OpenAPI 3 spec: [`services/gateway/openapi.yaml`](../services/gateway/openapi.yaml) (served as Swagger UI at `/docs`). Guide with examples and the error-code catalogue: [API.md](API.md).
