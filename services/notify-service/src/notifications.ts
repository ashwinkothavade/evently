import type { Database, Queryable } from '@evently/shared/db';
import { notFound } from '@evently/shared/errors';
import { logger } from '@evently/shared/logger';

export type NotificationType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'WAITLIST_PROMOTED'
  | 'EVENT_CANCELLED'
  | 'EVENT_UPDATED';

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
}

const toDto = (row: NotificationRow) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  data: row.data,
  read: row.read_at !== null,
  createdAt: row.created_at,
});

export async function insertNotifications(db: Queryable, items: NewNotification[]): Promise<void> {
  if (items.length === 0) return;
  await db.query(
    `INSERT INTO notifications (user_id, type, title, body, data)
     SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::jsonb[])`,
    [
      items.map((n) => n.userId),
      items.map((n) => n.type),
      items.map((n) => n.title),
      items.map((n) => n.body),
      items.map((n) => JSON.stringify(n.data ?? {})),
    ],
  );
}

/** Where notifications are delivered. Swap in email/SMS/push without touching the rest. */
export interface NotificationChannel {
  send(notification: { email: string; title: string; body: string; type: string }): Promise<void>;
}

export const logChannel: NotificationChannel = {
  async send(n) {
    logger.info({ to: n.email, type: n.type, title: n.title }, 'Notification delivered (email stub)');
  },
};

const MAX_ATTEMPTS = 5;

export function createNotificationService(db: Database) {
  async function list(userId: string, opts: { unreadOnly: boolean; limit: number }) {
    const [{ rows }, { rows: counts }] = await Promise.all([
      db.pool.query<NotificationRow>(
        `SELECT * FROM notifications
          WHERE user_id = $1 AND ($2::boolean IS FALSE OR read_at IS NULL)
          ORDER BY created_at DESC LIMIT $3`,
        [userId, opts.unreadOnly, opts.limit],
      ),
      db.pool.query<{ unread: number }>(
        'SELECT count(*) AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL',
        [userId],
      ),
    ]);
    return { items: rows.map(toDto), unreadCount: counts[0]?.unread ?? 0 };
  }

  async function markRead(userId: string, id: string) {
    const { rows } = await db.pool.query<NotificationRow>(
      `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId],
    );
    if (!rows[0]) throw notFound('Notification');
    return toDto(rows[0]);
  }

  async function markAllRead(userId: string): Promise<number> {
    const { rowCount } = await db.pool.query(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    return rowCount ?? 0;
  }

  /**
   * Delivers one batch of pending notifications. FOR UPDATE SKIP LOCKED lets
   * several replicas run the dispatcher without double-sending.
   */
  async function dispatchPending(channel: NotificationChannel = logChannel, batchSize = 50): Promise<number> {
    return db.withTransaction(async (tx) => {
      const { rows } = await tx.query<NotificationRow & { email: string }>(
        `SELECT n.*, u.email FROM notifications n JOIN users u ON u.id = n.user_id
          WHERE n.delivered_at IS NULL AND n.attempts < $1
          ORDER BY n.created_at
          LIMIT $2
          FOR UPDATE OF n SKIP LOCKED`,
        [MAX_ATTEMPTS, batchSize],
      );
      for (const row of rows) {
        try {
          await channel.send({ email: row.email, title: row.title, body: row.body, type: row.type });
          await tx.query('UPDATE notifications SET delivered_at = now(), attempts = attempts + 1 WHERE id = $1', [row.id]);
        } catch (err) {
          logger.warn({ err, notificationId: row.id }, 'Notification delivery failed; will retry');
          await tx.query('UPDATE notifications SET attempts = attempts + 1 WHERE id = $1', [row.id]);
        }
      }
      return rows.length;
    });
  }

  function startDispatcher(intervalMs: number): () => Promise<void> {
    if (intervalMs === 0) return async () => undefined;
    let running: Promise<unknown> | null = null;
    const timer = setInterval(() => {
      if (running) return;
      running = dispatchPending()
        .catch((err) => logger.error({ err }, 'Notification dispatcher failed'))
        .finally(() => (running = null));
    }, intervalMs);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await running;
    };
  }

  return { list, markRead, markAllRead, dispatchPending, startDispatcher };
}
