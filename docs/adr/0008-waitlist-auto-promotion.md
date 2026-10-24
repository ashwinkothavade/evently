# 0008: Waitlist auto-promotion, FIFO first-fit, in the freeing transaction

**Status:** Accepted · 2026-10-24

## Context
When an event is sold out, users can join a waitlist. When tickets free up (cancellation, capacity increase, draft → published), they should go to waiting users fairly, and not to whoever happens to refresh first.

## Decision
- Promotion runs **inside the same transaction that freed the tickets**, so no other request can take them in between.
- Waiting entries are locked in FIFO order (`created_at, id`) with `FOR UPDATE SKIP LOCKED`.
- **First-fit:** an entry that wants more tickets than are free is skipped but keeps its place; smaller entries behind it are served.
- Each promotion creates a real booking (`source = 'waitlist'`) through the same `reserveTickets` path as normal bookings, inside a **savepoint**. If one promotion fails (for example, the admin has since lowered `max_per_booking`), only that entry is expired and the rest of the transaction commits.
- The user is notified (`WAITLIST_PROMOTED`) through the event stream.

## Alternatives considered
- **Strict FIFO** (stop at the first entry that doesn't fit): fairer to large parties, but freed seats can stay empty while smaller requests wait.
- **Notify-and-claim** (offer the spot for N minutes): gives users a choice, but needs reservation holds, expiry jobs and more UI. It is a reasonable future extension.

## Consequences
- ➕ No ticket sniping; zero-click experience for waitlisted users.
- ➕ Higher seat utilization.
- ➖ Not strictly first-come-first-served for large requests.
- ➖ Users are booked without a final confirmation step; they can cancel at no cost.
