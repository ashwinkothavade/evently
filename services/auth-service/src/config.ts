import { env, loadEnv } from '@evently/shared/env';
import { initLogger } from '@evently/shared/logger';
import { z } from 'zod';

export const config = loadEnv({
  PORT: env.port(4001),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: env.bool(false),
  DB_POOL_MAX: env.int(5),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
});

initLogger('auth-service', config.LOG_LEVEL);
