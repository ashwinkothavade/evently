# 0002: Atomic conditional UPDATE (row lock) for booking concurrency

**Status:** Accepted · 2026-10-24

## Context
Thousands of users may try to book the same event at the same moment. A naive "read availability, then insert booking" has a race window that oversells.

## Decision
Each booking transaction starts with one statement:

```sql
UPDATE inventory SET booked_count = booked_count + $qty
 WHERE event_id = $1 AND status = 'published' AND starts_at > now()
   AND booked_count + $qty <= capacity AND $qty <= max_per_booking
RETURNING …
```

Postgres row-locks the event row, and concurrent transactions wait and then re-check the `WHERE` clause against the newly committed value. Zero rows updated means the booking is rejected, and a follow-up read explains why. As a backstop, `CHECK (booked_count BETWEEN 0 AND capacity)` makes an oversell impossible even if the guard were removed. Seats are assigned after the lock is taken, with `UNIQUE (seat_id) WHERE active` as the second safety net. Connections set `lock_timeout = 5s`, so overload fails fast with `503` instead of piling up.

## Alternatives considered
| Option | Why not |
|---|---|
| Optimistic locking (version column + retry) | Under a stampede almost every attempt conflicts, turning load into a retry storm |
| `SERIALIZABLE` isolation | Correct, but produces many serialization failures under contention |
| `SELECT … FOR UPDATE` then `UPDATE` | Same locking with an extra round trip |
| Redis `DECR` as the source of truth | Fast, but Redis and Postgres can drift apart (crashes between the two writes) |
| Queue with a single consumer per event | Strongest under extreme load, but makes booking asynchronous for the client; kept as the scale-up path |

## Consequences
- ➕ Provably no oversell, with no retry loop and a single round trip for the check.
- ➕ Verified by tests: 200 concurrent requests for 50 tickets produce exactly 50 bookings.
- ➖ Writes for **one** event serialize on its row, which caps per-event throughput at hundreds to low thousands of bookings per second. Mitigated by keeping transactions to a few milliseconds and by the sold-out fast path (a Redis flag that rejects requests for a sold-out event before they reach Postgres).
