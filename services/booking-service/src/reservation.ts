import { isPgError, PgCode, type Tx } from '@evently/shared/db';
import { badRequest, conflict, notFound } from '@evently/shared/errors';
import type { BookingRow, InventoryRow } from './model.js';

export interface ReserveInput {
  userId: string;
  eventId: string;
  quantity: number;
  seatIds?: string[];
  source: 'direct' | 'waitlist';
  idempotencyKey?: string;
}

export interface Reservation {
  booking: BookingRow;
  eventName: string;
  seatLabels: string[];
}

/**
 * Reserves tickets inside the caller's transaction. This is the ONLY code path
 * that increases inventory.booked_count.
 *
 * Step 1 is a single conditional UPDATE: Postgres row-locks the inventory row,
 * re-evaluates the guard against the latest committed counter and increments it
 * atomically. Concurrent bookings for the same event therefore queue on the row
 * lock and can never oversell; the CHECK constraint is a second line of defence.
 */
export async function reserveTickets(tx: Tx, input: ReserveInput): Promise<Reservation> {
  const quantity = input.seatIds?.length ?? input.quantity;

  const { rows } = await tx.query<Pick<InventoryRow, 'is_seated' | 'price_cents' | 'name'>>(
    `UPDATE inventory
        SET booked_count = booked_count + $2, updated_at = now()
      WHERE event_id = $1
        AND status = 'published'
        AND starts_at > now()
        AND booked_count + $2 <= capacity
        AND $2 <= max_per_booking
      RETURNING is_seated, price_cents, name`,
    [input.eventId, quantity],
  );
  const event = rows[0];
  if (!event) return explainRejection(tx, input.eventId, quantity);

  if (input.seatIds && !event.is_seated) {
    throw badRequest('SEAT_SELECTION_NOT_SUPPORTED', 'This event uses general admission; send quantity instead of seatIds');
  }

  const { rows: bookings } = await tx.query<BookingRow>(
    `INSERT INTO bookings (user_id, event_id, quantity, total_price_cents, source, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.userId, input.eventId, quantity, quantity * event.price_cents, input.source, input.idempotencyKey ?? null],
  );
  const booking = bookings[0]!;

  let seatLabels: string[] = [];
  if (event.is_seated) {
    if (input.seatIds) await assignChosenSeats(tx, booking.id, input.eventId, input.seatIds);
    else await assignBestSeats(tx, booking.id, input.eventId, quantity);
    const { rows: labels } = await tx.query<{ label: string }>(
      `SELECT s.row_label || s.seat_number AS label
         FROM booking_seats bs JOIN seats s ON s.id = bs.seat_id
        WHERE bs.booking_id = $1 ORDER BY s.row_label, s.seat_number`,
      [booking.id],
    );
    seatLabels = labels.map((l) => l.label);
  }
  return { booking, eventName: event.name, seatLabels };
}

/**
 * The inventory row is already locked by this transaction, so these checks are
 * race-free. The partial unique index on booking_seats is the safety net.
 */
async function assignChosenSeats(tx: Tx, bookingId: string, eventId: string, seatIds: string[]) {
  const { rows: seats } = await tx.query<{ id: string; taken: boolean }>(
    `SELECT s.id, EXISTS (SELECT 1 FROM booking_seats bs WHERE bs.seat_id = s.id AND bs.active) AS taken
       FROM seats s WHERE s.event_id = $1 AND s.id = ANY($2::uuid[])`,
    [eventId, seatIds],
  );
  if (seats.length !== seatIds.length) {
    const known = new Set(seats.map((s) => s.id));
    throw badRequest('INVALID_SEAT', 'One or more seats do not belong to this event', {
      seatIds: seatIds.filter((id) => !known.has(id)),
    });
  }
  const taken = seats.filter((s) => s.taken).map((s) => s.id);
  if (taken.length > 0) {
    throw conflict('SEAT_UNAVAILABLE', 'One or more selected seats are already booked', { seatIds: taken });
  }
  try {
    await tx.query(
      `INSERT INTO booking_seats (booking_id, seat_id, event_id)
       SELECT $1, seat_id, $3 FROM unnest($2::uuid[]) AS seat_id`,
      [bookingId, seatIds, eventId],
    );
  } catch (err) {
    if (isPgError(err) && err.code === PgCode.UNIQUE_VIOLATION) {
      throw conflict('SEAT_UNAVAILABLE', 'One or more selected seats are already booked');
    }
    throw err;
  }
}

/** Picks the front-most free seats, preferring a row where the whole party fits together. */
async function assignBestSeats(tx: Tx, bookingId: string, eventId: string, quantity: number) {
  const { rowCount } = await tx.query(
    `WITH free AS (
       SELECT s.id, s.row_label, s.seat_number,
              count(*) OVER (PARTITION BY s.row_label) AS free_in_row
         FROM seats s
        WHERE s.event_id = $2
          AND NOT EXISTS (SELECT 1 FROM booking_seats bs WHERE bs.seat_id = s.id AND bs.active)
     )
     INSERT INTO booking_seats (booking_id, seat_id, event_id)
     SELECT $1, id, $2 FROM free
      ORDER BY (free_in_row >= $3) DESC, row_label, seat_number
      LIMIT $3`,
    [bookingId, eventId, quantity],
  );
  if (rowCount !== quantity) {
    // Seats and capacity are kept in lockstep, so this means corrupted data.
    throw new Error(`Seat map for event ${eventId} is inconsistent with its capacity`);
  }
}

/** Works out why the conditional UPDATE matched no row, for a precise error. */
async function explainRejection(tx: Tx, eventId: string, quantity: number): Promise<never> {
  const { rows } = await tx.query<InventoryRow>('SELECT * FROM inventory WHERE event_id = $1', [eventId]);
  const event = rows[0];
  if (!event || event.status === 'draft') throw notFound('Event');
  if (event.status === 'cancelled') throw conflict('EVENT_CANCELLED', 'This event has been cancelled');
  if (event.starts_at.getTime() <= Date.now()) {
    throw conflict('EVENT_STARTED', 'Bookings are closed because the event has already started');
  }
  if (quantity > event.max_per_booking) {
    throw badRequest('QUANTITY_LIMIT_EXCEEDED', `At most ${event.max_per_booking} tickets per booking`, {
      maxPerBooking: event.max_per_booking,
    });
  }
  const available = event.capacity - event.booked_count;
  if (available <= 0) {
    throw conflict('SOLD_OUT', 'This event is sold out. Join the waitlist to be notified when a spot opens.', {
      available: 0,
      waitlistUrl: `/api/v1/events/${eventId}/waitlist`,
    });
  }
  throw conflict('INSUFFICIENT_CAPACITY', `Only ${available} ticket(s) left`, { available });
}
