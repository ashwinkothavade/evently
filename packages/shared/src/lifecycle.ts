import type { Express } from 'express';
import { logger } from './logger.js';

/** Starts the HTTP server and wires graceful shutdown (SIGTERM/SIGINT). */
export function serve(app: Express, port: number, onShutdown: (() => Promise<unknown>)[] = []): void {
  const server = app.listen(port, () => logger.info({ port }, 'Service listening'));
  server.keepAliveTimeout = 65_000; // longer than typical load-balancer idle timeouts

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close();
    for (const fn of onShutdown) await fn().catch((err) => logger.error({ err }, 'Shutdown hook failed'));
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
