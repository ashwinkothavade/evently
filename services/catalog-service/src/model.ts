import type { EventSnapshot, EventStatus } from '@evently/shared/contracts';
import { iso, isoOrNull } from '@evently/shared/time';

export interface EventRow {
  id: string;
  name: string;
  description: string | null;
  venue: string;
  starts_at: Date;
  ends_at: Date | null;
  capacity: number;
  price_cents: number;
  max_per_booking: number;
  seat_rows: number | null;
  seats_per_row: number | null;
  status: EventStatus;
  cancel_reason: string | null;
  version: number;
  booked_count: number;
  created_at: Date;
  updated_at: Date;
}

export function toEventDto(row: EventRow) {
  const availableSeats = Math.max(0, row.capacity - row.booked_count);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    venue: row.venue,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity: row.capacity,
    bookedCount: row.booked_count,
    availableSeats,
    soldOut: availableSeats === 0,
    priceCents: row.price_cents,
    maxPerBooking: row.max_per_booking,
    isSeated: row.seat_rows !== null,
    seating: row.seat_rows !== null ? { rows: row.seat_rows, seatsPerRow: row.seats_per_row } : null,
    status: row.status,
    cancelReason: row.cancel_reason,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toSnapshot(row: EventRow): EventSnapshot {
  return {
    eventId: row.id,
    name: row.name,
    venue: row.venue,
    startsAt: iso(row.starts_at),
    endsAt: isoOrNull(row.ends_at),
    capacity: row.capacity,
    priceCents: row.price_cents,
    maxPerBooking: row.max_per_booking,
    isSeated: row.seat_rows !== null,
    status: row.status,
    version: row.version,
  };
}
