import { Redis } from 'ioredis';
import { logger } from './logger.js';

export type { Redis };

export function createRedis(url: string, name: string): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: 2, connectionName: name });
  redis.on('error', (err) => logger.warn({ err: err.message, connection: name }, 'Redis error'));
  return redis;
}
