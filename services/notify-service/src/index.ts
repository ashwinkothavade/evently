import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startConsumer } from '@evently/shared/bus';
import { Streams } from '@evently/shared/contracts';
import { createDatabase } from '@evently/shared/db';
import { createServiceApp } from '@evently/shared/http';
import { serve } from '@evently/shared/lifecycle';
import { createRedis } from '@evently/shared/redis';
import { createAnalyticsService } from './analytics.js';
import { config } from './config.js';
import { createNotificationService } from './notifications.js';
import { projectionHandlers } from './projections.js';
import { notifyRoutes } from './routes.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

const db = createDatabase({ url: config.DATABASE_URL, schema: 'notify', ssl: config.DATABASE_SSL, poolMax: config.DB_POOL_MAX });
await db.migrate(migrationsDir);

const notifications = createNotificationService(db);
const analytics = createAnalyticsService(db);

const consumer = startConsumer({
  db,
  redis: createRedis(config.REDIS_URL, 'notify-service:consumer'),
  group: 'notify-service',
  streams: [Streams.auth, Streams.catalog, Streams.booking],
  handlers: projectionHandlers,
});
const stopDispatcher = notifications.startDispatcher(config.NOTIFICATION_DISPATCH_INTERVAL_MS);

const app = createServiceApp({
  name: 'notify-service',
  internalToken: config.INTERNAL_API_TOKEN,
  routers: [notifyRoutes({ notifications, analytics })],
  ready: db.ping,
});

serve(app, config.PORT, [consumer.stop, stopDispatcher, db.close]);
