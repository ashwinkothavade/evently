# gateway

The **only public entry point** to the Evently backend. It holds no data.

| | |
|---|---|
| Port | `8080` |
| Depends on | Redis (rate-limit counters), the four services |
| Code | `src/app.ts` (pipeline), `src/routes.ts` (routing table), `openapi.yaml` (API spec) |

## Request pipeline
1. Request id (`X-Request-Id`, generated or passed through), structured access log
2. `helmet` security headers, CORS (`CORS_ORIGINS`)
3. Per-IP rate limit on `/api`, stored in Redis so it is shared across replicas
4. **Route resolution** against the table in `src/routes.ts`; unknown paths (including all `/internal/*`) → `404`
5. **Authentication:** verifies the JWT; enforces the route's access level (`public` / `user` / `admin`) → `401` / `403`
6. Per-user rate limit on `POST /api/v1/bookings`
7. **Proxy** to the owning service with `x-internal-token`, `x-request-id` and the verified `x-user-id/-email/-role`. Client-supplied copies of these headers are stripped first.
8. Upstream failure → `502 UPSTREAM_UNAVAILABLE`

## Endpoints of its own
| Path | Purpose |
|---|---|
| `/health` | Liveness |
| `/health/services` | Readiness of every service with latency (`503` if any is down) |
| `/docs` | Swagger UI for `openapi.yaml` |
| `/openapi.json` | Raw spec |

## Configuration
`PORT`, `REDIS_URL`, `JWT_SECRET`, `INTERNAL_API_TOKEN`, `AUTH_/CATALOG_/BOOKING_/NOTIFY_SERVICE_URL` (or `*_HOSTPORT`), `CORS_ORIGINS`, `RATE_LIMIT_ENABLED`, `RATE_LIMIT_PER_MINUTE`, `BOOKING_RATE_LIMIT_PER_MINUTE`. See [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md#environment-variables).

## Tests
`npm test -w @evently/gateway` checks that every operation in `openapi.yaml` is routed with the documented access level.
