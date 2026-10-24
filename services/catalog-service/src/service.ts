import { publish, type HandlerMap } from '@evently/shared/bus';
import type { Cache } from '@evently/shared/cache';
import type { InventoryCancelResponse, InventorySyncRequest, InventorySyncResponse } from '@evently/shared/contracts';
import { isPgError, type Database, type Tx } from '@evently/shared/db';
import { badRequest, conflict, notFound, preconditionFailed } from '@evently/shared/errors';
import type { createInternalClient } from '@evently/shared/internal-client';
import { decodeCursor, escapeLike, paginate } from '@evently/shared/pagination';
import { iso, isoOrNull } from '@evently/shared/time';
import { toEventDto, toSnapshot, type EventRow } from './model.js';

export interface ListEventsQuery {
  q?: string;
  venue?: string;
  from?: Date;
  to?: Date;
  available?: boolean;
  limit: number;
  cursor?: string;
}

export interface CreateEventInput {
  name: string;
  description?: string;
  venue: string;
  startsAt: Date;
  endsAt?: Date;
  capacity?: number;
  priceCents: number;
  maxPerBooking: number;
  status: 'draft' | 'published';
  seating?: { rows: number; seatsPerRow: number };
}

export interface UpdateEventInput {
  name?: string;
  description?: string | null;
  venue?: string;
  startsAt?: Date;
  endsAt?: Date | null;
  capacity?: number;
  priceCents?: number;
  maxPerBooking?: number;
  status?: 'draft' | 'published';
}

const UPDATABLE_COLUMNS: Record<keyof UpdateEventInput, string> = {
  name: 'name',
  description: 'description',
  venue: 'venue',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  capacity: 'capacity',
  priceCents: 'price_cents',
  maxPerBooking: 'max_per_booking',
  status: 'status',
};

/** Cache namespace: admin writes bump it, invalidating every cached read at once. */
const NAMESPACE_KEY = 'ns';

