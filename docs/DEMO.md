# Video Walkthrough Script (5–7 minutes)

A suggested structure for the submission video. Times are targets, and each section lists what to show and what to say.

## Before recording
```bash
docker compose down -v && npm run infra:up   # clean database
npm run dev                                  # all services + web app
npm run seed                                 # demo data
```
Open these tabs:
1. Web app at http://localhost:5173, signed in as `alice@evently.dev` / `password123`
2. A private window signed in as `dan@evently.dev` / `password123` (Dan is #1 on the Sunrise Yoga waitlist for 1 ticket; Erin is #2 for 2 tickets)
3. Web app signed in as `admin@evently.dev` / `admin12345`
4. Swagger at http://localhost:8080/docs
5. A terminal in the repo root
6. [docs/DESIGN.md](DESIGN.md) on GitHub (diagrams render there)

---

## 0:00–0:40 · Intro and architecture
**Show:** the architecture diagram in DESIGN.md §2.
**Say:** "Evently is a ticketing platform built as five services behind a gateway, with a React + Chakra UI frontend. The core requirement is that we never oversell, even when thousands of people book at once. I drew the service boundaries around that guarantee: capacity, seats, bookings and the waitlist all live in booking-service, so every booking is one database transaction. Services publish events through a transactional outbox into Redis Streams, and consumers apply each one exactly once."

## 0:40–1:50 · User flow
**Show (Alice):** event list (search, "available only") → *Hamilton* → **Pick my seats** → choose two seats → book → toast → *My bookings* (seats, **Add to calendar**) → notification bell.
**Say:** "Availability is cached for a few seconds for browsing, but booking always checks live capacity. The booking request carries an Idempotency-Key, so a double-click or network retry can't double-book."

## 1:50–2:50 · Sold out → waitlist → automatic promotion
**Show:** *Sunrise Yoga* is sold out. In Dan's window, *My bookings* shows him at position #1 on the waitlist. In Alice's window, cancel her Sunrise Yoga booking (2 tickets). Back in Dan's window: refresh *My bookings* to see a new booking marked "From waitlist", then the "You're in!" notification. In the admin *Analytics → Capacity utilization*, Sunrise Yoga still shows 1 person waiting (Erin).
**Say:** "Cancelling and promoting happen in the same transaction, so nobody can grab the freed tickets in between. Dan was first in line and was booked automatically. Erin wants 2, but only 1 is left, so she keeps her place until enough frees up. Promotion is first-fit: someone wanting more than is free doesn't block smaller requests behind them."

## 2:50–3:50 · Admin
**Show (admin):** *Manage events* → create a reserved-seating event → edit the capacity of a general-admission event below the tickets sold (`CAPACITY_BELOW_BOOKED`) → open the same event in two tabs, save both (second gets the "someone else changed this" message) → attendees drawer → *Analytics* (KPIs, daily chart and table toggle, popular events, utilization, green integrity badge).
**Say:** "Admin edits use optimistic locking with a version and If-Match header, which suits low-contention edits. Capacity belongs to booking-service, so catalog asks it synchronously and the edit rolls back if it would conflict with sales. Analytics come from notify-service's read models, built from the event stream, so dashboards never load the booking database."

## 3:50–5:00 · Proving concurrency
**Show (terminal):**
```bash
npm test
npm run loadtest -- --users 250 --capacity 100
```
**Say:** "The integration tests fire 200 simultaneous requests at 50 tickets against real Postgres, and exactly 50 succeed. 50 users race for one seat and exactly one wins. The load test goes through the whole stack: 250 users, 100 tickets, exactly 100 sold, and the integrity audit confirms the counters match the bookings."
**Show:** `services/booking-service/src/reservation.ts`, the conditional `UPDATE`.
**Say:** "This is the core: a single conditional update. Postgres row-locks the event and re-checks the guard against the latest committed value, and a CHECK constraint backs it up in the schema. I rejected optimistic locking for bookings because a stampede turns into a retry storm."

## 5:00–6:00 · Scalability and fault tolerance
**Show:** DESIGN.md §8–9 and the booking sequence diagram (§7.1).
**Say:**
- "Services are stateless and every background worker is safe to run as multiple replicas: an advisory lock on the relay, consumer groups, and SKIP LOCKED."
- "Sold-out fast path: after a sold-out, a two-second Redis flag rejects the herd without touching Postgres."
- "Lock timeouts turn overload into fast 503s, and idempotency keys make retries safe."
- "If Redis goes down, bookings still commit and events wait in the outbox."
- "The next step for extreme on-sales is sharding booking-service by event, since every booking touches exactly one event."

## 6:00–6:40 · Challenges and wrap-up
Pick two or three:
- "**Keeping read models correct with at-least-once delivery.** I solved it with a processed-events table in the same transaction, plus version guards for ordering."
- "**Cross-service validation of capacity changes.** I used a synchronous, idempotent command instead of an event, because the admin needs an immediate yes or no."
- "**Waitlist fairness vs. utilization.** I chose first-fit with savepoints, so one failed promotion can't undo a cancellation."
- "**Keeping the docs honest.** A contract test fails if the OpenAPI spec and the gateway routing disagree."

**Close:** show Swagger at `/docs` and the README. "Everything is documented: the design doc, ADRs, the API guide, and deployment and testing guides."
