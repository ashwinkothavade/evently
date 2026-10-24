import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { logger } from './logger.js';

// COUNT()/SUM() return int8/numeric; they fit comfortably in a JS number here.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number.parseFloat(value));

export type Queryable = pg.Pool | pg.PoolClient;
export type Tx = pg.PoolClient;

export const PgCode = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
  INVALID_TEXT_REPRESENTATION: '22P02',
} as const;

export function isPgError(err: unknown): err is pg.DatabaseError {
  return err instanceof pg.DatabaseError;
}

const RETRYABLE_CODES = new Set<string>([PgCode.SERIALIZATION_FAILURE, PgCode.DEADLOCK_DETECTED]);

export interface DatabaseOptions {
  url: string;
  /** Each service owns exactly one Postgres schema (database-per-service, logically). */
  schema: string;
  ssl: boolean;
  poolMax: number;
}

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(opts: DatabaseOptions) {
  if (!/^[a-z_]+$/.test(opts.schema)) throw new Error(`Invalid schema name: ${opts.schema}`);

  const pool = new pg.Pool({
    connectionString: opts.url,
    max: opts.poolMax,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    // The service only sees its own schema (plus public for extensions).
    // lock_timeout: under a stampede it is better to fail fast (503) than to
    // let lock waiters exhaust the pool.
    options: `-c search_path=${opts.schema},public -c lock_timeout=5000`,
  });
  pool.on('error', (err) => logger.error({ err }, 'Unexpected error on idle Postgres client'));

  /**
   * Runs `fn` in a transaction. Deadlocks and serialisation failures are
   * transient by definition, so they are retried with jittered backoff.
   */
  async function withTransaction<T>(fn: (tx: Tx) => Promise<T>, maxRetries = 3): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (attempt < maxRetries && isPgError(err) && err.code && RETRYABLE_CODES.has(err.code)) {
          logger.warn({ code: err.code, attempt }, 'Retrying transaction');
          await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt + Math.random() * 20));
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
  }

  /**
   * Applies pending migrations from `dir` in filename order. The advisory lock
   * makes it safe for several replicas of a service to boot simultaneously.
   */
  async function migrate(dir: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [`migrate:${opts.schema}`]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${opts.schema}`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name       text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
      const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
      const applied = new Set(rows.map((r) => r.name));
      const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = await readFile(path.join(dir, file), 'utf8');
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          logger.info({ migration: file, schema: opts.schema }, 'Applied migration');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`migrate:${opts.schema}`]).catch(() => undefined);
      client.release();
    }
  }

  async function ping(): Promise<boolean> {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  return { pool, withTransaction, migrate, ping, close: () => pool.end() };
}

/**
 * Runs `fn` inside a SAVEPOINT so a failure can be rolled back without
 * aborting the surrounding transaction.
 */
export async function withSavepoint<T>(tx: Tx, name: string, fn: () => Promise<T>): Promise<T> {
  await tx.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await tx.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (err) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw err;
  }
}
