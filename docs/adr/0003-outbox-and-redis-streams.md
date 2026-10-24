# 0003: Transactional outbox + Redis Streams for integration events

**Status:** Accepted · 2026-10-24

## Context
Services must react to each other's changes: notifications on booking, catalog availability after sales, analytics on everything. Writing to the database and then publishing to a broker is a *dual write*: a crash in between either loses the event or publishes one for a change that rolled back.

## Decision
- **Producer side:** `publish(tx, type, payload)` inserts into the service's `outbox` table **in the same transaction** as the business change. A relay copies committed rows to that service's Redis stream (`XADD`, capped length) and marks them published. It is kicked right after each commit and also polls every second. A Postgres advisory lock lets only one relay replica publish at a time, so stream order matches outbox order.
- **Consumer side:** one consumer group per service. Each message is handled in a DB transaction that first inserts its id into `processed_events`, so duplicates are skipped and effects apply exactly once. Pending messages from crashed consumers are reclaimed with `XAUTOCLAIM`. After 5 failures a message moves to a dead-letter stream.
- **Ordering:** read models apply version guards (`catalog_version`, `inventory_version`), so out-of-order or replayed events can't move them backwards.
- **Contracts:** all payload types live in `packages/shared/src/contracts.ts`.

## Alternatives considered
- **Kafka / RabbitMQ:** more mature tooling and retention, but another heavy component to operate. Redis is already needed for caching and rate limits.
- **Synchronous HTTP fan-out:** couples availability (notify down means booking down) and adds latency to the hot path.
- **Postgres LISTEN/NOTIFY:** not durable; messages are lost while a consumer is down.

## Consequences
- ➕ No lost or phantom events, even when Redis is down, because events wait in the outbox.
- ➕ A new service can replay a stream from the start to build its read models.
- ➖ Read models are eventually consistent (milliseconds normally).
- ➖ Stream retention is bounded (`MAXLEN ~100k`); long-term history lives in the services' own tables.
