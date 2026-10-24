import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, unauthorized, forbidden } from '@evently/shared/errors';
import { errorHandler, Headers, requestLogger, type AuthUser } from '@evently/shared/http';
import { logger } from '@evently/shared/logger';
import type { Redis } from '@evently/shared/redis';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { createProxyMiddleware } from 'http-proxy-middleware';
import jwt from 'jsonwebtoken';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';
import { config, services, type ServiceName } from './config.js';
import { matchRoute, type RouteRule } from './routes.js';

interface RoutedRequest extends Request {
  route_?: RouteRule;
}

const openApiPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../openapi.yaml');
const openApi = parseYaml(readFileSync(openApiPath, 'utf8')) as Record<string, unknown>;

function verifyToken(req: Request): AuthUser | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  try {
    const claims = jwt.verify(header.slice(7), config.JWT_SECRET) as { sub: string; email: string; role: 'user' | 'admin' };
    return { id: claims.sub, email: claims.email, role: claims.role };
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

export function createGatewayApp(redis: Redis) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the platform's load balancer

  app.use(requestLogger());
  app.use(helmet({ contentSecurityPolicy: false })); // CSP off so Swagger UI renders
  const origins = config.CORS_ORIGINS === '*' ? '*' : config.CORS_ORIGINS.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: origins,
      exposedHeaders: ['X-Request-Id', 'ETag', 'Location', 'Idempotent-Replayed', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    }),
  );

  // ---- gateway-local endpoints --------------------------------------------
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'gateway' });
  });

  /** Aggregated readiness of every downstream service. */
  app.get('/health/services', async (_req, res) => {
    const entries = await Promise.all(
      (Object.entries(services) as [ServiceName, string][]).map(async ([name, url]) => {
        const started = Date.now();
        try {
          const r = await fetch(new URL('/ready', url), { signal: AbortSignal.timeout(3_000) });
          return [name, { status: r.ok ? 'up' : 'degraded', latencyMs: Date.now() - started }] as const;
        } catch {
          return [name, { status: 'down', latencyMs: Date.now() - started }] as const;
        }
      }),
    );
    const allUp = entries.every(([, s]) => s.status === 'up');
    res.status(allUp ? 200 : 503).json({ status: allUp ? 'ok' : 'degraded', services: Object.fromEntries(entries) });
  });

  app.get('/openapi.json', (_req, res) => {
    res.json(openApi);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApi, { customSiteTitle: 'Evently API' }));
  app.get('/', (_req, res) => {
    res.redirect('/docs');
  });

  // ---- rate limiting (shared across gateway replicas via Redis) -------------
  const store = (prefix: string) =>
    new RedisStore({
      prefix: `rl:${prefix}:`,
      sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
    });
  const tooMany = (_req: Request, _res: Response, next: NextFunction) =>
    next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please slow down'));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.RATE_LIMIT_PER_MINUTE,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => !config.RATE_LIMIT_ENABLED,
      store: store('ip'),
      handler: tooMany,
    }),
  );
  const bookingLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.BOOKING_RATE_LIMIT_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => !config.RATE_LIMIT_ENABLED || req.method !== 'POST',
    keyGenerator: (req) => `user:${req.user?.id}`,
    store: store('booking'),
    handler: tooMany,
  });

  // ---- route resolution + authentication ----------------------------------
  app.use('/api', (req: RoutedRequest, _res, next) => {
    // Never trust identity headers from the outside world.
    for (const h of [Headers.internalToken, Headers.userId, Headers.userEmail, Headers.userRole]) delete req.headers[h];

    const route = matchRoute(req.method, req.originalUrl.split('?')[0]!);
    if (!route) throw new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.originalUrl.split('?')[0]}`);

    const user = verifyToken(req);
    if (route.access !== 'public' && !user) throw unauthorized();
    if (route.access === 'admin' && user?.role !== 'admin') throw forbidden();
    req.user = user;
    req.route_ = route;
    next();
  });

  app.use(/^\/api\/v1\/bookings$/, bookingLimiter);

  // ---- proxy ----------------------------------------------------------------
  app.use(
    '/api',
    createProxyMiddleware<RoutedRequest, Response>({
      target: services.catalog, // overridden per request by router()
      router: (req) => services[req.route_!.service],
      pathRewrite: (_path, req) => req.originalUrl,
      changeOrigin: true,
      proxyTimeout: 15_000,
      on: {
        proxyReq: (proxyReq, req) => {
          proxyReq.setHeader(Headers.internalToken, config.INTERNAL_API_TOKEN);
          proxyReq.setHeader(Headers.requestId, String(req.id));
          if (req.user) {
            proxyReq.setHeader(Headers.userId, req.user.id);
            proxyReq.setHeader(Headers.userEmail, req.user.email);
            proxyReq.setHeader(Headers.userRole, req.user.role);
          }
        },
        error: (err, req, res) => {
          logger.error({ err, service: (req as RoutedRequest).route_?.service }, 'Upstream request failed');
          if ('headersSent' in res && !res.headersSent) {
            res.status(502).json({
              error: { code: 'UPSTREAM_UNAVAILABLE', message: 'A backend service is unavailable, please retry', requestId: String(req.id) },
            });
          }
        },
      },
    }),
  );

  app.use((req, _res, next) => next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`)));
  app.use(errorHandler);
  return app;
}
