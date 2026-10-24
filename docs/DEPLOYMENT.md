# Deployment Guide

Evently runs anywhere that can run Node.js (or Docker), Postgres ≥ 13 and Redis ≥ 6.2 (Streams with `XAUTOCLAIM`).

- [Option A: Docker Compose (any VM)](#option-a-docker-compose)
- [Option B: Render Blueprint](#option-b-render-blueprint)
- [Environment variables](#environment-variables)
- [After deploying](#after-deploying)

---

## Option A: Docker Compose
Runs the whole stack (6 app containers + Postgres + Redis) on one machine.

```bash
export JWT_SECRET=$(openssl rand -hex 32)
export INTERNAL_API_TOKEN=$(openssl rand -hex 32)
export ADMIN_PASSWORD='choose-a-strong-password'
docker compose up -d --build
```

- Web app: `http://<host>:3000`. nginx serves the SPA and proxies `/api` to the gateway.
- API and docs: `http://<host>:8080/docs`

Put a TLS-terminating proxy (Caddy, nginx, a cloud load balancer) in front for HTTPS.

One `Dockerfile` builds every backend service:

```bash
docker build --build-arg SERVICE=booking-service -t evently-booking .
docker build -f frontend/Dockerfile -t evently-web .
```

## Option B: Render Blueprint
[`render.yaml`](../render.yaml) describes the full platform: 5 Node web services, a static site, Postgres and Key Value (Redis).

1. Push the repository to GitHub.
2. In Render: **New → Blueprint**, select the repository, and confirm.
3. When prompted, set `ADMIN_PASSWORD` for `evently-auth`.
4. Wait for all services to deploy. `JWT_SECRET` and `INTERNAL_API_TOKEN` are generated once and shared through the `evently-shared` environment group.
5. Open `https://evently-web.onrender.com`. The API docs are at `https://evently-gateway.onrender.com/docs`.

**Check the hostnames.** Render gives a service `https://<name>.onrender.com` when the name is free; otherwise it adds a suffix. If any hostname differs from the name in `render.yaml`, update:
- on `evently-gateway`: `AUTH_SERVICE_URL`, `CATALOG_SERVICE_URL`, `BOOKING_SERVICE_URL`, `NOTIFY_SERVICE_URL`, `CORS_ORIGINS`
- on `evently-catalog`: `BOOKING_SERVICE_URL`
- on `evently-web`: the `/api/*` rewrite destination

**Free-tier notes**
- Free web services **can't receive private-network traffic**, so service-to-service calls use public HTTPS URLs. Every service rejects requests that lack the internal token, so they are not open to the public. On paid plans you can switch to private networking by replacing each `*_SERVICE_URL` with `*_SERVICE_HOSTPORT` (`fromService … property: hostport`); the services accept either form.
- Free services **sleep after 15 minutes idle**, and the first request afterwards takes about a minute while they wake. While asleep, background consumers pause; events wait safely in Redis and the outbox and are processed when the service wakes.
- Free Postgres instances expire after 30 days on Render's current terms.

## Environment variables

**Common to every backend service**

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | | `development` | `production` in deployments |
| `LOG_LEVEL` | | `info` | pino log level |
| `INTERNAL_API_TOKEN` | ✅ | — | Shared secret that services require on every request (min 16 chars) |
| `PORT` | | per service | HTTP port |
| `DATABASE_URL` | ✅ (not gateway) | — | Postgres connection string |
| `DATABASE_SSL` | | `false` | `true` for external SSL connections |
| `DB_POOL_MAX` | | per service | Max connections per instance |
| `REDIS_URL` | ✅ | — | Redis connection string (streams, cache, rate limits) |

**Per service**

| Service | Variable | Default | Purpose |
|---|---|---|---|
| auth | `JWT_SECRET` ✅ | — | Signs tokens (same value as the gateway) |
| auth | `JWT_EXPIRES_IN` | `12h` | Token lifetime |
| auth | `BCRYPT_ROUNDS` | `10` | Password hashing cost |
| auth | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | — | Bootstrap admin, created or promoted on startup |
| catalog | `BOOKING_SERVICE_URL` | `http://localhost:4003` | For inventory commands (or `BOOKING_SERVICE_HOSTPORT`) |
| catalog | `EVENTS_CACHE_TTL_SECONDS` | `5` | Listing/detail cache TTL |
| booking | `SOLD_OUT_FLAG_TTL_SECONDS` | `2` | Sold-out fast-path duration |
| notify | `NOTIFICATION_DISPATCH_INTERVAL_MS` | `3000` | Delivery poll interval (0 disables) |
| gateway | `JWT_SECRET` ✅ | — | Verifies tokens |
| gateway | `AUTH_/CATALOG_/BOOKING_/NOTIFY_SERVICE_URL` | `http://localhost:400x` | Upstreams (or `*_HOSTPORT`) |
| gateway | `CORS_ORIGINS` | `*` | Comma-separated allowed browser origins |
| gateway | `RATE_LIMIT_ENABLED` | `true` | Disable only for local load tests |
| gateway | `RATE_LIMIT_PER_MINUTE` | `600` | Per IP |
| gateway | `BOOKING_RATE_LIMIT_PER_MINUTE` | `30` | Per user, `POST /bookings` |
| frontend (build time) | `VITE_API_URL` | empty | Gateway origin when not served behind the same origin |

Default pool sizes: auth 5, catalog 10, booking 20, notify 5. Keep the total across all instances below your Postgres connection limit.

## After deploying

```bash
# 1. Everything up?
curl https://<gateway>/health/services

# 2. Demo data (uses the public API)
API_URL=https://<gateway> ADMIN_PASSWORD=… npm run seed

# 3. Prove no overselling against the live system
API_URL=https://<gateway> ADMIN_PASSWORD=… npm run loadtest -- --users 200 --capacity 50
```

The load test registers users and books from a single IP, so keep `--users` within the gateway's per-IP limit (about `RATE_LIMIT_PER_MINUTE / 2`) or raise that limit temporarily.