export function createCatalogService(deps: {
  db: Database;
  cache: Cache;
  cacheTtlSeconds: number;
  booking: ReturnType<typeof createInternalClient>;
  onPublished: () => void;
}) {
  const { db, cache, booking } = deps;

  async function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
    const ns = (await cache.get<number>(NAMESPACE_KEY)) ?? 0;
    return cache.getOrLoad(`v${ns}:${key}`, deps.cacheTtlSeconds, load);
  }
  const invalidate = () => cache.incr(NAMESPACE_KEY);

  const toSyncRequest = (row: EventRow): InventorySyncRequest => ({
    name: row.name,
    venue: row.venue,
    startsAt: iso(row.starts_at),
    endsAt: isoOrNull(row.ends_at),
    capacity: row.capacity,
    priceCents: row.price_cents,
    maxPerBooking: row.max_per_booking,
    status: row.status,
    seating: row.seat_rows !== null ? { rows: row.seat_rows, seatsPerRow: row.seats_per_row! } : null,
    catalogVersion: row.version,
  });

  /**
   * booking-service owns capacity and is the authority on whether a change is
   * allowed (e.g. capacity below tickets sold). We call it synchronously while
   * holding our own transaction open, so a rejection rolls the catalog change back.
   */
  async function syncInventory(tx: Tx, row: EventRow, requestId?: string) {
    const result = await booking<InventorySyncResponse>('PUT', `/internal/inventory/${row.id}`, toSyncRequest(row), requestId);
    await tx.query('UPDATE events SET booked_count = $2 WHERE id = $1', [row.id, result.bookedCount]);
    return result;
  }

  // -------------------------------------------------------------------------
  // Public reads
  // -------------------------------------------------------------------------

  async function listUpcoming(query: ListEventsQuery) {
    return cachedRead(`list:${JSON.stringify(query)}`, async () => {
      const cursor = decodeCursor(query.cursor);
      const { rows } = await db.pool.query<EventRow & { sort_ts: string }>(
        `SELECT *, starts_at::text AS sort_ts FROM events
          WHERE status = 'published'
            AND starts_at >= COALESCE($1::timestamptz, now())
            AND ($2::timestamptz IS NULL OR starts_at < $2)
            AND ($3::text IS NULL OR name ILIKE '%' || $3 || '%' OR venue ILIKE '%' || $3 || '%')
            AND ($4::text IS NULL OR venue ILIKE '%' || $4 || '%')
            AND ($5::boolean IS NOT TRUE OR booked_count < capacity)
            AND ($6::timestamptz IS NULL OR (starts_at, id) > ($6::timestamptz, $7::uuid))
          ORDER BY starts_at, id
          LIMIT $8`,
        [
          query.from ?? null,
          query.to ?? null,
          query.q ? escapeLike(query.q) : null,
          query.venue ? escapeLike(query.venue) : null,
          query.available ?? null,
          cursor?.[0] ?? null,
          cursor?.[1] ?? null,
          query.limit + 1,
        ],
      );
      const { page, nextCursor } = paginate(rows, query.limit);
      return { items: page.map(toEventDto), nextCursor };
    });
  }

  /** Drafts are invisible to the public; cancelled events stay visible to ticket holders. */
  async function getPublic(id: string) {
    const event = await cachedRead(`detail:${id}`, async () => {
      const { rows } = await db.pool.query<EventRow>(`SELECT * FROM events WHERE id = $1 AND status <> 'draft'`, [id]);
      return rows[0] ? toEventDto(rows[0]) : null;
    });
    if (!event) throw notFound('Event');
    return event;
  }

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  async function create(input: CreateEventInput, adminId: string, requestId?: string) {
    const capacity = input.seating ? input.seating.rows * input.seating.seatsPerRow : input.capacity!;
    const row = await db.withTransaction(async (tx) => {
      const { rows } = await tx.query<EventRow>(
        `INSERT INTO events (name, description, venue, starts_at, ends_at, capacity, price_cents,
                             max_per_booking, seat_rows, seats_per_row, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          input.name,
          input.description ?? null,
          input.venue,
          input.startsAt,
          input.endsAt ?? null,
          capacity,
          input.priceCents,
          input.maxPerBooking,
          input.seating?.rows ?? null,
          input.seating?.seatsPerRow ?? null,
          input.status,
          adminId,
        ],
      );
      const row = rows[0]!;
      await syncInventory(tx, row, requestId);
      await publish(tx, 'event.created', toSnapshot(row));
      return row;
    });
    deps.onPublished();
    await invalidate();
    return toEventDto(row);
  }

  async function listAll(opts: { status?: string; limit: number; offset: number }) {
    const { rows } = await db.pool.query<EventRow & { total: number }>(
      `SELECT *, count(*) OVER () AS total FROM events
        WHERE ($1::event_status IS NULL OR status = $1)
        ORDER BY starts_at DESC, id
        LIMIT $2 OFFSET $3`,
      [opts.status ?? null, opts.limit, opts.offset],
    );
    return { items: rows.map(toEventDto), total: rows[0]?.total ?? 0 };
  }

  async function getForAdmin(id: string) {
    const { rows } = await db.pool.query<EventRow>('SELECT * FROM events WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Event');
    return toEventDto(rows[0]);
  }

  /**
   * Optimistic locking: the UPDATE only applies if the row still carries the
   * version the admin last saw; otherwise 412, so concurrent edits never
   * silently overwrite each other.
   */
  async function update(id: string, patch: UpdateEventInput, expectedVersion: number, requestId?: string) {
    const result = await db.withTransaction(async (tx) => {
      const { rows: current } = await tx.query<EventRow>('SELECT * FROM events WHERE id = $1', [id]);
      const before = current[0];
      if (!before) throw notFound('Event');
      if (before.status === 'cancelled') throw conflict('EVENT_CANCELLED', 'Cancelled events cannot be edited');
      if (before.seat_rows !== null && patch.capacity !== undefined && patch.capacity !== before.capacity) {
        throw conflict('SEATED_CAPACITY_FIXED', 'Capacity of a seated event is defined by its seat map');
      }

      const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [keyof UpdateEventInput, unknown][];
      const assignments = entries.map(([key], i) => `${UPDATABLE_COLUMNS[key]} = $${i + 3}`);
      let updated: EventRow | undefined;
      try {
        const { rows } = await tx.query<EventRow>(
          `UPDATE events SET ${[...assignments, 'version = version + 1', 'updated_at = now()'].join(', ')}
            WHERE id = $1 AND version = $2
            RETURNING *`,
          [id, expectedVersion, ...entries.map(([, v]) => v)],
        );
        updated = rows[0];
      } catch (err) {
        if (isPgError(err) && err.constraint === 'events_valid_time_range') {
          throw badRequest('INVALID_TIME_RANGE', 'endsAt must be after startsAt');
        }
        throw err;
      }
      if (!updated) {
        throw preconditionFailed('VERSION_MISMATCH', 'Event was modified by someone else; reload and retry', {
          currentVersion: before.version,
        });
      }

      const sync = await syncInventory(tx, updated, requestId);
      const changed = entries.map(([key]) => key);
      await publish(tx, 'event.updated', { ...toSnapshot(updated), changed });
      return { row: { ...updated, booked_count: sync.bookedCount }, promoted: sync.waitlistPromoted };
    });
    deps.onPublished();
    await invalidate();
    return { ...toEventDto(result.row), waitlistPromoted: result.promoted };
  }

  async function cancel(id: string, reason: string | undefined, requestId?: string) {
    const row = await db.withTransaction(async (tx) => {
      const { rows } = await tx.query<EventRow>('SELECT * FROM events WHERE id = $1 FOR UPDATE', [id]);
      const event = rows[0];
      if (!event) throw notFound('Event');
      if (event.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'Event is already cancelled');

      const { rows: updated } = await tx.query<EventRow>(
        `UPDATE events SET status = 'cancelled', cancel_reason = $2, booked_count = 0,
                           version = version + 1, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, reason ?? null],
      );
      const result = await booking<InventoryCancelResponse>('POST', `/internal/inventory/${id}/cancel`, { reason: reason ?? null }, requestId);
      await publish(tx, 'event.cancelled', { ...toSnapshot(updated[0]!), reason: reason ?? null });
      return { ...updated[0]!, bookingsCancelled: result.bookingsCancelled };
    });
    deps.onPublished();
    await invalidate();
    return { ...toEventDto(row), bookingsCancelled: row.bookingsCancelled };
  }

  // -------------------------------------------------------------------------
  // Integration events
  // -------------------------------------------------------------------------

  /** Keeps the availability replica fresh; stale/out-of-order messages are ignored. */
  const handlers: HandlerMap = {
    'inventory.changed': async (tx, { data }) => {
      await tx.query(
        `UPDATE events SET booked_count = $2, inventory_version = $3
          WHERE id = $1 AND inventory_version < $3`,
        [data.eventId, data.bookedCount, data.inventoryVersion],
      );
    },
  };

  return { listUpcoming, getPublic, create, listAll, getForAdmin, update, cancel, handlers };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
