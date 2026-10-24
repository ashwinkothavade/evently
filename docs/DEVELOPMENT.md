# Development Guide

How to run, change and extend Evently locally.

## Prerequisites
- **Node.js ≥ 20.12** (22 LTS recommended)
- **Docker** (for Postgres 17 and Redis 7)

## First run

```bash
npm install
cp .env.example .env      # one shared config file for all services
npm run infra:up          # Postgres + Redis in Docker
npm run dev               # 5 services + web app with hot reload
npm run seed              # optional: demo events, users, bookings
```

| URL | What |
|---|---|
| http://localhost:5173 | Web app (Vite proxies `/api` to the gateway) |
| http://localhost:8080/docs | Swagger UI |
| http://localhost:8080/health/services | Status of every service |

Accounts: `admin@evently.dev` / `admin12345` (admin, from `.env`). After seeding, also `alice@evently.dev`, `bob@evently.dev`, … with password `password123`.

On startup each service creates its schema and applies its migrations. To start from scratch:

```bash
docker compose down -v && npm run infra:up
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | All services + frontend (`concurrently`, colored prefixes) |
| `npm run dev:api` | Backend services only |
| `npm run dev -w @evently/<service>` | A single workspace |
| `npm run build` | Build every workspace (`dist/`) |
| `npm run typecheck` | Type-check every workspace |
| `npm test` | Gateway contract tests + booking concurrency tests ([TESTING.md](TESTING.md)) |
| `npm run seed` | Demo data through the public API (`API_URL` to target a deployment) |
| `npm run loadtest -- --users 300 --capacity 100` | Concurrency load test ([TESTING.md](TESTING.md)) |
| `npm run infra:up` / `infra:down` | Start/stop Postgres + Redis |
| `docker compose up --build` | Whole stack in containers (web app on http://localhost:3000) |

## Repository layout

```
├── frontend/                  React 19 + Vite + Chakra UI v3 + TanStack Query
│   └── src/
│       ├── api/               typed client, React Query hooks, response types
│       ├── auth/              session context (JWT in localStorage)
│       ├── components/        shared UI (layout, cards, states, seat picker…)
│       ├── pages/             screens; pages/admin/* is lazy-loaded
│       └── theme/             design system (brand tokens, chart palette, color mode)
├── packages/shared/           code shared by every service (see its README)
├── services/
│   ├── gateway/               edge: auth, rate limits, routing, openapi.yaml
│   ├── auth-service/
│   ├── catalog-service/
│   ├── booking-service/       + test/ (concurrency integration tests)
│   └── notify-service/
├── scripts/                   seed.ts, loadtest.ts
├── docs/                      design, API, guides, ADRs
├── Dockerfile                 builds any service: --build-arg SERVICE=<name>
├── docker-compose.yml         full stack (or just postgres + redis)
└── render.yaml                Render blueprint
```

Each service follows the same layout:

```
services/<name>/
├── migrations/NNN_*.sql   schema owned by this service (applied on boot)
└── src/
    ├── index.ts           composition root: DB, Redis, relay/consumer, HTTP server
    ├── config.ts          env validation (zod); fails fast on bad config
    ├── routes.ts          HTTP layer: validation + status codes only
    └── *.ts               business logic (no Express types)
```

## Configuration
Every service validates its environment at startup and exits with a readable error if anything is wrong. Locally, all services read the root `.env`; real environment variables always take precedence. See [DEPLOYMENT.md § Environment variables](DEPLOYMENT.md#environment-variables) for the full reference.

## Conventions
- **TypeScript strict mode**, ES modules, `noUncheckedIndexedAccess`.
- **Validation at the edge of each service** with Zod (`parse(schema, input)` → `400 VALIDATION_ERROR`).
- **Errors:** throw `AppError` helpers (`badRequest`, `conflict`, `notFound`, …) from `@evently/shared/errors`. The shared error handler turns them, and known Postgres errors, into the standard error envelope. Never send ad-hoc error JSON.
- **SQL:** hand-written and always parameterized. Anything that must be atomic goes through `db.withTransaction`, which also retries deadlocks.
- **Cross-service data:** never query another service's schema. Call its API (for commands) or consume its events (for facts).
- **Logging:** structured JSON via pino, with the request id propagated from the gateway. Log context objects, not interpolated strings.

## How to…

### Add an endpoint
1. Implement the logic in the owning service (a function taking plain arguments).
2. Add the route in that service's `routes.ts` with a Zod schema.
3. Add a rule to `services/gateway/src/routes.ts` (path pattern, service, `public`/`user`/`admin`).
4. Document it in `services/gateway/openapi.yaml`. The gateway contract test fails if steps 3 and 4 disagree.
5. Add a typed hook in `frontend/src/api/hooks.ts` if the UI needs it.

### Publish a new integration event
1. Add the type and payload to `EventPayloads` in `packages/shared/src/contracts.ts`.
2. In the producer, call `publish(tx, 'my.event', payload)` **inside the same transaction** as the change, then `relay.kick()` after commit.
3. In each consumer, add a handler to its `HandlerMap`. It runs in a transaction and is deduplicated automatically; make it tolerant of ordering (version guards or upserts).

### Change a schema
Add a new numbered file, e.g. `services/booking-service/migrations/002_add_x.sql`. Never edit an applied migration. Each migration runs in a transaction and is recorded in that schema's `schema_migrations`.

### Add a service
Copy the shape of `notify-service`: `config.ts` with `loadEnv`, a migration creating its tables (plus `outbox` / `processed_events` if it publishes or consumes), `createServiceApp(...)`, `serve(...)`. Register it in the root `package.json` workspaces, `docker-compose.yml`, `render.yaml` and the gateway's service map and routes.

## Frontend notes
- **Design system:** `frontend/src/theme/system.ts` defines the `brand` palette (semantic tokens for light and dark), the `card` layer style and the validated `chart.*` colors. Components use `colorPalette="brand"` and semantic tokens (`fg.muted`, `bg.panel`, …) instead of raw colors.
- **Data:** every server call goes through `src/api/hooks.ts` (TanStack Query). Mutations invalidate the affected queries, so lists refresh themselves.
- **Errors:** `ApiError` exposes the API's `code`, and screens branch on it (for example `SOLD_OUT` → waitlist UI).
- **Idempotency:** the booking panel keeps one `Idempotency-Key` per attempt and rotates it after a definitive answer.
