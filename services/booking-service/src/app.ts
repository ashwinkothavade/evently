import { Cache } from '@evently/shared/cache';
import type { Database } from '@evently/shared/db';
import { createServiceApp } from '@evently/shared/http';
import type { Redis } from '@evently/shared/redis';
import { createBookingService } from './bookings.js';
import { createInventoryService } from './inventory.js';
import { bookingRoutes } from './routes.js';
import { createWaitlistService } from './waitlist.js';

/** Builds the booking-service HTTP app (used by index.ts and the integration tests). */
export function createBookingApp(deps: {
  db: Database;
  redis: Redis;
  internalToken: string;
  soldOutTtlSeconds: number;
  cachePrefix?: string;
  onPublished: () => void;
}) {
  const { db, onPublished } = deps;
  const inventory = createInventoryService(db, onPublished);
  const waitlist = createWaitlistService(db, onPublished);
  const bookings = createBookingService({
    db,
    cache: new Cache(deps.redis, deps.cachePrefix ?? 'booking'),
    soldOutTtlSeconds: deps.soldOutTtlSeconds,
    onPublished,
  });
  return createServiceApp({
    name: 'booking-service',
    internalToken: deps.internalToken,
    routers: [bookingRoutes({ bookings, waitlist, inventory })],
    ready: db.ping,
  });
}
