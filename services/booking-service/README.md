# booking-service

The **consistency core**: capacity, seats, bookings and the waitlist. Everything that must change atomically when tickets are sold lives here (see [ADR 0001](../../docs/adr/0001-service-boundaries.md)).

| | |
|---|---|
| Port | `4003` |
| Schema | `booking` (`inventory`, `seats`, `bookings`, `booking_seats`, `waitlist_entries`, `users` replica, `outbox`, `processed_events`) |
| Publishes | `booking.confirmed`, `booking.cancelled`, `inventory.changed` |
| Consumes | `user.registered` |

## API (via the gateway)
| Method | Path | |
|---|---|---|
| POST | `/api/v1/bookings` | Book (`quantity` or `seatIds`), idempotent with `Idempotency-Key` |
| GET | `/api/v1/bookings`, `/api/v1/bookings/:id` | History / detail |
| POST | `/api/v1/bookings/:id/cancel` | Cancel; promotes the waitlist in the same transaction |
| GET | `/api/v1/bookings/:id/calendar.ics` | iCalendar export |
| GET | `/api/v1/events/:id/seats` | Seat map |
| POST/DELETE | `/api/v1/events/:id/waitlist` | Join / leave the waitlist |
| GET | `/api/v1/waitlist` | My entries with live positions |
| GET | `/api/v1/admin/events/:id/bookings` | Attendee list |
| GET | `/api/v1/admin/analytics/integrity` | Counter audit |

**Internal (catalog-service only, never routed by the gateway):** `PUT /internal/inventory/:id` (create or update inventory; idempotent by `catalogVersion`) and `POST /internal/inventory/:id/cancel` (idempotent).

## How a booking works
[`src/reservation.ts`](src/reservation.ts) holds the only code that increases `booked_count`:
1. `UPDATE inventory SET booked_count = booked_count + n WHERE … AND booked_count + n <= capacity`. The row lock serializes concurrent buyers, and the guard is re-checked on the latest value.
2. Insert the booking; assign seats (chosen seats are validated, or the best available seats are picked, preferring one row for the party).
3. Write `booking.confirmed` and `inventory.changed` to the outbox; commit.

Backstops in the schema: `CHECK (booked_count BETWEEN 0 AND capacity)`, `UNIQUE (seat_id) WHERE active`, a composite FK from seat to event, and `UNIQUE (user_id, idempotency_key)`. Details: [ADR 0002](../../docs/adr/0002-booking-concurrency.md).

**Sold-out fast path:** after a `SOLD_OUT`, a Redis flag (`SOLD_OUT_FLAG_TTL_SECONDS`, 2s) rejects further attempts without touching Postgres; cancellations clear it.

**Waitlist:** FIFO first-fit, promoted inside the transaction that frees tickets, one savepoint per entry ([ADR 0008](../../docs/adr/0008-waitlist-auto-promotion.md)).

## Tests
`npm test -w @evently/booking-service` runs the concurrency and integrity suite against real Postgres and Redis (schema `booking_test`). See [docs/TESTING.md](../../docs/TESTING.md).

## Configuration
`DATABASE_URL`, `REDIS_URL`, `DB_POOL_MAX` (default 20, the largest of any service), `SOLD_OUT_FLAG_TTL_SECONDS`, plus the common variables.
