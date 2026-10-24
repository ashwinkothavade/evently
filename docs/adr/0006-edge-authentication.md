# 0006: Authenticate at the gateway; internal token between services

**Status:** Accepted · 2026-10-24

## Context
Every service needs to know who is calling. Having each service verify JWTs spreads the signing secret and the auth logic. Services may also be reachable directly (for example, public URLs on free hosting tiers).

## Decision
- auth-service issues JWTs (HS256). **Only the gateway verifies them.**
- The gateway strips any client-supplied `x-user-*` and `x-internal-token` headers, enforces the route's access level (`public`/`user`/`admin`), and forwards the verified identity as `x-user-id`, `x-user-email` and `x-user-role` together with `x-internal-token`.
- Every service **rejects requests without a valid internal token** (constant-time comparison) and trusts identity headers only when the token is valid. Services check roles again (defense in depth).
- `/internal/*` command endpoints are absent from the gateway's routing table.

## Alternatives considered
- **JWT verification in every service:** duplicated logic and secret distribution.
- **mTLS between services:** the strongest option, but heavy for this deployment target. It's the natural upgrade where a service mesh exists.

## Consequences
- ➕ One place for authentication, rate limiting and CORS. Services stay simple.
- ➕ Services can't be abused even when publicly reachable.
- ➖ The internal token is a shared secret; it should be rotated and kept out of logs (it is redacted in logs).
