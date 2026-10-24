import { AppError, serviceUnavailable } from './errors.js';
import { Headers } from './http.js';
import { logger } from './logger.js';

/**
 * Minimal service-to-service HTTP client. Downstream business errors are
 * re-raised as AppErrors so the caller's response carries the same code.
 */
export function createInternalClient(baseUrl: string, internalToken: string, opts: { timeoutMs?: number } = {}) {
  return async function call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(new URL(path, baseUrl), {
        method,
        headers: {
          'content-type': 'application/json',
          [Headers.internalToken]: internalToken,
          ...(requestId && { [Headers.requestId]: requestId }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
      });
    } catch (err) {
      logger.error({ err, baseUrl, path }, 'Internal call failed');
      throw serviceUnavailable('A dependent service is unavailable, please retry');
    }
    const payload = (await res.json().catch(() => ({}))) as {
      data?: T;
      error?: { code: string; message: string; details?: unknown };
    };
    if (!res.ok) {
      const e = payload.error;
      if (res.status >= 500 || !e) throw serviceUnavailable('A dependent service failed, please retry');
      throw new AppError(res.status, e.code, e.message, e.details);
    }
    return payload.data as T;
  };
}
