import { randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response, type Router } from 'express';
import { pinoHttp } from 'pino-http';
import { isPgError, PgCode } from './db.js';
import { AppError, forbidden, unauthorized } from './errors.js';
import { logger } from './logger.js';

/*
 * Every service is reachable only through the gateway (or a sibling service).
 * The gateway authenticates the end user (JWT) and forwards the identity in
 * x-user-* headers, together with x-internal-token. Services trust those
 * headers only when the internal token is valid.
 */

export const Headers = {
  internalToken: 'x-internal-token',
  requestId: 'x-request-id',
  userId: 'x-user-id',
  userEmail: 'x-user-email',
  userRole: 'x-user-role',
} as const;

export type Role = 'user' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function internalAuth(token: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const presented = req.header(Headers.internalToken);
    if (!presented || !safeEqual(presented, token)) {
      throw new AppError(401, 'INTERNAL_AUTH_REQUIRED', 'This service only accepts requests from the gateway');
    }
    const id = req.header(Headers.userId);
    const role = req.header(Headers.userRole);
    if (id && (role === 'user' || role === 'admin')) {
      req.user = { id, email: req.header(Headers.userEmail) ?? '', role };
    }
    next();
  };
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw unauthorized();
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw unauthorized();
  if (req.user.role !== 'admin') throw forbidden();
  next();
}

/** The authenticated user; only call behind requireUser/requireAdmin. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;
  if (err && typeof err === 'object' && 'type' in err) {
    if (err.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
    if (err.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (isPgError(err)) {
    switch (err.code) {
      case PgCode.UNIQUE_VIOLATION:
        return new AppError(409, 'CONFLICT', 'Resource already exists');
      case PgCode.CHECK_VIOLATION:
        return new AppError(409, 'CONSTRAINT_VIOLATION', 'Operation violates a data integrity rule');
      case PgCode.FOREIGN_KEY_VIOLATION:
        return new AppError(400, 'INVALID_REFERENCE', 'Referenced resource does not exist');
      case PgCode.INVALID_TEXT_REPRESENTATION:
        return new AppError(400, 'INVALID_INPUT', 'Invalid input value');
      case PgCode.LOCK_NOT_AVAILABLE:
      case PgCode.QUERY_CANCELED:
      case PgCode.SERIALIZATION_FAILURE:
      case PgCode.DEADLOCK_DETECTED:
        return new AppError(503, 'BUSY', 'The system is under heavy load, please retry shortly');
    }
  }
  return undefined;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = toAppError(err);
  const requestId = String(req.id ?? '');
  if (!appError) {
    logger.error({ err, requestId }, 'Unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId } });
    return;
  }
  if (appError.status >= 500) logger.warn({ err, requestId }, appError.message);
  if (appError.status === 503) res.setHeader('Retry-After', '1');
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined && { details: appError.details }),
      requestId,
    },
  });
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

export const requestLogger = () =>
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = (req.headers[Headers.requestId] as string | undefined) ?? randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    autoLogging: { ignore: (req) => req.url === '/health' },
  });

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export interface ServiceAppOptions {
  name: string;
  internalToken: string;
  routers: Router[];
  /** Readiness probe: return false when a dependency (DB, Redis) is unavailable. */
  ready: () => Promise<boolean>;
}

/** Standard Express app shared by all backend services. */
export function createServiceApp(opts: ServiceAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLogger());

  // Probes are unauthenticated so the platform can call them.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: opts.name });
  });
  app.get('/ready', async (_req, res) => {
    const ok = await opts.ready();
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'unavailable', service: opts.name });
  });

  app.use(internalAuth(opts.internalToken));
  app.use(express.json({ limit: '100kb' }));
  for (const router of opts.routers) app.use(router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
