import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startConsumer, startOutboxRelay } from '@evently/shared/bus';
import { Cache } from '@evently/shared/cache';
import { Streams } from '@evently/shared/contracts';
import { createDatabase } from '@evently/shared/db';
import { createServiceApp } from '@evently/shared/http';
import { createInternalClient } from '@evently/shared/internal-client';
import { serve } from '@evently/shared/lifecycle';
import { createRedis } from '@evently/shared/redis';
import { config } from './config.js';
import { catalogRoutes } from './routes.js';
import { createCatalogService } from './service.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

const db = createDatabase({ url: config.DATABASE_URL, schema: 'catalog', ssl: config.DATABASE_SSL, poolMax: config.DB_POOL_MAX });
await db.migrate(migrationsDir);

const redis = createRedis(config.REDIS_URL, 'catalog-service');
const relay = startOutboxRelay({ db, redis, stream: Streams.catalog, source: 'catalog-service' });

const catalog = createCatalogService({
  db,
  cache: new Cache(redis, 'catalog'),
  cacheTtlSeconds: config.EVENTS_CACHE_TTL_SECONDS,
  booking: createInternalClient(config.BOOKING_SERVICE_URL, config.INTERNAL_API_TOKEN, { timeoutMs: 15_000 }),
  onPublished: relay.kick,
});

const consumer = startConsumer({
  db,
  redis: createRedis(config.REDIS_URL, 'catalog-service:consumer'),
  group: 'catalog-service',
  streams: [Streams.booking],
  handlers: catalog.handlers,
});

const app = createServiceApp({
  name: 'catalog-service',
  internalToken: config.INTERNAL_API_TOKEN,
  routers: [catalogRoutes(catalog)],
  ready: db.ping,
});

serve(app, config.PORT, [consumer.stop, relay.stop, async () => redis.quit(), db.close]);
