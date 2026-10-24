/** Shapes returned by the Evently API gateway (see services/gateway/openapi.yaml). */

export type Role = 'user' | 'admin';
export type EventStatus = 'draft' | 'published' | 'cancelled';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface Session {
  token: string;
  user: User;
}

export interface EventItem {
  id: string;
  name: string;
  description: string | null;
  venue: string;
  startsAt: string;
  endsAt: string | null;
  capacity: number;
  bookedCount: number;
  availableSeats: number;
  soldOut: boolean;
  priceCents: number;
  maxPerBooking: number;
  isSeated: boolean;
  seating: { rows: number; seatsPerRow: number } | null;
  status: EventStatus;
  cancelReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Seat {
  id: string;
  number: number;
  available: boolean;
}

export interface SeatMap {
  eventId: string;
  availableSeats: number;
  rows: { label: string; seats: Seat[] }[];
}

export interface Booking {
  id: string;
  userId: string;
  eventId: string;
  quantity: number;
  status: 'confirmed' | 'cancelled';
  totalPriceCents: number;
  source: 'direct' | 'waitlist';
  seats: { id: string; row: string; number: number }[];
  createdAt: string;
  cancelledAt: string | null;
  event: { id: string; name: string; venue: string; startsAt: string; endsAt: string | null; status: EventStatus };
}

export interface WaitlistEntry {
  id: string;
  eventId: string;
  quantity: number;
  status: 'waiting' | 'promoted' | 'left' | 'expired';
  position: number | null;
  bookingId: string | null;
  createdAt: string;
  event?: { id: string; name: string; startsAt: string };
}

export interface Notification {
  id: string;
  type: 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'WAITLIST_PROMOTED' | 'EVENT_CANCELLED' | 'EVENT_UPDATED';
  title: string;
  body: string;
  data: { eventId?: string; bookingId?: string };
  read: boolean;
  createdAt: string;
}

export interface Attendee {
  id: string;
  quantity: number;
  status: 'confirmed' | 'cancelled';
  source: 'direct' | 'waitlist';
  totalPriceCents: number;
  createdAt: string;
  cancelledAt: string | null;
  user: { id: string; name: string | null; email: string | null };
}

export interface AnalyticsOverview {
  bookings: {
    total: number;
    confirmed: number;
    cancelled: number;
    cancellationRate: number;
    ticketsSold: number;
    revenueCents: number;
    waitlistPromotions: number;
  };
  events: {
    total: number;
    upcoming: number;
    soldOut: number;
    cancelled: number;
    totalCapacity: number;
    ticketsBooked: number;
    capacityUtilization: number;
    peopleOnWaitlists: number;
  };
}

export interface PopularEvent {
  eventId: string;
  name: string;
  venue: string;
  startsAt: string;
  status: EventStatus;
  capacity: number;
  ticketsSold: number;
  waitlistSize: number;
  totalBookings: number;
  cancellations: number;
  revenueCents: number;
  utilization: number;
}

export interface UtilizationRow {
  eventId: string;
  name: string;
  venue: string;
  startsAt: string;
  capacity: number;
  bookedCount: number;
  available: number;
  waitlistSize: number;
  utilization: number;
}

export interface DailyStat {
  date: string;
  bookings: number;
  ticketsBooked: number;
  revenueCents: number;
  cancellations: number;
  ticketsReleased: number;
}

export interface IntegrityReport {
  ok: boolean;
  eventsChecked: number;
  mismatches: { eventId: string; name: string; bookedCount: number; confirmedTickets: number }[];
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
