# catalog-service

The event catalog: what users browse, and what admins create and edit.

| | |
|---|---|
| Port | `4002` |
| Schema | `catalog` (`events`, `outbox`, `processed_events`) |
| Publishes | `event.created`, `event.updated`, `event.cancelled` |
| Consumes | `inventory.changed` (to show availability) |
| Calls | booking-service `PUT /internal/inventory/:id`, `POST /internal/inventory/:id/cancel` |

## API (via the gateway)
| Method | Path | |
|---|---|---|
| GET | `/api/v1/events` | Upcoming published events: search (`q`, `venue`), date range, `available`, cursor pagination |
| GET | `/api/v1/events/:id` | Event details |
| GET/POST | `/api/v1/admin/events` | List any status / create |
| GET/PATCH | `/api/v1/admin/events/:id` | Read / update with optimistic locking (`If-Match`) |
| POST | `/api/v1/admin/events/:id/cancel` | Cancel the event (cascades to bookings and the waitlist) |

## Behavior
- **Caching:** list and detail reads are cached in Redis for `EVENTS_CACHE_TTL_SECONDS` (5s) and sent with `Cache-Control: public, max-age=5`. Admin writes bump a namespace counter, which invalidates every cached read at once.
- **Search:** `ILIKE` on name and venue backed by trigram GIN indexes; keyset pagination on `(starts_at, id)`.
- **Admin writes stay consistent with sales:** the catalog row is updated (with a version check) inside a transaction, booking-service is asked to apply the inventory change **synchronously**, and the catalog transaction commits only if booking-service accepted it. Booking-service rejects changes that conflict with sales (`CAPACITY_BELOW_BOOKED`, `SEATED_CAPACITY_FIXED`). The inventory command is idempotent by `catalogVersion`, so retries are safe.
- **Availability replica:** `booked_count` is kept current from `inventory.changed`, guarded by `inventory_version` so older messages are ignored.

## Configuration
`DATABASE_URL`, `REDIS_URL`, `BOOKING_SERVICE_URL` (or `BOOKING_SERVICE_HOSTPORT`), `EVENTS_CACHE_TTL_SECONDS`, plus the common variables.
