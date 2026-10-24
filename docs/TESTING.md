# Testing Guide

Evently's main promise is that **tickets are never oversold and seats are never double-booked**. The tests are built to prove that against real infrastructure, not mocks.

## Running

```bash
npm run infra:up   # Postgres + Redis
npm test           # all automated tests (~2 s)
```

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs type-checking, the tests (with Postgres and Redis service containers), a full build, and a Docker build of every image on each push.

## What is tested

### 1. Concurrency and integrity (booking-service)
[`services/booking-service/test/concurrency.test.ts`](../services/booking-service/test/concurrency.test.ts) runs the real booking app in-process against **real Postgres and Redis**, in an isolated `booking_test` schema that is rebuilt on every run, and fires genuinely concurrent HTTP requests.

| Test | Proves |
|---|---|
| 200 concurrent single-ticket requests for 50 tickets | Exactly 50 × `201`, 150 × `409`, counter = 50 |
| 120 concurrent mixed-quantity (1–4) requests for 37 tickets | Tickets sold never exceed capacity; counter matches |
| Integrity audit after both stampedes | Counters exactly equal the confirmed bookings |
| 50 users racing for the same seat | Exactly one winner; the rest get `SEAT_UNAVAILABLE` |
| Best-available assignment | A party of 3 is placed together in one row |
| 20 concurrent requests with one Idempotency-Key | One booking created; all responses return the same booking |
| Cancellation with a waitlist | FIFO first-fit promotion; large requests keep their place |
| Waitlist while tickets remain | Rejected with `TICKETS_AVAILABLE` |
| Double cancellation / cancelling someone else's booking | `409 ALREADY_CANCELLED` / `404` |
| Capacity below tickets sold | `409 CAPACITY_BELOW_BOOKED` |
| Request without internal token | `401`: services can't be called around the gateway |

### 2. API contract (gateway)
[`services/gateway/test/routes.test.ts`](../services/gateway/test/routes.test.ts) reads `openapi.yaml` and asserts that **every documented operation** (29 of them) is routed to a service with exactly the documented access level (public / user / admin), and that `/internal/*` is never exposed. The documentation can't drift from the real edge behavior.

### 3. End-to-end load test
[`scripts/loadtest.ts`](../scripts/loadtest.ts) runs against any gateway, local or deployed, through the full stack:
1. Creates an event with the given capacity.
2. Registers N users.
3. Fires all N booking requests **at the same instant**.
4. Reports status codes, latency percentiles and throughput.
5. Verifies sold ≤ capacity and runs the integrity audit. Exits non-zero on any oversell.

```bash
npm run loadtest -- --users 250 --capacity 100            # local
API_URL=https://<gateway> npm run loadtest -- --users 200 --capacity 50
```

Result on a laptop (all services in dev mode, single Postgres):

```
Responses:
  201 created                      100
  409 SOLD_OUT                     150
Latency (ms):
  p50 263   p95 282   p99 283   max 283
  throughput ≈ 865 req/s (wall 289 ms)
Verdict:
  tickets sold 100 / capacity 100 → ✅ no overselling
  ✅ sold 100 of the 100 that could fit
  integrity audit: ✅ counters match bookings
```

### 4. Type safety
`npm run typecheck` runs strict TypeScript over all 7 workspaces. Event payloads are typed from one contract file shared by producers and consumers.

## Manual checks worth doing in a demo
- Book the last tickets in two browser windows at once: one succeeds, the other is offered the waitlist.
- Join the waitlist, cancel from another account, and watch the waitlisted user get a booking and a "You're in!" notification.
- Open the same event in two admin tabs and save in both: the second save gets `412` and a reload prompt.
- `GET /admin/analytics/integrity` after any of the above should report `ok: true`.
