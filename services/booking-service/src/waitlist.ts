import type { Database } from '@evently/shared/db';
import { isPgError, PgCode } from '@evently/shared/db';
import { badRequest, conflict, notFound } from '@evently/shared/errors';
import { emitInventoryChanged } from './inventory.js';
import type { InventoryRow } from './model.js';

interface WaitlistRow {
  id: string;
  event_id: string;
  user_id: string;
  quantity: number;
  status: 'waiting' | 'promoted' | 'left' | 'expired';
  booking_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function createWaitlistService(db: Database, onPublished: () => void) {
  /** Live queue position (1-based) of a waiting entry. */
  const POSITION_SQL = `
    (SELECT count(*) FROM waitlist_entries q
      WHERE q.event_id = w.event_id AND q.status = 'waiting'
        AND (q.created_at, q.id) <= (w.created_at, w.id))::int`;

  async function join(userId: string, eventId: string, quantity: number) {
    const entry = await db.withTransaction(async (tx) => {
      // Lock the event: serialises against cancellations so a spot freed
      // between our availability check and insert cannot be missed.
      const { rows } = await tx.query<InventoryRow>('SELECT * FROM inventory WHERE event_id = $1 FOR UPDATE', [eventId]);
      const event = rows[0];
      if (!event || event.status === 'draft') throw notFound('Event');
      if (event.status === 'cancelled') throw conflict('EVENT_CANCELLED', 'This event has been cancelled');
      if (event.starts_at.getTime() <= Date.now()) throw conflict('EVENT_STARTED', 'The event has already started');
      if (quantity > event.max_per_booking) {
        throw badRequest('QUANTITY_LIMIT_EXCEEDED', `At most ${event.max_per_booking} tickets per booking`);
      }
      const available = event.capacity - event.booked_count;
      if (available >= quantity) {
        throw conflict('TICKETS_AVAILABLE', `${available} ticket(s) are available – book them directly`, { available });
      }
      try {
        const { rows: inserted } = await tx.query<WaitlistRow & { position: number }>(
          `WITH w AS (INSERT INTO waitlist_entries (event_id, user_id, quantity) VALUES ($1, $2, $3) RETURNING *)
           SELECT w.*, (SELECT count(*) FROM waitlist_entries q
                         WHERE q.event_id = w.event_id AND q.status = 'waiting') + 1 AS position
             FROM w`,
          [eventId, userId, quantity],
        );
        await emitInventoryChanged(tx, eventId);
        return inserted[0]!;
      } catch (err) {
        if (isPgError(err) && err.code === PgCode.UNIQUE_VIOLATION) {
          throw conflict('ALREADY_ON_WAITLIST', 'You are already on the waitlist for this event');
        }
        throw err;
      }
    });
    onPublished();
    return toDto(entry, entry.position);
  }

  async function leave(userId: string, eventId: string) {
    const found = await db.withTransaction(async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE waitlist_entries SET status = 'left', updated_at = now()
          WHERE event_id = $1 AND user_id = $2 AND status = 'waiting'`,
        [eventId, userId],
      );
      if (!rowCount) return false;
      await emitInventoryChanged(tx, eventId);
      return true;
    });
    if (!found) throw notFound('Waitlist entry');
    onPublished();
  }

  async function listForUser(userId: string) {
    const { rows } = await db.pool.query<WaitlistRow & { position: number | null; event_name: string; starts_at: Date }>(
      `SELECT w.*, i.name AS event_name, i.starts_at,
              CASE WHEN w.status = 'waiting' THEN ${POSITION_SQL} END AS position
         FROM waitlist_entries w JOIN inventory i ON i.event_id = w.event_id
        WHERE w.user_id = $1
        ORDER BY w.created_at DESC
        LIMIT 100`,
      [userId],
    );
    return rows.map((r) => ({ ...toDto(r, r.position), event: { id: r.event_id, name: r.event_name, startsAt: r.starts_at } }));
  }

  return { join, leave, listForUser };
}

function toDto(row: WaitlistRow, position: number | null) {
  return {
    id: row.id,
    eventId: row.event_id,
    quantity: row.quantity,
    status: row.status,
    position,
    bookingId: row.booking_id,
    createdAt: row.created_at,
  };
}
