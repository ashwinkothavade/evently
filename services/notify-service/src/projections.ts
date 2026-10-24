import type { HandlerMap } from '@evently/shared/bus';
import type { EventSnapshot } from '@evently/shared/contracts';
import type { Tx } from '@evently/shared/db';
import { insertNotifications, type NewNotification } from './notifications.js';

/*
 * Integration-event handlers. Each runs in a transaction together with the
 * processed_events dedupe insert (see shared/bus), so it is applied exactly once.
 * Version guards make the projections safe against out-of-order delivery.
 */

async function upsertEventSnapshot(tx: Tx, e: EventSnapshot) {
  await tx.query(
    `INSERT INTO event_stats (event_id, name, venue, starts_at, status, price_cents, capacity, catalog_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (event_id) DO UPDATE
        SET name = EXCLUDED.name, venue = EXCLUDED.venue, starts_at = EXCLUDED.starts_at,
            status = EXCLUDED.status, price_cents = EXCLUDED.price_cents,
            capacity = EXCLUDED.capacity, catalog_version = EXCLUDED.catalog_version
      WHERE event_stats.catalog_version < EXCLUDED.catalog_version`,
    [e.eventId, e.name, e.venue, e.startsAt, e.status, e.priceCents, e.capacity, e.version],
  );
}

const money = (cents: number) => (cents === 0 ? 'free' : `$${(cents / 100).toFixed(2)}`);

export const projectionHandlers: HandlerMap = {
  'user.registered': async (tx, { data }) => {
    await tx.query(
      `INSERT INTO users (id, email, name, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role`,
      [data.userId, data.email, data.name, data.role],
    );
  },

  'event.created': async (tx, { data }) => upsertEventSnapshot(tx, data),

  'event.updated': async (tx, { data }) => {
    await upsertEventSnapshot(tx, data);
    // Tell ticket holders when something that affects their plans changes.
    const relevant = data.changed.filter((field) => field === 'startsAt' || field === 'venue' || field === 'endsAt');
    if (relevant.length === 0 || data.status !== 'published') return;
    const { rows } = await tx.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM booking_facts WHERE event_id = $1 AND status = 'confirmed'`,
      [data.eventId],
    );
    const what = relevant.map((f) => (f === 'venue' ? 'venue' : 'time')).filter((v, i, a) => a.indexOf(v) === i);
    await insertNotifications(
      tx,
      rows.map((r) => ({
        userId: r.user_id,
        type: 'EVENT_UPDATED',
        title: `${data.name}: ${what.join(' & ')} changed`,
        body: `${data.name} now starts ${new Date(data.startsAt).toUTCString()} at ${data.venue}. Your tickets remain valid.`,
        data: { eventId: data.eventId, changed: relevant },
      })),
    );
  },

  'event.cancelled': async (tx, { data }) => upsertEventSnapshot(tx, data),

  'inventory.changed': async (tx, { data }) => {
    await tx.query(
      `INSERT INTO event_stats (event_id, capacity, booked_count, waitlist_size, inventory_version)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO UPDATE
          SET capacity = EXCLUDED.capacity, booked_count = EXCLUDED.booked_count,
              waitlist_size = EXCLUDED.waitlist_size, inventory_version = EXCLUDED.inventory_version
        WHERE event_stats.inventory_version < EXCLUDED.inventory_version`,
      [data.eventId, data.capacity, data.bookedCount, data.waitlistSize, data.inventoryVersion],
    );
  },

  'booking.confirmed': async (tx, { data }) => {
    await tx.query(
      `INSERT INTO booking_facts (booking_id, event_id, user_id, quantity, total_price_cents, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (booking_id) DO NOTHING`,
      [data.bookingId, data.eventId, data.userId, data.quantity, data.totalPriceCents, data.source, data.createdAt],
    );
    const seats = data.seats.length > 0 ? ` Seats: ${data.seats.join(', ')}.` : '';
    const notification: NewNotification =
      data.source === 'waitlist'
        ? {
            userId: data.userId,
            type: 'WAITLIST_PROMOTED',
            title: `You're in! A spot opened for ${data.eventName}`,
            body: `We booked ${data.quantity} ticket(s) for you from the waitlist (${money(data.totalPriceCents)}).${seats}`,
            data: { eventId: data.eventId, bookingId: data.bookingId },
          }
        : {
            userId: data.userId,
            type: 'BOOKING_CONFIRMED',
            title: `Booking confirmed: ${data.eventName}`,
            body: `${data.quantity} ticket(s) confirmed (${money(data.totalPriceCents)}).${seats}`,
            data: { eventId: data.eventId, bookingId: data.bookingId },
          };
    await insertNotifications(tx, [notification]);
  },

  'booking.cancelled': async (tx, { data }) => {
    await tx.query(
      `UPDATE booking_facts SET status = 'cancelled', cancelled_at = $2, cancel_reason = $3 WHERE booking_id = $1`,
      [data.bookingId, data.cancelledAt, data.reason],
    );
    const notification: NewNotification =
      data.reason === 'event_cancelled'
        ? {
            userId: data.userId,
            type: 'EVENT_CANCELLED',
            title: `${data.eventName} has been cancelled`,
            body: `The organiser cancelled ${data.eventName}. Your ${data.quantity} ticket(s) have been cancelled.`,
            data: { eventId: data.eventId, bookingId: data.bookingId },
          }
        : {
            userId: data.userId,
            type: 'BOOKING_CANCELLED',
            title: `Booking cancelled: ${data.eventName}`,
            body:
              data.reason === 'admin'
                ? `An administrator cancelled your booking of ${data.quantity} ticket(s).`
                : `You cancelled ${data.quantity} ticket(s). We hope to see you at another event!`,
            data: { eventId: data.eventId, bookingId: data.bookingId },
          };
    await insertNotifications(tx, [notification]);
  },
};
