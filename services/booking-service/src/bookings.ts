import { publish } from '@evently/shared/bus';
import type { Cache } from '@evently/shared/cache';
import { isPgError, PgCode, type Database, type Queryable } from '@evently/shared/db';
import { AppError, conflict, notFound } from '@evently/shared/errors';
import type { AuthUser } from '@evently/shared/http';
import { decodeCursor, paginate } from '@evently/shared/pagination';
import { iso } from '@evently/shared/time';
import { bookingConfirmedPayload, emitInventoryChanged, promoteWaitlist } from './inventory.js';
import { BOOKING_DETAIL_GROUP, BOOKING_DETAIL_SELECT, toBookingDto, type BookingDetailRow, type BookingRow } from './model.js';
import { reserveTickets } from './reservation.js';

export interface CreateBookingInput {
  userId: string;
  eventId: string;
  quantity: number;
  seatIds?: string[];
  idempotencyKey?: string;
}

const soldOutKey = (eventId: string) => `soldout:${eventId}`;

export function createBookingService(deps: {
  db: Database;
  cache: Cache;
  soldOutTtlSeconds: number;
  onPublished: () => void;
}) {
  const { db, cache } = deps;

  async function getDetail(q: Queryable, id: string) {
    const { rows } = await q.query<BookingDetailRow>(
      `${BOOKING_DETAIL_SELECT} WHERE b.id = $1 ${BOOKING_DETAIL_GROUP}`,
      [id],
    );
    return rows[0];
  }

  async function findByIdempotencyKey(userId: string, key: string) {
    const { rows } = await db.pool.query<BookingRow>(
      'SELECT * FROM bookings WHERE user_id = $1 AND idempotency_key = $2',
      [userId, key],
    );
    return rows[0];
  }

  async function replay(existing: BookingRow, eventId: string) {
    if (existing.event_id !== eventId) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different booking');
    }
    return { booking: toBookingDto((await getDetail(db.pool, existing.id))!), created: false };
  }

  /**
   * Books tickets. Returns `created: false` when the request is a replay of an
   * earlier one with the same Idempotency-Key (safe client retries).
   */
  async function create(input: CreateBookingInput) {
    if (input.idempotencyKey) {
      const existing = await findByIdempotencyKey(input.userId, input.idempotencyKey);
      if (existing) return replay(existing, input.eventId);
    }

    // Sold-out fast path: absorb a thundering herd without touching Postgres.
    if ((await cache.get<boolean>(soldOutKey(input.eventId))) === true) {
      throw conflict('SOLD_OUT', 'This event is sold out. Join the waitlist to be notified when a spot opens.', {
        available: 0,
        waitlistUrl: `/api/v1/events/${input.eventId}/waitlist`,
      });
    }

    try {
      const detail = await db.withTransaction(async (tx) => {
        const reservation = await reserveTickets(tx, { ...input, source: 'direct' });
        await publish(tx, 'booking.confirmed', bookingConfirmedPayload(reservation));
        await emitInventoryChanged(tx, input.eventId);
        return (await getDetail(tx, reservation.booking.id))!;
      });
      deps.onPublished();
      return { booking: toBookingDto(detail), created: true };
    } catch (err) {
      if (err instanceof AppError && err.code === 'SOLD_OUT') {
        await cache.set(soldOutKey(input.eventId), true, deps.soldOutTtlSeconds);
      }
      // Two concurrent requests with the same key: the loser replays the winner.
      if (isPgError(err) && err.code === PgCode.UNIQUE_VIOLATION && err.constraint === 'bookings_user_idempotency_key') {
        const existing = await findByIdempotencyKey(input.userId, input.idempotencyKey!);
        if (existing) return replay(existing, input.eventId);
      }
      throw err;
    }
  }

  async function get(id: string, actor: AuthUser) {
    const row = await getDetail(db.pool, id);
    // 404 rather than 403 so booking ids of other users cannot be probed.
    if (!row || (row.user_id !== actor.id && actor.role !== 'admin')) throw notFound('Booking');
    return toBookingDto(row);
  }

  async function listForUser(userId: string, opts: { status?: 'confirmed' | 'cancelled'; limit: number; cursor?: string }) {
    const cursor = decodeCursor(opts.cursor);
    const { rows } = await db.pool.query<BookingDetailRow>(
      `${BOOKING_DETAIL_SELECT}
        WHERE b.user_id = $1
          AND ($2::booking_status IS NULL OR b.status = $2)
          AND ($3::timestamptz IS NULL OR (b.created_at, b.id) < ($3::timestamptz, $4::uuid))
        ${BOOKING_DETAIL_GROUP}
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT $5`,
      [userId, opts.status ?? null, cursor?.[0] ?? null, cursor?.[1] ?? null, opts.limit + 1],
    );
    const { page, nextCursor } = paginate(rows, opts.limit);
    return { items: page.map(toBookingDto), nextCursor };
  }

  /**
   * Cancels a booking, releases its tickets/seats and – in the same transaction –
   * hands them to the waitlist so nobody can snipe them in between.
   */
  async function cancel(id: string, actor: AuthUser) {
    const result = await db.withTransaction(async (tx) => {
      const { rows } = await tx.query<BookingRow & { event_name: string; starts_at: Date }>(
        `SELECT b.*, i.name AS event_name, i.starts_at
           FROM bookings b JOIN inventory i ON i.event_id = b.event_id
          WHERE b.id = $1
          FOR UPDATE OF b`,
        [id],
      );
      const booking = rows[0];
      if (!booking || (booking.user_id !== actor.id && actor.role !== 'admin')) throw notFound('Booking');
      if (booking.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'Booking is already cancelled');
      if (booking.starts_at.getTime() <= Date.now()) {
        throw conflict('EVENT_STARTED', 'Bookings cannot be cancelled after the event has started');
      }

      const { rows: cancelled } = await tx.query<BookingRow>(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1 RETURNING *`,
        [id],
      );
      await tx.query('UPDATE booking_seats SET active = false WHERE booking_id = $1', [id]);
      await tx.query(
        'UPDATE inventory SET booked_count = booked_count - $2, updated_at = now() WHERE event_id = $1',
        [booking.event_id, booking.quantity],
      );
      await publish(tx, 'booking.cancelled', {
        bookingId: id,
        userId: booking.user_id,
        eventId: booking.event_id,
        eventName: booking.event_name,
        quantity: booking.quantity,
        totalPriceCents: booking.total_price_cents,
        reason: actor.role === 'admin' && actor.id !== booking.user_id ? 'admin' : 'user',
        cancelledAt: iso(cancelled[0]!.cancelled_at!),
      });
      const promoted = await promoteWaitlist(tx, booking.event_id);
      await emitInventoryChanged(tx, booking.event_id);
      return { detail: (await getDetail(tx, id))!, promoted, eventId: booking.event_id };
    });
    deps.onPublished();
    await cache.del(soldOutKey(result.eventId));
    return { ...toBookingDto(result.detail), waitlistPromoted: result.promoted };
  }

  async function listForEvent(eventId: string, opts: { limit: number; offset: number }) {
    const { rows } = await db.pool.query<Record<string, unknown> & { total: number }>(
      `SELECT b.id, b.quantity, b.status, b.source, b.total_price_cents AS "totalPriceCents",
              b.created_at AS "createdAt", b.cancelled_at AS "cancelledAt",
              json_build_object('id', b.user_id, 'name', u.name, 'email', u.email) AS user,
              count(*) OVER () AS total
         FROM bookings b LEFT JOIN users u ON u.id = b.user_id
        WHERE b.event_id = $1
        ORDER BY b.created_at DESC
        LIMIT $2 OFFSET $3`,
      [eventId, opts.limit, opts.offset],
    );
    return { items: rows.map(({ total: _total, ...rest }) => rest), total: rows[0]?.total ?? 0 };
  }

  return { create, get, listForUser, cancel, listForEvent };
}

export type BookingService = ReturnType<typeof createBookingService>;
