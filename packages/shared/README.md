# @evently/shared

Building blocks used by every backend service. Import by sub-path, e.g. `@evently/shared/db`.

| Module | Provides |
|---|---|
| `env` | `loadEnv(shape)`: zod-validated config that exits with a readable error; `serviceUrl()` for `*_URL` / `*_HOSTPORT` |
| `logger` | pino logger (`initLogger(service, level)`), with secrets redacted |
| `errors` | `AppError` and helpers (`badRequest`, `conflict`, `notFound`, …) |
| `http` | `createServiceApp()`: health/ready probes, internal-token check, user context from gateway headers, JSON body, error envelope. Plus `requireUser`, `requireAdmin`, `currentUser` |
| `db` | `createDatabase()`: pool scoped to the service's schema, `withTransaction` (deadlock retry), `migrate` (advisory-locked), `withSavepoint`, `PgCode` |
| `bus` | Transactional outbox (`publish`, `startOutboxRelay`) and idempotent Redis Streams consumer (`startConsumer`) |
| `contracts` | Stream names and **typed payloads of every integration event**, plus the internal inventory API |
| `cache` | Fail-open Redis cache with read-through `getOrLoad` |
| `redis` | Redis client factory |
| `internal-client` | Service-to-service HTTP client that re-raises downstream errors with their codes |
| `lifecycle` | `serve()`: HTTP server with graceful shutdown hooks |
| `pagination`, `validate`, `time` | Keyset cursors, Zod helpers, ISO date helpers |

The package builds to `dist/` (`npm run build:shared`). In development, services resolve it straight from `src/` through the `development` export condition, so edits apply without rebuilding.
