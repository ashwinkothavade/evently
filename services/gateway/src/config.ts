import { env, loadEnv, serviceUrl } from '@evently/shared/env';
import { initLogger } from '@evently/shared/logger';
import { z } from 'zod';

export const config = loadEnv({
  PORT: env.port(8080),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  AUTH_SERVICE_URL: z.url().default(serviceUrl('AUTH_SERVICE', 'http://localhost:4001')),
  CATALOG_SERVICE_URL: z.url().default(serviceUrl('CATALOG_SERVICE', 'http://localhost:4002')),
  BOOKING_SERVICE_URL: z.url().default(serviceUrl('BOOKING_SERVICE', 'http://localhost:4003')),
  NOTIFY_SERVICE_URL: z.url().default(serviceUrl('NOTIFY_SERVICE', 'http://localhost:4004')),
  /** Comma-separated list of allowed browser origins, or * */
  CORS_ORIGINS: z.string().default('*'),
  RATE_LIMIT_ENABLED: env.bool(true),
  RATE_LIMIT_PER_MINUTE: env.int(600),
  BOOKING_RATE_LIMIT_PER_MINUTE: env.int(30),
});

initLogger('gateway', config.LOG_LEVEL);

export const services = {
  auth: config.AUTH_SERVICE_URL,
  catalog: config.CATALOG_SERVICE_URL,
  booking: config.BOOKING_SERVICE_URL,
  notify: config.NOTIFY_SERVICE_URL,
} as const;

export type ServiceName = keyof typeof services;
