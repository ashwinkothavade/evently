import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startConsumer, startOutboxRelay } from '@evently/shared/bus';
import { Streams } from '@evently/shared/contracts';
import { createDatabase } from '@evently/shared/db';
import { serve } from '@evently/shared/lifecycle';
import { createRedis } from '@evently/shared/redis';
import { createBookingApp } from './app.js';
import { config } from './config.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

const db = createDatabase({ url: config.DATABASE_URL, schema: 'booking', ssl: config.DATABASE_SSL, poolMax: config.DB_POOL_MAX });
await db.migrate(migrationsDir);

const redis = createRedis(config.REDIS_URL, 'booking-service');
const relay = startOutboxRelay({ db, redis, stream: Streams.booking, source: 'booking-service' });

// Keep a local replica of user names/emails for admin attendee lists.
const consumer = startConsumer({
  db,
  redis: createRedis(config.REDIS_URL, 'booking-service:consumer'),
  group: 'booking-service',
  streams: [Streams.auth],
  handlers: {
    'user.registered': async (tx, { data }) => {
      await tx.query(
        `INSERT INTO users (id, email, name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name`,
        [data.userId, data.email, data.name],
      );
    },
  },
});

const app = createBookingApp({
  db,
  redis,
  internalToken: config.INTERNAL_API_TOKEN,
  soldOutTtlSeconds: config.SOLD_OUT_FLAG_TTL_SECONDS,
  onPublished: relay.kick,
});

serve(app, config.PORT, [consumer.stop, relay.stop, async () => redis.quit(), db.close]);
