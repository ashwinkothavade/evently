import { publish, publishMany } from '@evently/shared/bus';
import type { BookingConfirmed, InventorySyncRequest, InventorySyncResponse } from '@evently/shared/contracts';
import { withSavepoint, type Database, type Tx } from '@evently/shared/db';
import { AppError, badRequest, conflict, notFound } from '@evently/shared/errors';
import { logger } from '@evently/shared/logger';
import { iso } from '@evently/shared/time';
import type { InventoryRow } from './model.js';
import { reserveTickets, type Reservation } from './reservation.js';

export const bookingConfirmedPayload = (r: Reservation): BookingConfirmed => ({
  bookingId: r.booking.id,
  userId: r.booking.user_id,
  eventId: r.booking.event_id,
  eventName: r.eventName,
  quantity: r.booking.quantity,
  totalPriceCents: r.booking.total_price_cents,
  source: r.booking.source,
  seats: r.seatLabels,
  createdAt: iso(r.booking.created_at),
});

/**
 * Publishes the event's current availability (read models in catalog and
 * notify services consume it). The version bump makes the stream safely
 * re-orderable: consumers ignore versions older than what they hold.
 */
export async function emitInventoryChanged(tx: Tx, eventId: string): Promise<void> {
  const { rows } = await tx.query<{ capacity: number; booked_count: number; inventory_version: number; waitlist_size: number }>(
    `UPDATE inventory SET inventory_version = inventory_version + 1
      WHERE event_id = $1
      RETURNING capacity, booked_count, inventory_version,
                (SELECT count(*) FROM waitlist_entries w WHERE w.event_id = $1 AND w.status = 'waiting')::int AS waitlist_size`,
    [eventId],
  );
  const row = rows[0];
  if (!row) return;
  await publish(tx, 'inventory.changed', {
    eventId,
    capacity: row.capacity,
    bookedCount: row.booked_count,
    waitlistSize: row.waitlist_size,
    inventoryVersion: Number(row.inventory_version),
  });
}

/**
 * Turns waiting entries into confirmed bookings while capacity allows. Runs in
 * the transaction that freed capacity, so freed tickets go to the queue before
 * anyone else can grab them.
 *
 * FIFO with first-fit: an entry needing more tickets than are free is skipped
 * (keeping its place) so smaller requests behind it can be served.
 */
export async function promoteWaitlist(tx: Tx, eventId: string): Promise<number> {
  const { rows: events } = await tx.query<{ available: number; bookable: boolean }>(
    `SELECT capacity - booked_count AS available, status = 'published' AND starts_at > now() AS bookable
       FROM inventory WHERE event_id = $1 FOR UPDATE`,
    [eventId],
  );
  const event = events[0];
  if (!event?.bookable || event.available <= 0) return 0;

  const { rows: queue } = await tx.query<{ id: string; user_id: string; quantity: number }>(
    `SELECT id, user_id, quantity FROM waitlist_entries
      WHERE event_id = $1 AND status = 'waiting' AND quantity <= $2
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED`,
    [eventId, event.available],
  );

  let available = event.available;
  let promoted = 0;
  for (const entry of queue) {
    if (available <= 0) break;
    if (entry.quantity > available) continue;
    try {
      // A savepoint isolates each promotion: if one fails (e.g. the admin lowered
      // max_per_booking since the user joined) the surrounding change still commits.
      const reservation = await withSavepoint(tx, 'promote_waitlist', () =>
        reserveTickets(tx, { userId: entry.user_id, eventId, quantity: entry.quantity, source: 'waitlist' }),
      );
      await tx.query(
        `UPDATE waitlist_entries SET status = 'promoted', booking_id = $2, updated_at = now() WHERE id = $1`,
        [entry.id, reservation.booking.id],
      );
      await publish(tx, 'booking.confirmed', bookingConfirmedPayload(reservation));
      available -= entry.quantity;
      promoted++;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      logger.info({ entryId: entry.id, code: err.code }, 'Waitlist entry could not be promoted; expiring it');
      await tx.query(`UPDATE waitlist_entries SET status = 'expired', updated_at = now() WHERE id = $1`, [entry.id]);
    }
  }
  return promoted;
}

