import type { ServiceName } from './config.js';

export type Access = 'public' | 'user' | 'admin';

export interface RouteRule {
  methods?: string[];
  pattern: RegExp;
  service: ServiceName;
  access: Access;
}

const ID = '[0-9a-fA-F-]{36}';

/**
 * Routing table: first match wins. Anything not listed (including every
 * /internal/* path) is rejected at the edge with 404.
 */
export const ROUTES: RouteRule[] = [
  // auth-service
  { methods: ['POST'], pattern: /^\/api\/v1\/auth\/(register|login)$/, service: 'auth', access: 'public' },
  { methods: ['GET'], pattern: /^\/api\/v1\/me$/, service: 'auth', access: 'user' },

  // booking-service paths nested under /events must precede the catalog catch-all
  { methods: ['GET'], pattern: new RegExp(`^/api/v1/events/${ID}/seats$`), service: 'booking', access: 'public' },
  { methods: ['POST', 'DELETE'], pattern: new RegExp(`^/api/v1/events/${ID}/waitlist$`), service: 'booking', access: 'user' },

  // catalog-service (public browsing)
  { methods: ['GET'], pattern: /^\/api\/v1\/events(\/[^/]+)?$/, service: 'catalog', access: 'public' },

  // booking-service
  { pattern: /^\/api\/v1\/bookings(\/.*)?$/, service: 'booking', access: 'user' },
  { methods: ['GET'], pattern: /^\/api\/v1\/waitlist$/, service: 'booking', access: 'user' },
  { methods: ['GET'], pattern: new RegExp(`^/api/v1/admin/events/${ID}/bookings$`), service: 'booking', access: 'admin' },
  { methods: ['GET'], pattern: /^\/api\/v1\/admin\/analytics\/integrity$/, service: 'booking', access: 'admin' },

  // notify-service
  { pattern: /^\/api\/v1\/notifications(\/.*)?$/, service: 'notify', access: 'user' },
  { methods: ['GET'], pattern: /^\/api\/v1\/admin\/analytics(\/.*)?$/, service: 'notify', access: 'admin' },

  // catalog-service (admin)
  { pattern: /^\/api\/v1\/admin\/events(\/.*)?$/, service: 'catalog', access: 'admin' },
];

export function matchRoute(method: string, path: string): RouteRule | undefined {
  return ROUTES.find((r) => r.pattern.test(path) && (!r.methods || r.methods.includes(method)));
}
