import type { BookingDto } from './model.js';

const escape = (text: string) => text.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
const stamp = (date: Date | string) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545 calendar entry so attendees can add the event to their calendar. */
export function bookingToIcs(booking: BookingDto): string {
  const start = new Date(booking.event.startsAt);
  const end = booking.event.endsAt ? new Date(booking.event.endsAt) : new Date(start.getTime() + 2 * 3_600_000);
  const seats = booking.seats.map((s) => `${s.row}${s.number}`).join(', ');
  const description = [
    `${booking.quantity} ticket(s)`,
    seats && `Seats: ${seats}`,
    `Booking reference: ${booking.id}`,
  ].filter(Boolean).join('\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Evently//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@evently`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(booking.event.name)}`,
    `LOCATION:${escape(booking.event.venue)}`,
    `DESCRIPTION:${escape(description)}`,
    `STATUS:${booking.status === 'cancelled' || booking.event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
