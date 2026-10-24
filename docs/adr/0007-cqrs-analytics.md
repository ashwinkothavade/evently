# 0007: Analytics from event-fed read models (CQRS)

**Status:** Accepted · 2026-10-24

## Context
Admin analytics (totals, popular events, daily series, cancellation rates) run aggregate queries. Running them on booking-service's tables would compete with ticket sales for the same rows and connections, especially during an on-sale, which is exactly when admins watch the dashboard.

## Decision
notify-service consumes `booking.*`, `event.*`, `inventory.changed` and `user.registered`, and maintains its own **read models**: `booking_facts` (one row per booking, with status and reason), `event_stats` (capacity, sold, waitlist size) and `users`. All analytics endpoints query these. The one exception is the integrity audit, which deliberately reads booking-service's authoritative data.

## Alternatives considered
- **Query booking-service's tables directly:** couples schemas and loads the hot path.
- **A read replica of the booking database:** removes load, but still couples to booking's schema.
- **A separate analytics service:** cleaner in theory; merged into notify-service because both are pure event consumers, which keeps the service count manageable.

## Consequences
- ➕ Dashboards can never slow down bookings.
- ➕ Read models are shaped for the queries (pre-joined, indexed for time ranges).
- ➖ Numbers are eventually consistent (milliseconds behind).
- ➖ notify-service has two responsibilities; it could be split if either grows.
