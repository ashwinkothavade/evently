import { hostname } from 'node:os';
import type { Redis } from 'ioredis';
import type { EventPayloads, EventType, IntegrationEvent } from './contracts.js';
import type { Database, Queryable, Tx } from './db.js';
import { logger } from './logger.js';

/*
 * Reliable messaging between services.
 *
 * Producer side – transactional outbox:
 *   publish() inserts the event into the service's `outbox` table in the SAME
 *   transaction as the business change. A relay then copies committed rows to
 *   a Redis stream. Result: an event is published if and only if the change
 *   committed, and a crash between "commit" and "publish" loses nothing.
 *
 * Consumer side – idempotent consumer:
 *   Each service reads with its own consumer group. The handler runs in a DB
 *   transaction together with an insert into `processed_events`; duplicates
 *   (at-least-once redelivery) are detected and skipped. Unacked messages from
 *   crashed consumers are reclaimed with XAUTOCLAIM.
 *
 * Every service using this declares two tables in its own schema:
 *   outbox (seq bigserial, id uuid, type text, payload jsonb, created_at, published_at)
 *   processed_events (event_id uuid primary key, processed_at)
 */

// ---------------------------------------------------------------------------
// Producer
// ---------------------------------------------------------------------------

export async function publish<T extends EventType>(db: Queryable, type: T, data: EventPayloads[T]): Promise<void> {
  await db.query('INSERT INTO outbox (type, payload) VALUES ($1, $2)', [type, JSON.stringify(data)]);
}

export async function publishMany<T extends EventType>(db: Queryable, type: T, items: EventPayloads[T][]): Promise<void> {
  if (items.length === 0) return;
  await db.query(
    'INSERT INTO outbox (type, payload) SELECT $1, p FROM unnest($2::jsonb[]) AS p',
    [type, items.map((item) => JSON.stringify(item))],
  );
}

export interface OutboxRelay {
  /** Ask the relay to run now (e.g. right after a commit) instead of waiting for the next tick. */
  kick(): void;
  stop(): Promise<void>;
}

const STREAM_MAXLEN = 100_000;

