import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOutboxRelay } from '@evently/shared/bus';
import { Streams } from '@evently/shared/contracts';
import { createDatabase } from '@evently/shared/db';
import { createServiceApp } from '@evently/shared/http';
import { serve } from '@evently/shared/lifecycle';
import { logger } from '@evently/shared/logger';
import { createRedis } from '@evently/shared/redis';
import { config } from './config.js';
import { authRoutes } from './routes.js';
import { createAuthService } from './service.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

const db = createDatabase({ url: config.DATABASE_URL, schema: 'auth', ssl: config.DATABASE_SSL, poolMax: config.DB_POOL_MAX });
await db.migrate(migrationsDir);

const redis = createRedis(config.REDIS_URL, 'auth-service');
const relay = startOutboxRelay({ db, redis, stream: Streams.auth, source: 'auth-service' });
const auth = createAuthService(db, relay.kick);

if (config.ADMIN_EMAIL && config.ADMIN_PASSWORD) {
  await auth.ensureAdmin(config.ADMIN_EMAIL, config.ADMIN_PASSWORD);
  logger.info({ email: config.ADMIN_EMAIL }, 'Bootstrap admin ensured');
}

const app = createServiceApp({
  name: 'auth-service',
  internalToken: config.INTERNAL_API_TOKEN,
  routers: [authRoutes(auth)],
  ready: db.ping,
});

serve(app, config.PORT, [relay.stop, async () => redis.quit(), db.close]);
