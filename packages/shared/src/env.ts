import { z } from 'zod';

// Load .env from the service directory, then from the repo root (local dev).
// Real environment variables always win: loadEnvFile never overrides them.
for (const file of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file not present
  }
}

const BaseEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Shared secret proving a request came from the gateway or a sibling service. */
  INTERNAL_API_TOKEN: z.string().min(16, 'INTERNAL_API_TOKEN must be at least 16 characters'),
});

/** Validates process.env against the base schema plus service-specific fields; exits on error. */
export function loadEnv<T extends z.ZodRawShape>(shape: T) {
  const schema = BaseEnv.extend(shape);
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
}

/** Common schema fragments. */
export const env = {
  port: (fallback: number) => z.coerce.number().int().positive().default(fallback),
  bool: (fallback: boolean) => z.stringbool().default(fallback),
  int: (fallback: number) => z.coerce.number().int().min(0).default(fallback),
  url: () => z.url(),
};

/**
 * Resolves a sibling service's base URL from `<PREFIX>_URL`, or from
 * `<PREFIX>_HOSTPORT` (the private-network "host:port" form that platforms
 * like Render inject), falling back to the local-development default.
 */
export function serviceUrl(prefix: string, fallback: string): string {
  const url = process.env[`${prefix}_URL`];
  if (url) return url;
  const hostport = process.env[`${prefix}_HOSTPORT`];
  return hostport ? `http://${hostport}` : fallback;
}