export function startOutboxRelay(opts: {
  db: Database;
  redis: Redis;
  stream: string;
  source: string;
  intervalMs?: number;
}): OutboxRelay {
  const { db, redis, stream, source } = opts;
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;

  async function flush(): Promise<void> {
    // Loop until the outbox is drained.
    for (;;) {
      const published = await db.withTransaction(async (tx) => {
        // Only one relay (across all replicas) publishes at a time, which keeps
        // stream order identical to outbox order.
        const { rows: lock } = await tx.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
          [`outbox:${source}`],
        );
        if (!lock[0]?.locked) return 0;
        const { rows } = await tx.query<{ seq: string; id: string; type: string; payload: unknown; created_at: Date }>(
          'SELECT * FROM outbox WHERE published_at IS NULL ORDER BY seq LIMIT 200',
        );
        if (rows.length === 0) return 0;
        const pipeline = redis.pipeline();
        for (const row of rows) {
          const event: IntegrationEvent = {
            id: row.id,
            type: row.type,
            source,
            occurredAt: row.created_at.toISOString(),
            data: row.payload,
          };
          pipeline.xadd(stream, 'MAXLEN', '~', STREAM_MAXLEN, '*', 'event', JSON.stringify(event));
        }
        const results = await pipeline.exec();
        const failed = results?.find(([err]) => err);
        if (failed) throw failed[0];
        await tx.query('UPDATE outbox SET published_at = now() WHERE seq = ANY($1::bigint[])', [rows.map((r) => r.seq)]);
        return rows.length;
      });
      if (published < 200) return;
    }
  }

  function run(): void {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = flush()
      .catch((err) => logger.error({ err }, 'Outbox relay failed; will retry'))
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          run();
        }
      });
  }

  const timer = setInterval(run, opts.intervalMs ?? 1000);
  timer.unref();
  run();

  return {
    kick: run,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

// ---------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------

export type Handler<T extends EventType = EventType> = (tx: Tx, event: IntegrationEvent<T, EventPayloads[T]>) => Promise<void>;
export type HandlerMap = { [K in EventType]?: Handler<K> };

type StreamEntries = [id: string, fields: string[]][];
type ReadResult = [stream: string, entries: StreamEntries][] | null;

export interface Consumer {
  stop(): Promise<void>;
}

const MAX_DELIVERY_ATTEMPTS = 5;

export function startConsumer(opts: {
  db: Database;
  /** A dedicated connection: XREADGROUP BLOCK occupies it. */
  redis: Redis;
  group: string;
  streams: string[];
  handlers: HandlerMap;
}): Consumer {
  const { db, redis, group, streams, handlers } = opts;
  const consumerName = `${group}:${hostname()}:${process.pid}`;
  const failures = new Map<string, number>();
  let stopped = false;

  async function ensureGroups() {
    for (const stream of streams) {
      try {
        // '0' = a brand-new service replays history and builds its read models.
        await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
      } catch (err) {
        if (!String((err as Error).message).includes('BUSYGROUP')) throw err;
      }
    }
  }

  async function handle(stream: string, messageId: string, fields: string[]) {
    const raw = fields[fields.indexOf('event') + 1];
    let event: IntegrationEvent | undefined;
    try {
      event = raw ? (JSON.parse(raw) as IntegrationEvent) : undefined;
    } catch {
      event = undefined;
    }
    const handler = event ? (handlers[event.type as EventType] as Handler | undefined) : undefined;

    if (event && handler) {
      try {
        await db.withTransaction(async (tx) => {
          const { rowCount } = await tx.query(
            'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
            [event.id],
          );
          if (rowCount === 0) return; // duplicate delivery
          await handler(tx, event as never);
        });
      } catch (err) {
        const attempts = (failures.get(messageId) ?? 0) + 1;
        failures.set(messageId, attempts);
        logger.error({ err, type: event.type, messageId, attempts }, 'Event handler failed');
        if (attempts < MAX_DELIVERY_ATTEMPTS) return; // leave pending; retried via XAUTOCLAIM
        logger.error({ messageId, type: event.type }, 'Moving poison message to dead-letter stream');
        await redis.xadd(`${stream}:dlq:${group}`, '*', 'event', raw ?? '', 'error', String((err as Error).message));
      }
    }
    failures.delete(messageId);
    await redis.xack(stream, group, messageId);
  }

  async function processBatch(result: ReadResult) {
    for (const [stream, entries] of result ?? []) {
      for (const [id, fields] of entries) {
        if (fields) await handle(stream, id, fields);
      }
    }
  }

  async function reclaimStale() {
    for (const stream of streams) {
      const [, entries] = (await redis.xautoclaim(stream, group, consumerName, 15_000, '0', 'COUNT', 50)) as [
        string,
        StreamEntries,
      ];
      await processBatch([[stream, entries]]);
    }
  }

  const loop = (async () => {
    await ensureGroups();
    let lastReclaim = 0;
    while (!stopped) {
      try {
        if (Date.now() - lastReclaim > 15_000) {
          lastReclaim = Date.now();
          await reclaimStale();
        }
        const result = (await redis.xreadgroup(
          'GROUP', group, consumerName,
          'COUNT', 100,
          'BLOCK', 2_000,
          'STREAMS', ...streams, ...streams.map(() => '>'),
        )) as ReadResult;
        await processBatch(result);
      } catch (err) {
        if (stopped) break;
        logger.error({ err }, 'Consumer loop error; backing off');
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  })();

  logger.info({ group, streams, consumer: consumerName }, 'Event consumer started');
  return {
    async stop() {
      stopped = true;
      redis.disconnect();
      await loop.catch(() => undefined);
    },
  };
}
