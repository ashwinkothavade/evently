import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client';
import type {
  AnalyticsOverview, Attendee, Booking, DailyStat, EventItem, IntegrityReport, Notification, Page,
  PopularEvent, SeatMap, UtilizationRow, WaitlistEntry,
} from './types';

type Data<T> = { data: T };

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const keys = {
  events: ['events'] as const,
  event: (id: string) => ['events', id] as const,
  seats: (id: string) => ['events', id, 'seats'] as const,
  bookings: ['bookings'] as const,
  waitlist: ['waitlist'] as const,
  notifications: ['notifications'] as const,
  admin: ['admin'] as const,
};

// ---- events ------------------------------------------------------------------

export function useEvents(filters: { q?: string; available?: boolean }) {
  return useInfiniteQuery({
    queryKey: [...keys.events, filters],
    queryFn: ({ pageParam }) =>
      request<Page<EventItem>>('GET', `/events${qs({ ...filters, available: filters.available || undefined, limit: 12, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: keys.event(id),
    queryFn: () => request<Data<EventItem>>('GET', `/events/${id}`).then((r) => r.data),
    refetchInterval: 10_000, // keep availability fresh while the user decides
  });
}

export function useSeatMap(id: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.seats(id),
    queryFn: () => request<Data<SeatMap>>('GET', `/events/${id}/seats`).then((r) => r.data),
    enabled,
    refetchInterval: 10_000,
  });
}

// ---- bookings & waitlist -------------------------------------------------------

export function useBookings(status?: 'confirmed' | 'cancelled') {
  return useInfiniteQuery({
    queryKey: [...keys.bookings, status],
    queryFn: ({ pageParam }) => request<Page<Booking>>('GET', `/bookings${qs({ status, limit: 10, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Invalidates everything a booking change can affect. */
function useInvalidateBookingViews() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.events }),
      client.invalidateQueries({ queryKey: keys.bookings }),
      client.invalidateQueries({ queryKey: keys.waitlist }),
      client.invalidateQueries({ queryKey: keys.notifications }),
    ]);
}

export function useCreateBooking() {
  const invalidate = useInvalidateBookingViews();
  return useMutation({
    mutationFn: (input: { eventId: string; quantity?: number; seatIds?: string[]; idempotencyKey: string }) =>
      request<Data<Booking>>('POST', '/bookings', {
        body: { eventId: input.eventId, quantity: input.quantity, seatIds: input.seatIds },
        headers: { 'Idempotency-Key': input.idempotencyKey },
      }).then((r) => r.data),
    onSettled: invalidate,
  });
}

export function useCancelBooking() {
  const invalidate = useInvalidateBookingViews();
  return useMutation({
    mutationFn: (id: string) => request<Data<Booking>>('POST', `/bookings/${id}/cancel`).then((r) => r.data),
    onSettled: invalidate,
  });
}

export function useWaitlist(enabled = true) {
  return useQuery({
    queryKey: keys.waitlist,
    queryFn: () => request<Data<WaitlistEntry[]>>('GET', '/waitlist').then((r) => r.data),
    enabled,
  });
}

export function useJoinWaitlist() {
  const invalidate = useInvalidateBookingViews();
  return useMutation({
    mutationFn: (input: { eventId: string; quantity: number }) =>
      request<Data<WaitlistEntry>>('POST', `/events/${input.eventId}/waitlist`, { body: { quantity: input.quantity } }).then((r) => r.data),
    onSettled: invalidate,
  });
}

export function useLeaveWaitlist() {
  const invalidate = useInvalidateBookingViews();
  return useMutation({
    mutationFn: (eventId: string) => request<void>('DELETE', `/events/${eventId}/waitlist`),
    onSettled: invalidate,
  });
}

// ---- notifications -------------------------------------------------------------

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => request<{ data: Notification[]; meta: { unreadCount: number } }>('GET', '/notifications?limit=50'),
    enabled,
    refetchInterval: 15_000,
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request('POST', `/notifications/${id}/read`),
    onSettled: () => client.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => request('POST', '/notifications/read-all'),
    onSettled: () => client.invalidateQueries({ queryKey: keys.notifications }),
  });
}

// ---- admin -----------------------------------------------------------------------

export interface EventInput {
  name: string;
  description?: string | null;
  venue: string;
  startsAt: string;
  endsAt?: string | null;
  capacity?: number;
  priceCents: number;
  maxPerBooking: number;
  status: 'draft' | 'published';
  seating?: { rows: number; seatsPerRow: number };
}

export function useAdminEvents(status?: string) {
  return useQuery({
    queryKey: [...keys.admin, 'events', status],
    queryFn: () => request<{ data: EventItem[]; meta: { total: number } }>('GET', `/admin/events${qs({ status, limit: 100 })}`),
  });
}

function useInvalidateAdmin() {
  const client = useQueryClient();
  return () =>
    Promise.all([client.invalidateQueries({ queryKey: keys.admin }), client.invalidateQueries({ queryKey: keys.events })]);
}

export function useCreateEvent() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (input: EventInput) => request<Data<EventItem>>('POST', '/admin/events', { body: input }).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateEvent() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, version, patch }: { id: string; version: number; patch: Partial<EventInput> }) =>
      request<Data<EventItem & { waitlistPromoted: number }>>('PATCH', `/admin/events/${id}`, {
        body: patch,
        headers: { 'If-Match': `"${version}"` },
      }).then((r) => r.data),
    onSettled: invalidate,
  });
}

export function useCancelEvent() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      request<Data<EventItem & { bookingsCancelled: number }>>('POST', `/admin/events/${id}/cancel`, { body: { reason } }).then((r) => r.data),
    onSettled: invalidate,
  });
}

export function useAttendees(eventId: string | null) {
  return useQuery({
    queryKey: [...keys.admin, 'attendees', eventId],
    queryFn: () => request<{ data: Attendee[]; meta: { total: number } }>('GET', `/admin/events/${eventId}/bookings?limit=200`),
    enabled: eventId !== null,
  });
}

export function useAnalytics(range: { from: string; to: string }) {
  const overview = useQuery({
    queryKey: [...keys.admin, 'overview'],
    queryFn: () => request<Data<AnalyticsOverview>>('GET', '/admin/analytics/overview').then((r) => r.data),
    refetchInterval: 15_000,
  });
  const popular = useQuery({
    queryKey: [...keys.admin, 'popular'],
    queryFn: () => request<Data<PopularEvent[]>>('GET', '/admin/analytics/popular-events?limit=8').then((r) => r.data),
  });
  const utilization = useQuery({
    queryKey: [...keys.admin, 'utilization'],
    queryFn: () => request<Data<UtilizationRow[]>>('GET', '/admin/analytics/capacity-utilization?limit=20').then((r) => r.data),
  });
  const daily = useQuery({
    queryKey: [...keys.admin, 'daily', range],
    queryFn: () => request<Data<DailyStat[]>>('GET', `/admin/analytics/daily${qs(range)}`).then((r) => r.data),
  });
  const integrity = useQuery({
    queryKey: [...keys.admin, 'integrity'],
    queryFn: () => request<Data<IntegrityReport>>('GET', '/admin/analytics/integrity').then((r) => r.data),
  });
  return { overview, popular, utilization, daily, integrity };
}
