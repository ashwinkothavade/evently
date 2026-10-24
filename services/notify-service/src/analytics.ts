import type { Database } from '@evently/shared/db';
import { notFound } from '@evently/shared/errors';

const ratio = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : 0);

/** Admin analytics over the notify-service read models (CQRS: no load on booking-service). */
export function createAnalyticsService(db: Database) {
  async function overview() {
    const [{ rows: b }, { rows: e }] = await Promise.all([
      db.pool.query<{
        total: number; confirmed: number; cancelled: number; user_cancelled: number;
        tickets_sold: number; revenue_cents: number; waitlist_promotions: number;
      }>(
        `SELECT count(*)::int                                                         AS total,
                count(*) FILTER (WHERE status = 'confirmed')::int                     AS confirmed,
                count(*) FILTER (WHERE status = 'cancelled')::int                     AS cancelled,
                count(*) FILTER (WHERE cancel_reason IN ('user', 'admin'))::int       AS user_cancelled,
                COALESCE(sum(quantity) FILTER (WHERE status = 'confirmed'), 0)::int   AS tickets_sold,
                COALESCE(sum(total_price_cents) FILTER (WHERE status = 'confirmed'), 0)::bigint AS revenue_cents,
                count(*) FILTER (WHERE source = 'waitlist')::int                      AS waitlist_promotions
           FROM booking_facts`,
      ),
      db.pool.query<{
        total: number; upcoming: number; sold_out: number; cancelled: number;
        capacity: number; booked: number; waitlisted: number;
      }>(
        `SELECT count(*)::int                                                                   AS total,
                count(*) FILTER (WHERE status = 'published' AND starts_at > now())::int         AS upcoming,
                count(*) FILTER (WHERE status = 'published' AND booked_count >= capacity AND capacity > 0)::int AS sold_out,
                count(*) FILTER (WHERE status = 'cancelled')::int                               AS cancelled,
                COALESCE(sum(capacity) FILTER (WHERE status = 'published'), 0)::int             AS capacity,
                COALESCE(sum(booked_count) FILTER (WHERE status = 'published'), 0)::int         AS booked,
                COALESCE(sum(waitlist_size) FILTER (WHERE status = 'published'), 0)::int        AS waitlisted
           FROM event_stats`,
      ),
    ]);
    const bk = b[0]!;
    const ev = e[0]!;
    return {
      bookings: {
        total: bk.total,
        confirmed: bk.confirmed,
        cancelled: bk.cancelled,
        /** Share of bookings cancelled by users/admins (event cancellations excluded). */
        cancellationRate: ratio(bk.user_cancelled, bk.total),
        ticketsSold: bk.tickets_sold,
        revenueCents: bk.revenue_cents,
        waitlistPromotions: bk.waitlist_promotions,
      },
      events: {
        total: ev.total,
        upcoming: ev.upcoming,
        soldOut: ev.sold_out,
        cancelled: ev.cancelled,
        totalCapacity: ev.capacity,
        ticketsBooked: ev.booked,
        capacityUtilization: ratio(ev.booked, ev.capacity),
        peopleOnWaitlists: ev.waitlisted,
      },
    };
  }

  async function popularEvents(limit: number) {
    const { rows } = await db.pool.query(
      `SELECT e.event_id AS "eventId", e.name, e.venue, e.starts_at AS "startsAt", e.status,
              e.capacity, e.booked_count AS "ticketsSold", e.waitlist_size AS "waitlistSize",
              COALESCE(f.bookings, 0)::int       AS "totalBookings",
              COALESCE(f.cancellations, 0)::int  AS "cancellations",
              COALESCE(f.revenue, 0)::bigint     AS "revenueCents",
              CASE WHEN e.capacity > 0 THEN round(e.booked_count::numeric / e.capacity, 4) ELSE 0 END AS "utilization"
         FROM event_stats e
         LEFT JOIN (
           SELECT event_id, count(*) AS bookings,
                  count(*) FILTER (WHERE status = 'cancelled') AS cancellations,
                  sum(total_price_cents) FILTER (WHERE status = 'confirmed') AS revenue
             FROM booking_facts GROUP BY event_id
         ) f USING (event_id)
        WHERE e.status <> 'draft'
        ORDER BY e.booked_count DESC, "totalBookings" DESC
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async function capacityUtilization(opts: { upcomingOnly: boolean; limit: number }) {
    const { rows } = await db.pool.query(
      `SELECT event_id AS "eventId", name, venue, starts_at AS "startsAt", status, capacity,
              booked_count AS "bookedCount", capacity - booked_count AS "available",
              waitlist_size AS "waitlistSize",
              CASE WHEN capacity > 0 THEN round(booked_count::numeric / capacity, 4) ELSE 0 END AS "utilization"
         FROM event_stats
        WHERE status = 'published' AND ($1::boolean IS FALSE OR starts_at > now())
        ORDER BY "utilization" DESC, starts_at
        LIMIT $2`,
      [opts.upcomingOnly, opts.limit],
    );
    return rows;
  }

  /** Bookings, cancellations and revenue per day (UTC), with zero-filled gaps. */
  async function daily(opts: { from: string; to: string; eventId?: string }) {
    const { rows } = await db.pool.query(
      `WITH days AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day),
            booked AS (
              SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS bookings,
                     sum(quantity) AS tickets, sum(total_price_cents) AS revenue
                FROM booking_facts
               WHERE created_at >= $1::date AND created_at < $2::date + 1
                 AND ($3::uuid IS NULL OR event_id = $3)
               GROUP BY 1),
            cancelled AS (
              SELECT (cancelled_at AT TIME ZONE 'UTC')::date AS day, count(*) AS cancellations,
                     sum(quantity) AS tickets_released
                FROM booking_facts
               WHERE cancelled_at >= $1::date AND cancelled_at < $2::date + 1
                 AND ($3::uuid IS NULL OR event_id = $3)
               GROUP BY 1)
       SELECT to_char(d.day, 'YYYY-MM-DD')               AS date,
              COALESCE(b.bookings, 0)::int              AS bookings,
              COALESCE(b.tickets, 0)::int               AS "ticketsBooked",
              COALESCE(b.revenue, 0)::bigint            AS "revenueCents",
              COALESCE(c.cancellations, 0)::int         AS cancellations,
              COALESCE(c.tickets_released, 0)::int      AS "ticketsReleased"
         FROM days d
         LEFT JOIN booked b USING (day)
         LEFT JOIN cancelled c USING (day)
        ORDER BY d.day`,
      [opts.from, opts.to, opts.eventId ?? null],
    );
    return rows;
  }

  async function eventDetail(eventId: string, range: { from: string; to: string }) {
    const { rows } = await db.pool.query<Record<string, unknown> & { total: number; user_cancelled: number }>(
      `SELECT e.event_id AS "eventId", e.name, e.venue, e.starts_at AS "startsAt", e.status,
              e.capacity, e.booked_count AS "bookedCount", e.waitlist_size AS "waitlistSize",
              CASE WHEN e.capacity > 0 THEN round(e.booked_count::numeric / e.capacity, 4) ELSE 0 END AS "utilization",
              count(f.booking_id)::int AS total,
              count(f.booking_id) FILTER (WHERE f.status = 'confirmed')::int AS "confirmedBookings",
              count(f.booking_id) FILTER (WHERE f.status = 'cancelled')::int AS "cancelledBookings",
              count(f.booking_id) FILTER (WHERE f.cancel_reason IN ('user', 'admin'))::int AS user_cancelled,
              count(f.booking_id) FILTER (WHERE f.source = 'waitlist')::int AS "waitlistPromotions",
              COALESCE(sum(f.total_price_cents) FILTER (WHERE f.status = 'confirmed'), 0)::bigint AS "revenueCents"
         FROM event_stats e LEFT JOIN booking_facts f ON f.event_id = e.event_id
        WHERE e.event_id = $1
        GROUP BY e.event_id`,
      [eventId],
    );
    const row = rows[0];
    if (!row) throw notFound('Event');
    const { total, user_cancelled, ...rest } = row;
    return {
      ...rest,
      totalBookings: total,
      cancellationRate: ratio(user_cancelled, total),
      daily: await daily({ ...range, eventId }),
    };
  }

  return { overview, popularEvents, capacityUtilization, daily, eventDetail };
}
