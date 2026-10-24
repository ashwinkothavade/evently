import { currentUser, requireAdmin } from '@evently/shared/http';
import { badRequest } from '@evently/shared/errors';
import { IdParam, isoDateTime, parse } from '@evently/shared/validate';
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { CatalogService } from './service.js';

const ListQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  venue: z.string().trim().min(1).max(100).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  available: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

const inFuture = (d: Date) => d.getTime() > Date.now();

const CreateEventBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).optional(),
    venue: z.string().trim().min(1).max(200),
    startsAt: isoDateTime.refine(inFuture, 'startsAt must be in the future'),
    endsAt: isoDateTime.optional(),
    capacity: z.number().int().positive().max(1_000_000).optional(),
    priceCents: z.number().int().min(0).max(100_000_000).default(0),
    maxPerBooking: z.number().int().min(1).max(100).default(10),
    status: z.enum(['draft', 'published']).default('published'),
    seating: z
      .object({
        rows: z.number().int().min(1).max(26),
        seatsPerRow: z.number().int().min(1).max(100),
      })
      .optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.seating && body.capacity === undefined) {
      ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'Provide capacity (general admission) or seating' });
    }
    if (body.seating && body.capacity !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'Seated events derive capacity from seating; omit capacity' });
    }
    if (body.endsAt && body.endsAt <= body.startsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'endsAt must be after startsAt' });
    }
  });

const UpdateEventBody = z
  .object({
    version: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    venue: z.string().trim().min(1).max(200).optional(),
    startsAt: isoDateTime.refine(inFuture, 'startsAt must be in the future').optional(),
    endsAt: isoDateTime.nullable().optional(),
    capacity: z.number().int().positive().max(1_000_000).optional(),
    priceCents: z.number().int().min(0).max(100_000_000).optional(),
    maxPerBooking: z.number().int().min(1).max(100).optional(),
    status: z.enum(['draft', 'published']).optional(),
  })
  .refine((body) => Object.keys(body).some((k) => k !== 'version'), 'Provide at least one field to update');

const AdminListQuery = z.object({
  status: z.enum(['draft', 'published', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const CancelBody = z.object({ reason: z.string().trim().max(500).optional() }).default({});

/** Expected version from `If-Match: "3"` (preferred) or the body's `version` field. */
function expectedVersion(req: Request, bodyVersion?: number): number {
  const header = req.header('if-match')?.replace(/^W\//, '').replace(/"/g, '');
  const version = header ? Number(header) : bodyVersion;
  if (!version || !Number.isInteger(version)) {
    throw badRequest('VERSION_REQUIRED', 'Send the event version you are editing via If-Match header or body.version');
  }
  return version;
}

const requestId = (req: Request) => String(req.id);

export function catalogRoutes(catalog: CatalogService) {
  const router = Router();

  // ---- public -------------------------------------------------------------
  router.get('/api/v1/events', async (req, res) => {
    const result = await catalog.listUpcoming(parse(ListQuery, req.query));
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json({ data: result.items, nextCursor: result.nextCursor });
  });

  router.get('/api/v1/events/:id', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json({ data: await catalog.getPublic(id) });
  });

  // ---- admin --------------------------------------------------------------
  router.use('/api/v1/admin/events', requireAdmin);

  router.get('/api/v1/admin/events', async (req, res) => {
    const q = parse(AdminListQuery, req.query);
    const result = await catalog.listAll(q);
    res.json({ data: result.items, meta: { total: result.total, limit: q.limit, offset: q.offset } });
  });

  router.post('/api/v1/admin/events', async (req, res) => {
    const event = await catalog.create(parse(CreateEventBody, req.body), currentUser(req).id, requestId(req));
    res.status(201).location(`/api/v1/events/${event.id}`).setHeader('ETag', `"${event.version}"`).json({ data: event });
  });

  router.get('/api/v1/admin/events/:id', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const event = await catalog.getForAdmin(id);
    res.setHeader('ETag', `"${event.version}"`).json({ data: event });
  });

  router.patch('/api/v1/admin/events/:id', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const { version, ...patch } = parse(UpdateEventBody, req.body);
    const event = await catalog.update(id, patch, expectedVersion(req, version), requestId(req));
    res.setHeader('ETag', `"${event.version}"`).json({ data: event });
  });

  router.post('/api/v1/admin/events/:id/cancel', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const { reason } = parse(CancelBody, req.body ?? {});
    res.json({ data: await catalog.cancel(id, reason, requestId(req)) });
  });

  return router;
}
