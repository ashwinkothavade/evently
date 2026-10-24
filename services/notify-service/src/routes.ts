import { currentUser, requireAdmin, requireUser } from '@evently/shared/http';
import { IdParam, parse } from '@evently/shared/validate';
import { Router } from 'express';
import { z } from 'zod';
import type { createAnalyticsService } from './analytics.js';
import type { createNotificationService } from './notifications.js';

const NotificationsQuery = z.object({
  unread: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const isoDate = z.iso.date({ message: 'Expected a date like 2026-01-31' });
const DAY_MS = 86_400_000;

const DateRange = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .transform(({ from, to }) => {
    const end = to ?? new Date().toISOString().slice(0, 10);
    const start = from ?? new Date(Date.parse(end) - 29 * DAY_MS).toISOString().slice(0, 10);
    return { from: start, to: end };
  })
  .superRefine((range, ctx) => {
    const days = (Date.parse(range.to) - Date.parse(range.from)) / DAY_MS;
    if (days < 0) ctx.addIssue({ code: 'custom', message: '`from` must not be after `to`' });
    if (days > 366) ctx.addIssue({ code: 'custom', message: 'Range must not exceed 366 days' });
  });

const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) });

const UtilizationQuery = z.object({
  upcoming: z.stringbool().default(true),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function notifyRoutes(deps: {
  notifications: ReturnType<typeof createNotificationService>;
  analytics: ReturnType<typeof createAnalyticsService>;
}) {
  const { notifications, analytics } = deps;
  const router = Router();

  // ---- notifications -------------------------------------------------------
  router.use('/api/v1/notifications', requireUser);

  router.get('/api/v1/notifications', async (req, res) => {
    const q = parse(NotificationsQuery, req.query);
    const result = await notifications.list(currentUser(req).id, { unreadOnly: q.unread, limit: q.limit });
    res.json({ data: result.items, meta: { unreadCount: result.unreadCount } });
  });

  router.post('/api/v1/notifications/read-all', async (req, res) => {
    res.json({ data: { updated: await notifications.markAllRead(currentUser(req).id) } });
  });

  router.post('/api/v1/notifications/:id/read', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    res.json({ data: await notifications.markRead(currentUser(req).id, id) });
  });

  // ---- analytics (admin) ---------------------------------------------------
  router.use('/api/v1/admin/analytics', requireAdmin);

  router.get('/api/v1/admin/analytics/overview', async (_req, res) => {
    res.json({ data: await analytics.overview() });
  });

  router.get('/api/v1/admin/analytics/popular-events', async (req, res) => {
    const { limit } = parse(LimitQuery, req.query);
    res.json({ data: await analytics.popularEvents(limit) });
  });

  router.get('/api/v1/admin/analytics/capacity-utilization', async (req, res) => {
    const q = parse(UtilizationQuery, req.query);
    res.json({ data: await analytics.capacityUtilization({ upcomingOnly: q.upcoming, limit: q.limit }) });
  });

  router.get('/api/v1/admin/analytics/daily', async (req, res) => {
    const range = parse(DateRange, req.query);
    res.json({ data: await analytics.daily(range), meta: range });
  });

  router.get('/api/v1/admin/analytics/events/:id', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const range = parse(DateRange, req.query);
    res.json({ data: await analytics.eventDetail(id, range) });
  });

  return router;
}
