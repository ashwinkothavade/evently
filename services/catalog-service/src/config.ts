import { env, loadEnv, serviceUrl } from '@evently/shared/env';
import { initLogger } from '@evently/shared/logger';
import { z } from 'zod';

export const config = loadEnv({
  PORT: env.port(4002),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: env.bool(false),
  DB_POOL_MAX: env.int(10),
  REDIS_URL: z.string().min(1),
  BOOKING_SERVICE_URL: z.url().default(serviceUrl('BOOKING_SERVICE', 'http://localhost:4003')),
  EVENTS_CACHE_TTL_SECONDS: env.int(5),
});

initLogger('catalog-service', config.LOG_LEVEL);
