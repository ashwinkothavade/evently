import type { InventorySyncRequest } from '@evently/shared/contracts';
import { currentUser, requireAdmin, requireUser } from '@evently/shared/http';
import { IdParam, parse } from '@evently/shared/validate';
import { Router } from 'express';
import { z } from 'zod';
import type { BookingService } from './bookings.js';
import { bookingToIcs } from './ics.js';
import type { createInventoryService } from './inventory.js';
import type { createWaitlistService } from './waitlist.js';

const CreateBookingBody = z
  .object({
    eventId: z.uuid(),
    quantity: z.number().int().min(1).max(100).optional(),
    seatIds: z
      .array(z.uuid())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'seatIds must be unique')
      .optional(),
  })
  .refine((b) => !(b.quantity && b.seatIds && b.quantity !== b.seatIds.length), {
    message: 'quantity must equal the number of seatIds',
    path: ['quantity'],
  });

const IdempotencyKey = z.string().trim().min(8).max(100).optional();

const ListBookingsQuery = z.object({
  status: z.enum(['confirmed', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

const WaitlistBody = z.object({ quantity: z.number().int().min(1).max(100).default(1) }).default({ quantity: 1 });

const Paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const InventorySyncBody = z.object({
  name: z.string(),
  venue: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  capacity: z.number().int().positive(),
  priceCents: z.number().int().min(0),
  maxPerBooking: z.number().int().positive(),
  status: z.enum(['draft', 'published', 'cancelled']),
  seating: z.object({ rows: z.number().int().positive(), seatsPerRow: z.number().int().positive() }).nullable(),
  catalogVersion: z.number().int().positive(),
}) satisfies z.ZodType<InventorySyncRequest>;

export function bookingRoutes(deps: {
  bookings: BookingService;
  waitlist: ReturnType<typeof createWaitlistService>;
  inventory: ReturnType<typeof createInventoryService>;
}) {
  const { bookings, waitlist, inventory } = deps;
  const router = Router();

  // ---- seat map (public) ----------------------------------------------------
  router.get('/api/v1/events/:id/seats', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json({ data: await inventory.seatMap(id) });
  });

  // ---- bookings -------------------------------------------------------------
  router.post('/api/v1/bookings', requireUser, async (req, res) => {
    const body = parse(CreateBookingBody, req.body);
    const idempotencyKey = parse(IdempotencyKey, req.header('idempotency-key'));
    const { booking, created } = await bookings.create({
      userId: currentUser(req).id,
      eventId: body.eventId,
      quantity: body.seatIds?.length ?? body.quantity ?? 1,
      seatIds: body.seatIds,
      idempotencyKey,
    });
    if (created) res.status(201).location(`/api/v1/bookings/${booking.id}`);
    else res.setHeader('Idempotent-Replayed', 'true');
    res.json({ data: booking });
  });

  router.get('/api/v1/bookings', requireUser, async (req, res) => {
    const q = parse(ListBookingsQuery, req.query);
    const result = await bookings.listForUser(currentUser(req).id, q);
    res.json({ data: result.items, nextCursor: result.nextCursor });
  });

  router.get('/api/v1/bookings/:id', requireUser, async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json({ data: await bookings.get(id, currentUser(req)) });
  });

  router.post('/api/v1/bookings/:id/cancel', requireUser, async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json({ data: await bookings.cancel(id, currentUser(req)) });
  });

  router.get('/api/v1/bookings/:id/calendar.ics', requireUser, async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const booking = await bookings.get(id, currentUser(req));
    res
      .type('text/calendar')
      .setHeader('Content-Disposition', `attachment; filename="evently-${booking.id}.ics"`)
      .send(bookingToIcs(booking));
  });

  // ---- waitlist -------------------------------------------------------------
  router.post('/api/v1/events/:id/waitlist', requireUser, async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const { quantity } = parse(WaitlistBody, req.body ?? {});
    res.status(201).json({ data: await waitlist.join(currentUser(req).id, id, quantity) });
  });

  router.delete('/api/v1/events/:id/waitlist', requireUser, async (req, res) => {
    const { id } = parse(IdParam, req.params);
    await waitlist.leave(currentUser(req).id, id);
    res.status(204).end();
  });

  router.get('/api/v1/waitlist', requireUser, async (req, res) => {
    res.json({ data: await waitlist.listForUser(currentUser(req).id) });
  });

  // ---- admin ----------------------------------------------------------------
  router.get('/api/v1/admin/events/:id/bookings', requireAdmin, async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const paging = parse(Paging, req.query);
    const result = await bookings.listForEvent(id, paging);
    res.json({ data: result.items, meta: { total: result.total, ...paging } });
  });

  router.get('/api/v1/admin/analytics/integrity', requireAdmin, async (_req, res) => {
    res.json({ data: await inventory.integrityReport() });
  });

  // ---- internal (catalog-service only; never routed by the gateway) ---------
  router.put('/internal/inventory/:id', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json({ data: await inventory.sync(id, parse(InventorySyncBody, req.body)) });
  });

  router.post('/internal/inventory/:id/cancel', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json({ data: await inventory.cancel(id) });
  });

  return router;
}
