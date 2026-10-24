import type { EventStatus } from '@evently/shared/contracts';

export interface InventoryRow {
  event_id: string;
  name: string;
  venue: string;
  starts_at: Date;
  ends_at: Date | null;
  capacity: number;
  booked_count: number;
  price_cents: number;
  max_per_booking: number;
  is_seated: boolean;
  status: EventStatus;
  catalog_version: number;
  inventory_version: number;
}

export interface BookingRow {
  id: string;
  user_id: string;
  event_id: string;
  quantity: number;
  status: 'confirmed' | 'cancelled';
  total_price_cents: number;
  source: 'direct' | 'waitlist';
  idempotency_key: string | null;
  created_at: Date;
  cancelled_at: Date | null;
}

export interface SeatRef {
  id: string;
  row: string;
  number: number;
}

export interface BookingDetailRow extends BookingRow {
  sort_ts: string;
  event_name: string;
  event_venue: string;
  event_starts_at: Date;
  event_ends_at: Date | null;
  event_status: EventStatus;
  seats: SeatRef[];
}

export function toBookingDto(row: BookingDetailRow) {
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    quantity: row.quantity,
    status: row.status,
    totalPriceCents: row.total_price_cents,
    source: row.source,
    seats: row.seats,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    event: {
      id: row.event_id,
      name: row.event_name,
      venue: row.event_venue,
      startsAt: row.event_starts_at,
      endsAt: row.event_ends_at,
      status: row.event_status,
    },
  };
}

export type BookingDto = ReturnType<typeof toBookingDto>;

/** Booking joined with its event and seats; append WHERE/ORDER and GROUP BY b.id, i.event_id. */
export const BOOKING_DETAIL_SELECT = `
  SELECT b.*, b.created_at::text AS sort_ts,
         i.name AS event_name, i.venue AS event_venue, i.starts_at AS event_starts_at,
         i.ends_at AS event_ends_at, i.status AS event_status,
         COALESCE(
           json_agg(json_build_object('id', s.id, 'row', s.row_label, 'number', s.seat_number)
                    ORDER BY s.row_label, s.seat_number) FILTER (WHERE s.id IS NOT NULL),
           '[]') AS seats
    FROM bookings b
    JOIN inventory i ON i.event_id = b.event_id
    LEFT JOIN booking_seats bs ON bs.booking_id = b.id
    LEFT JOIN seats s ON s.id = bs.seat_id`;

export const BOOKING_DETAIL_GROUP = 'GROUP BY b.id, i.event_id';
