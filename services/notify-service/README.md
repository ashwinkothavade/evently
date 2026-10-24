# notify-service

User notifications and admin analytics, both built purely from integration events.

| | |
|---|---|
| Port | `4004` |
| Schema | `notify` (`notifications`, `users`, `event_stats`, `booking_facts`, `processed_events`) |
| Publishes | — |
| Consumes | `user.registered`, `event.created/updated/cancelled`, `booking.confirmed/cancelled`, `inventory.changed` |

## API (via the gateway)
| Method | Path | |
|---|---|---|
| GET | `/api/v1/notifications` | Inbox (`unread=true`), with `meta.unreadCount` |
| POST | `/api/v1/notifications/:id/read`, `/read-all` | Mark read |
| GET | `/api/v1/admin/analytics/overview` | Headline metrics |
| GET | `/api/v1/admin/analytics/popular-events` | Most-booked events |
| GET | `/api/v1/admin/analytics/capacity-utilization` | Utilization per event |
| GET | `/api/v1/admin/analytics/daily` | Per-day series (UTC, zero-filled) |
| GET | `/api/v1/admin/analytics/events/:id` | Per-event drill-down |

## Behavior
- **Projections** (`src/projections.ts`): each event updates the read models in one transaction, deduplicated by event id. Version guards (`catalog_version`, `inventory_version`) make them robust to reordering and replay.
- **Notifications created:**

  | Trigger | Type |
  |---|---|
  | `booking.confirmed` (direct) | `BOOKING_CONFIRMED` |
  | `booking.confirmed` (source `waitlist`) | `WAITLIST_PROMOTED` |
  | `booking.cancelled` (user/admin) | `BOOKING_CANCELLED` |
  | `booking.cancelled` (`event_cancelled`) | `EVENT_CANCELLED` |
  | `event.updated` changing time or venue | `EVENT_UPDATED` → every ticket holder |

- **Delivery:** a dispatcher (`NOTIFICATION_DISPATCH_INTERVAL_MS`) claims undelivered notifications with `FOR UPDATE SKIP LOCKED` (safe with many replicas), sends them through a `NotificationChannel` (currently a logging email stub; swap in email, SMS or push without touching anything else), and retries up to 5 times.
- **Analytics** use only the read models, so dashboards never load booking-service ([ADR 0007](../../docs/adr/0007-cqrs-analytics.md)). Cancellation rate counts user and admin cancellations, not cancellations caused by an event being called off.

## Configuration
`DATABASE_URL`, `REDIS_URL`, `NOTIFICATION_DISPATCH_INTERVAL_MS`, plus the common variables.
