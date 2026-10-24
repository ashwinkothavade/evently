# 0005: Optimistic locking for admin event edits

**Status:** Accepted · 2026-10-24

## Context
Two admins may edit the same event at once. With last-write-wins, one admin's change silently disappears.

## Decision
Events carry a `version`. Reads return it (in the body and as an `ETag`), and writes must send it back (`If-Match: "3"` or `version` in the body). The update runs `… WHERE id = $1 AND version = $2` and increments the version. If no row matches, the response is `412 VERSION_MISMATCH` with the current version. The web app shows a "reload and retry" message.

## Alternatives considered
- **Pessimistic locking (lock while editing):** needs lock leases and expiry, and abandoned editors block everyone.
- **Last write wins:** silent data loss.

## Consequences
- ➕ No lost updates, no locks held across user think-time.
- ➕ Contention is low for admin edits, so conflicts are rare and cheap.
- ➖ Clients must send the version. Requests without one get `400 VERSION_REQUIRED` rather than an unsafe write.
- This is the deliberate counterpart to [0002](0002-booking-concurrency.md): optimistic where conflicts are rare, pessimistic where they're constant.
