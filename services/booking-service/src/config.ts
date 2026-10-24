import { env, loadEnv } from '@evently/shared/env';
import { initLogger } from '@evently/shared/logger';
import { z } from 'zod';

export const config = loadEnv({
  PORT: env.port(4003),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: env.bool(false),
  DB_POOL_MAX: env.int(20),
  REDIS_URL: z.string().min(1),
  SOLD_OUT_FLAG_TTL_SECONDS: env.int(2),
});

initLogger('booking-service', config.LOG_LEVEL);
