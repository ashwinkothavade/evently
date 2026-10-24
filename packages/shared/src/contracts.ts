/**
 * Integration-event contracts: the ONLY data shared between services.
 * Each producer appends to its own Redis stream; consumers subscribe with a
 * consumer group per service. Delivery is at-least-once, so every consumer is
 * idempotent (see bus.ts).
 */

export const Streams = {
  auth: 'evently:auth',
  catalog: 'evently:catalog',
  booking: 'evently:booking',
} as const;

export interface IntegrationEvent<TType extends string = string, TData = unknown> {
  id: string;
  type: TType;
  source: string;
  occurredAt: string;
  data: TData;
}

// ---- auth-service -----------------------------------------------------------

export interface UserRegistered {
  userId: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
}

// ---- catalog-service --------------------------------------------------------

export type EventStatus = 'draft' | 'published' | 'cancelled';

export interface EventSnapshot {
  eventId: string;
  name: string;
  venue: string;
  startsAt: string;
  endsAt: string | null;
  capacity: number;
  priceCents: number;
  maxPerBooking: number;
  isSeated: boolean;
  status: EventStatus;
  version: number;
}

export interface EventUpdated extends EventSnapshot {
  changed: string[];
}

export interface EventCancelled extends EventSnapshot {
  reason: string | null;
}

// ---- booking-service --------------------------------------------------------

export interface BookingConfirmed {
  bookingId: string;
  userId: string;
  eventId: string;
  eventName: string;
  quantity: number;
  totalPriceCents: number;
  source: 'direct' | 'waitlist';
  seats: string[];
  createdAt: string;
}

export interface BookingCancelled {
  bookingId: string;
  userId: string;
  eventId: string;
  eventName: string;
  quantity: number;
  totalPriceCents: number;
  reason: 'user' | 'admin' | 'event_cancelled';
  cancelledAt: string;
}

export interface InventoryChanged {
  eventId: string;
  capacity: number;
  bookedCount: number;
  waitlistSize: number;
  /** Monotonic per event; consumers ignore anything older than what they have. */
  inventoryVersion: number;
}

export interface EventPayloads {
  'user.registered': UserRegistered;
  'event.created': EventSnapshot;
  'event.updated': EventUpdated;
  'event.cancelled': EventCancelled;
  'booking.confirmed': BookingConfirmed;
  'booking.cancelled': BookingCancelled;
  'inventory.changed': InventoryChanged;
}

export type EventType = keyof EventPayloads;

// ---- synchronous internal API (catalog-service → booking-service) ------------

/** PUT /internal/inventory/:eventId – create or update the bookable inventory for an event. */
export interface InventorySyncRequest {
  name: string;
  venue: string;
  startsAt: string;
  endsAt: string | null;
  capacity: number;
  priceCents: number;
  maxPerBooking: number;
  status: EventStatus;
  seating: { rows: number; seatsPerRow: number } | null;
  catalogVersion: number;
}

export interface InventorySyncResponse {
  bookedCount: number;
  waitlistPromoted: number;
}

/** POST /internal/inventory/:eventId/cancel */
export interface InventoryCancelResponse {
  bookingsCancelled: number;
}
