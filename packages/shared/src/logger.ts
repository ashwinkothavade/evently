import { pino, type Logger } from 'pino';

const base = { redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-internal-token"]'] };

/** Live ESM binding: services call initLogger() at startup and every importer sees the configured logger. */
export let logger: Logger = pino({ ...base, level: process.env.LOG_LEVEL ?? 'info' });

export function initLogger(service: string, level: string): Logger {
  logger = pino({ ...base, level, base: { service } });
  return logger;
}