export function createInventoryService(db: Database, onPublished: () => void) {
  /**
   * Create or update bookable inventory from the catalog (synchronous command).
   * This service is the authority on capacity, so it validates changes that
   * depend on sales. Idempotent: re-sending the same catalogVersion is a no-op.
   */
  async function sync(eventId: string, req: InventorySyncRequest): Promise<InventorySyncResponse> {
    if (req.status === 'cancelled') throw badRequest('INVALID_STATUS', 'Use the cancel endpoint to cancel inventory');

    const result = await db.withTransaction(async (tx) => {
      const { rows } = await tx.query<InventoryRow>('SELECT * FROM inventory WHERE event_id = $1 FOR UPDATE', [eventId]);
      const current = rows[0];

      if (!current) {
        await tx.query(
          `INSERT INTO inventory (event_id, name, venue, starts_at, ends_at, capacity, price_cents,
                                  max_per_booking, is_seated, status, catalog_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [eventId, req.name, req.venue, req.startsAt, req.endsAt, req.capacity, req.priceCents,
           req.maxPerBooking, req.seating !== null, req.status, req.catalogVersion],
        );
        if (req.seating) {
          if (req.seating.rows * req.seating.seatsPerRow !== req.capacity) {
            throw badRequest('INVALID_SEATING', 'Seating rows × seatsPerRow must equal capacity');
          }
          // Rows are labelled A, B, C…; seats numbered from 1.
          await tx.query(
            `INSERT INTO seats (event_id, row_label, seat_number)
             SELECT $1, chr(64 + r), n
               FROM generate_series(1, $2::int) AS r, generate_series(1, $3::int) AS n`,
            [eventId, req.seating.rows, req.seating.seatsPerRow],
          );
        }
        await emitInventoryChanged(tx, eventId);
        return { bookedCount: 0, waitlistPromoted: 0 };
      }

      if (current.catalog_version > req.catalogVersion) {
        return { bookedCount: current.booked_count, waitlistPromoted: 0 }; // stale command
      }
      if (current.status === 'cancelled') throw conflict('EVENT_CANCELLED', 'Event is cancelled');
      if (current.is_seated && req.capacity !== current.capacity) {
        throw conflict('SEATED_CAPACITY_FIXED', 'Capacity of a seated event is defined by its seat map');
      }
      if (req.capacity < current.booked_count) {
        throw conflict('CAPACITY_BELOW_BOOKED', `Capacity cannot be lower than the ${current.booked_count} tickets already sold`, {
          bookedCount: current.booked_count,
        });
      }

      await tx.query(
        `UPDATE inventory
            SET name = $2, venue = $3, starts_at = $4, ends_at = $5, capacity = $6, price_cents = $7,
                max_per_booking = $8, status = $9, catalog_version = $10, updated_at = now()
          WHERE event_id = $1`,
        [eventId, req.name, req.venue, req.startsAt, req.endsAt, req.capacity, req.priceCents,
         req.maxPerBooking, req.status, req.catalogVersion],
      );
      // More capacity (or publishing a draft) may let waitlisted users in.
      const waitlistPromoted = await promoteWaitlist(tx, eventId);
      await emitInventoryChanged(tx, eventId);
      const { rows: after } = await tx.query<{ booked_count: number }>(
        'SELECT booked_count FROM inventory WHERE event_id = $1',
        [eventId],
      );
      return { bookedCount: after[0]!.booked_count, waitlistPromoted };
    });
    onPublished();
    return result;
  }

  /** Cancels all bookings and waitlist entries for an event. Idempotent. */
  async function cancel(eventId: string): Promise<{ bookingsCancelled: number }> {
    const result = await db.withTransaction(async (tx) => {
      const { rows } = await tx.query<InventoryRow>('SELECT * FROM inventory WHERE event_id = $1 FOR UPDATE', [eventId]);
      const event = rows[0];
      if (!event) throw notFound('Event');
      if (event.status === 'cancelled') return { bookingsCancelled: 0 };

      const { rows: cancelled } = await tx.query<{
        id: string; user_id: string; quantity: number; total_price_cents: number; cancelled_at: Date;
      }>(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = now()
          WHERE event_id = $1 AND status = 'confirmed'
          RETURNING id, user_id, quantity, total_price_cents, cancelled_at`,
        [eventId],
      );
      await tx.query('UPDATE booking_seats SET active = false WHERE event_id = $1 AND active', [eventId]);
      await tx.query(
        `UPDATE waitlist_entries SET status = 'expired', updated_at = now() WHERE event_id = $1 AND status = 'waiting'`,
        [eventId],
      );
      await tx.query(
        `UPDATE inventory SET status = 'cancelled', booked_count = 0, updated_at = now() WHERE event_id = $1`,
        [eventId],
      );
      await publishMany(
        tx,
        'booking.cancelled',
        cancelled.map((b) => ({
          bookingId: b.id,
          userId: b.user_id,
          eventId,
          eventName: event.name,
          quantity: b.quantity,
          totalPriceCents: b.total_price_cents,
          reason: 'event_cancelled' as const,
          cancelledAt: iso(b.cancelled_at),
        })),
      );
      await emitInventoryChanged(tx, eventId);
      return { bookingsCancelled: cancelled.length };
    });
    onPublished();
    return result;
  }

  async function seatMap(eventId: string) {
    const { rows: events } = await db.pool.query<InventoryRow>(
      `SELECT * FROM inventory WHERE event_id = $1 AND status <> 'draft'`,
      [eventId],
    );
    const event = events[0];
    if (!event) throw notFound('Event');
    if (!event.is_seated) throw badRequest('NOT_SEATED', 'This event uses general admission');

    const { rows } = await db.pool.query<{ id: string; row_label: string; seat_number: number; available: boolean }>(
      `SELECT s.id, s.row_label, s.seat_number, bs.seat_id IS NULL AS available
         FROM seats s
         LEFT JOIN booking_seats bs ON bs.seat_id = s.id AND bs.active
        WHERE s.event_id = $1
        ORDER BY s.row_label, s.seat_number`,
      [eventId],
    );
    const byRow = new Map<string, { id: string; number: number; available: boolean }[]>();
    for (const seat of rows) {
      const list = byRow.get(seat.row_label) ?? [];
      list.push({ id: seat.id, number: seat.seat_number, available: seat.available });
      byRow.set(seat.row_label, list);
    }
    return {
      eventId,
      availableSeats: rows.filter((s) => s.available).length,
      rows: [...byRow].map(([label, seats]) => ({ label, seats })),
    };
  }

  /** Verifies the denormalised counters against the source rows (admin audit). */
  async function integrityReport() {
    const { rows } = await db.pool.query<{
      event_id: string; name: string; capacity: number; booked_count: number;
      confirmed_tickets: number; active_seats: number | null;
    }>(
      `SELECT i.event_id, i.name, i.capacity, i.booked_count,
              COALESCE((SELECT sum(b.quantity) FROM bookings b
                         WHERE b.event_id = i.event_id AND b.status = 'confirmed'), 0)::int AS confirmed_tickets,
              CASE WHEN i.is_seated THEN
                (SELECT count(*) FROM booking_seats bs WHERE bs.event_id = i.event_id AND bs.active)::int
              END AS active_seats
         FROM inventory i`,
    );
    const mismatches = rows
      .filter((r) => r.booked_count !== r.confirmed_tickets || (r.active_seats !== null && r.active_seats !== r.booked_count) || r.booked_count > r.capacity)
      .map((r) => ({
        eventId: r.event_id,
        name: r.name,
        capacity: r.capacity,
        bookedCount: r.booked_count,
        confirmedTickets: r.confirmed_tickets,
        activeSeats: r.active_seats,
      }));
    return { ok: mismatches.length === 0, eventsChecked: rows.length, mismatches };
  }

  return { sync, cancel, seatMap, integrityReport };
}
