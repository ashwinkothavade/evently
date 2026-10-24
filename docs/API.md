# Evently API Guide

A practical guide to the REST API. The authoritative reference is the OpenAPI spec, [`services/gateway/openapi.yaml`](../services/gateway/openapi.yaml), served as interactive Swagger UI at **`<gateway>/docs`** (locally http://localhost:8080/docs).

- **Base URL:** `<gateway>/api/v1` (locally `http://localhost:8080/api/v1`)
- **Format:** JSON in, JSON out (`Content-Type: application/json`)

## Contents
1. [Quick tour with curl](#1-quick-tour-with-curl)
2. [Authentication](#2-authentication)
3. [Response format](#3-response-format)
4. [Pagination](#4-pagination)
5. [Idempotent bookings](#5-idempotent-bookings)
6. [Optimistic locking for admin edits](#6-optimistic-locking-for-admin-edits)
7. [Rate limits](#7-rate-limits)
8. [Endpoint reference](#8-endpoint-reference)
9. [Error codes](#9-error-codes)

---

## 1. Quick tour with curl

```bash
API=http://localhost:8080/api/v1

# Register (or log in) and keep the token
TOKEN=$(curl -s -X POST $API/auth/register -H 'content-type: application/json' \
  -d '{"email":"me@example.com","name":"Me","password":"password123"}' | jq -r .data.token)

# Browse upcoming events
curl -s "$API/events?limit=5" | jq '.data[] | {id, name, availableSeats}'
EVENT=<an event id from above>

# Book two tickets (safe to retry with the same key)
curl -s -X POST $API/bookings -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d "{\"eventId\":\"$EVENT\",\"quantity\":2}" | jq .data

# My bookings
curl -s $API/bookings -H "authorization: Bearer $TOKEN" | jq '.data[] | {id, status, quantity}'

# Cancel
curl -s -X POST $API/bookings/<booking id>/cancel -H "authorization: Bearer $TOKEN" | jq .data.status
```

Admin endpoints need an admin token. Locally, log in as `admin@evently.dev` / `admin12345`.

## 2. Authentication
`POST /auth/register` and `POST /auth/login` return `{ data: { token, user } }`. Send the token on every protected call:

```
Authorization: Bearer <token>
```

Tokens are JWTs and expire after `JWT_EXPIRES_IN` (12h by default). The gateway verifies them; a missing or invalid token returns `401 UNAUTHORIZED`, and a non-admin calling `/admin/*` gets `403 FORBIDDEN`.

## 3. Response format

**Success**: the payload is always under `data`:
```json
{ "data": { "id": "…", "name": "…" } }
```
Lists add pagination info: `{ "data": [ … ], "nextCursor": "…" }` (cursor pagination) or `{ "data": [ … ], "meta": { "total": 42, "limit": 20, "offset": 0 } }` (admin lists).

**Errors** always have the same shape:
```json
{
  "error": {
    "code": "SOLD_OUT",
    "message": "This event is sold out. Join the waitlist to be notified when a spot opens.",
    "details": { "available": 0, "waitlistUrl": "/api/v1/events/…/waitlist" },
    "requestId": "1218f6eb-1d2e-4487-898f-69a67a2fb127"
  }
}
```
- Branch on **`code`**, which is stable; `message` is for humans and may change.
- `details` is optional and code-specific. For example, `VALIDATION_ERROR` lists each invalid field as `{ path, message }`.
- `requestId` matches the `X-Request-Id` response header and appears in every service's logs, so one id traces a request across services.

**Status codes**

| Code | Meaning |
|---|---|
| 200 / 201 / 204 | OK / created / no content |
| 400 | Invalid input (`VALIDATION_ERROR`, …) |
| 401 | Not authenticated |
| 403 | Authenticated but not allowed |
| 404 | Not found (also returned for other users' bookings, so ids can't be probed) |
| 409 | Conflicts with current state (`SOLD_OUT`, `SEAT_UNAVAILABLE`, …) |
| 412 | Stale version on an admin edit |
| 429 | Rate limited |
| 502 / 503 | A service is unavailable or overloaded; retry (honor `Retry-After`) |

## 4. Pagination
Public lists (`GET /events`, `GET /bookings`) use **keyset (cursor) pagination**, which stays fast however deep you page:

```bash
curl "$API/events?limit=20"                    # → { data: [...], nextCursor: "WyIyMDI2…" }
curl "$API/events?limit=20&cursor=WyIyMDI2…"   # next page; nextCursor is null on the last page
```

Admin lists use `limit` + `offset` and return `meta.total`.

## 5. Idempotent bookings
Networks fail. If a booking response is lost, the client doesn't know whether the booking happened. To make retries safe, send a unique key per booking attempt:

```
POST /bookings
Idempotency-Key: 3f1c8a52-…
```

| Situation | Response |
|---|---|
| First request | `201 Created` and the booking |
| Retry with the same key (even concurrently) | `200 OK` with the **same** booking and header `Idempotent-Replayed: true` |
| Same key reused for a different event | `409 IDEMPOTENCY_KEY_REUSED` |

Generate a new key for each *new* booking the user intends to make.

## 6. Optimistic locking for admin edits
Each event has a `version`, also returned as the `ETag` header. To edit, send the version you loaded:

```bash
curl -X PATCH $API/admin/events/$EVENT -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -H 'If-Match: "3"' -d '{"capacity": 500}'
```

If someone else changed the event in the meantime, you get `412 VERSION_MISMATCH` with `details.currentVersion`; reload and retry. (`version` in the JSON body works as an alternative to `If-Match`.)

## 7. Rate limits
| Scope | Default | Config |
|---|---|---|
| All `/api` calls, per IP | 600 / minute | `RATE_LIMIT_PER_MINUTE` |
| `POST /bookings`, per user | 30 / minute | `BOOKING_RATE_LIMIT_PER_MINUTE` |

Responses include `RateLimit` and `RateLimit-Policy` headers (IETF draft 8). When exceeded, you get `429 RATE_LIMITED`. Counters live in Redis, so the limits hold across all gateway replicas.

## 8. Endpoint reference
🔒 = needs a token, 🛡️ = needs the admin role. *Service* shows which microservice handles the call.

### Auth
| Method | Path | Description | Service |
|---|---|---|---|
| POST | `/auth/register` | Create an account → token | auth |
| POST | `/auth/login` | Sign in → token | auth |
| GET | `/me` 🔒 | Current user | auth |

### Events
| Method | Path | Description | Service |
|---|---|---|---|
| GET | `/events` | Upcoming events. Query: `q`, `venue`, `from`, `to`, `available`, `limit`, `cursor` | catalog |
| GET | `/events/{id}` | Event details incl. `availableSeats` | catalog |
| GET | `/events/{id}/seats` | Seat map with live availability (reserved-seating events) | booking |

### Bookings
| Method | Path | Description | Service |
|---|---|---|---|
| POST | `/bookings` 🔒 | Book: `{eventId, quantity}` or `{eventId, seatIds}`; header `Idempotency-Key` | booking |
| GET | `/bookings` 🔒 | My bookings, newest first. Query: `status`, `limit`, `cursor` | booking |
| GET | `/bookings/{id}` 🔒 | One booking | booking |
| POST | `/bookings/{id}/cancel` 🔒 | Cancel; freed tickets go to the waitlist | booking |
| GET | `/bookings/{id}/calendar.ics` 🔒 | Download an iCalendar entry | booking |

### Waitlist
| Method | Path | Description | Service |
|---|---|---|---|
| POST | `/events/{id}/waitlist` 🔒 | Join (`{quantity}`) when the event can't fit your request | booking |
| DELETE | `/events/{id}/waitlist` 🔒 | Leave | booking |
| GET | `/waitlist` 🔒 | My entries with live queue position | booking |

### Notifications
| Method | Path | Description | Service |
|---|---|---|---|
| GET | `/notifications` 🔒 | Inbox (`unread=true` to filter), plus `meta.unreadCount` | notify |
| POST | `/notifications/{id}/read` 🔒 | Mark one read | notify |
| POST | `/notifications/read-all` 🔒 | Mark all read | notify |

Notification types: `BOOKING_CONFIRMED`, `BOOKING_CANCELLED`, `WAITLIST_PROMOTED`, `EVENT_UPDATED` (time or venue changed), `EVENT_CANCELLED`.

### Admin: events
| Method | Path | Description | Service |
|---|---|---|---|
| GET | `/admin/events` 🛡️ | All events, any status. Query: `status`, `limit`, `offset` | catalog |
| POST | `/admin/events` 🛡️ | Create (general admission `capacity` **or** `seating: {rows, seatsPerRow}`) | catalog |
| GET | `/admin/events/{id}` 🛡️ | One event; `ETag` = version | catalog |
| PATCH | `/admin/events/{id}` 🛡️ | Partial update; requires `If-Match` | catalog → booking |
| POST | `/admin/events/{id}/cancel` 🛡️ | Cancel event, all bookings and the waitlist; notifies attendees | catalog → booking |
| GET | `/admin/events/{id}/bookings` 🛡️ | Attendee list | booking |

### Admin: analytics
| Method | Path | Description | Service |
|---|---|---|---|
| GET | `/admin/analytics/overview` 🛡️ | Tickets sold, revenue, cancellation rate, utilization, waitlist totals | notify |
| GET | `/admin/analytics/popular-events` 🛡️ | Most-booked events (`limit`) | notify |
| GET | `/admin/analytics/capacity-utilization` 🛡️ | Per-event utilization (`upcoming`, `limit`) | notify |
| GET | `/admin/analytics/daily` 🛡️ | Per-day bookings, cancellations, revenue (`from`, `to`, max 366 days) | notify |
| GET | `/admin/analytics/events/{id}` 🛡️ | Per-event drill-down incl. daily series | notify |
| GET | `/admin/analytics/integrity` 🛡️ | Audits counters against bookings | booking |

### Operational (gateway, not under `/api`)
| Path | Description |
|---|---|
| `/health` | Gateway liveness |
| `/health/services` | Readiness of every service, with latency |
| `/docs`, `/openapi.json` | Swagger UI and raw spec |

## 9. Error codes

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body or query failed validation; see `details` |
| `INVALID_JSON` | 400 | Body isn't valid JSON |
| `INVALID_CURSOR` | 400 | Malformed pagination cursor |
| `QUANTITY_LIMIT_EXCEEDED` | 400 | More tickets than the event's `maxPerBooking` |
| `INVALID_SEAT` | 400 | A seat id doesn't belong to this event |
| `SEAT_SELECTION_NOT_SUPPORTED` | 400 | `seatIds` sent for a general-admission event |
| `NOT_SEATED` | 400 | Seat map requested for a general-admission event |
| `VERSION_REQUIRED` | 400 | Admin edit without `If-Match` / `version` |
| `INVALID_TIME_RANGE` | 400 | `endsAt` not after `startsAt` |
| `UNAUTHORIZED` | 401 | Missing/invalid/expired token, or wrong credentials |
| `FORBIDDEN` | 403 | Admin role required |
| `NOT_FOUND` | 404 | Resource doesn't exist or isn't visible to you |
| `ROUTE_NOT_FOUND` | 404 | No such endpoint |
| `EMAIL_TAKEN` | 409 | Registration with an existing email |
| `SOLD_OUT` | 409 | No tickets left; `details.waitlistUrl` |
| `INSUFFICIENT_CAPACITY` | 409 | Fewer tickets left than requested; `details.available` |
| `SEAT_UNAVAILABLE` | 409 | A chosen seat was just taken; `details.seatIds` |
| `EVENT_CANCELLED` | 409 | Event was cancelled |
| `EVENT_STARTED` | 409 | Booking or cancelling after the event started |
| `ALREADY_CANCELLED` | 409 | Booking or event already cancelled |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Key previously used for a different event |
| `TICKETS_AVAILABLE` | 409 | Waitlist join while tickets can still be booked |
| `ALREADY_ON_WAITLIST` | 409 | Already waiting for this event |
| `CAPACITY_BELOW_BOOKED` | 409 | New capacity is below tickets already sold |
| `SEATED_CAPACITY_FIXED` | 409 | Capacity change on a reserved-seating event |
| `VERSION_MISMATCH` | 412 | Event changed since you loaded it; `details.currentVersion` |
| `RATE_LIMITED` | 429 | Too many requests |
| `UPSTREAM_UNAVAILABLE` | 502 | Gateway couldn't reach a service |
| `BUSY` / `SERVICE_UNAVAILABLE` | 503 | Transient overload (lock timeout, dependency down); retry |
| `INTERNAL_ERROR` | 500 | Unexpected; report the `requestId` |
