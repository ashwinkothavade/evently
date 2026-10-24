/**
 * Integration tests for the consistency-critical paths, run against real
 * Postgres + Redis in an isolated schema. Requires `npm run infra:up`.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '@evently/shared/db';
import { createRedis } from '@evently/shared/redis';
import { createBookingApp } from '../src/app.js';

for (const file of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // optional
  }
}

const TOKEN = 'test-internal-token-0123456789';
const SCHEMA = 'booking_test';
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

const db = createDatabase({
  url: process.env.DATABASE_URL ?? 'postgres://evently:evently@localhost:5432/evently',
  schema: SCHEMA,
  ssl: false,
  poolMax: 20,
});
const redis = createRedis(process.env.REDIS_URL ?? 'redis://localhost:6379', 'booking-test');
let baseUrl = '';
let close: () => void = () => undefined;

type Json = { data?: any; error?: { code: string } };

async function call(method: string, url: string, body?: unknown, user?: { id: string; role?: string }, headers: Record<string, string> = {}) {
  const res = await fetch(baseUrl + url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-internal-token': TOKEN,
      ...(user && { 'x-user-id': user.id, 'x-user-role': user.role ?? 'user', 'x-user-email': `${user.id}@test.dev` }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (res.status === 204 ? {} : await res.json()) as Json;
  return { status: res.status, ...json };
}

const newUser = () => ({ id: randomUUID() });

async function createEvent(opts: { capacity?: number; seating?: { rows: number; seatsPerRow: number }; maxPerBooking?: number } = {}) {
  const id = randomUUID();
  const capacity = opts.seating ? opts.seating.rows * opts.seating.seatsPerRow : (opts.capacity ?? 10);
  const res = await call('PUT', `/internal/inventory/${id}`, {
    name: 'Test event',
    venue: 'Test venue',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: null,
    capacity,
    priceCents: 1000,
    maxPerBooking: opts.maxPerBooking ?? 10,
    status: 'published',
    seating: opts.seating ?? null,
    catalogVersion: 1,
  });
  assert.equal(res.status, 200);
  return id;
}

async function bookedCount(eventId: string) {
  const { rows } = await db.pool.query<{ booked_count: number }>('SELECT booked_count FROM inventory WHERE event_id = $1', [eventId]);
  return rows[0]!.booked_count;
}

before(async () => {
  await db.pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.migrate(migrationsDir);
  const app = createBookingApp({ db, redis, internalToken: TOKEN, soldOutTtlSeconds: 0, cachePrefix: 'booking_test', onPublished: () => undefined });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(async () => {
  close();
  await db.close();
  redis.disconnect();
});

describe('overselling protection', () => {
  test('200 concurrent single-ticket requests for 50 seats → exactly 50 succeed', async () => {
    const eventId = await createEvent({ capacity: 50 });
    const results = await Promise.all(
      Array.from({ length: 200 }, () => call('POST', '/api/v1/bookings', { eventId, quantity: 1 }, newUser())),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 409);
    assert.equal(ok, 50);
    assert.equal(rejected.length, 150);
    assert.ok(rejected.every((r) => r.error?.code === 'SOLD_OUT' || r.error?.code === 'INSUFFICIENT_CAPACITY'));
    assert.equal(await bookedCount(eventId), 50);
  });

  test('concurrent mixed-quantity requests never exceed capacity', async () => {
    const eventId = await createEvent({ capacity: 37 });
    const quantities = Array.from({ length: 120 }, (_, i) => (i % 4) + 1);
    const results = await Promise.all(
      quantities.map((quantity) => call('POST', '/api/v1/bookings', { eventId, quantity }, newUser())),
    );
    const sold = results
      .map((r, i) => (r.status === 201 ? quantities[i]! : 0))
      .reduce((a, b) => a + b, 0);
    assert.ok(sold <= 37, `sold ${sold} > capacity`);
    assert.equal(await bookedCount(eventId), sold);
  });

  test('integrity audit reports no drift after the stampedes', async () => {
    const res = await call('GET', '/api/v1/admin/analytics/integrity', undefined, { id: randomUUID(), role: 'admin' });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true, JSON.stringify(res.data.mismatches));
  });
});

describe('seat-level booking', () => {
  test('50 users racing for the same seat → exactly one wins', async () => {
    const eventId = await createEvent({ seating: { rows: 2, seatsPerRow: 5 } });
    const map = await call('GET', `/api/v1/events/${eventId}/seats`);
    const seatId = map.data.rows[0].seats[2].id;
    const results = await Promise.all(
      Array.from({ length: 50 }, () => call('POST', '/api/v1/bookings', { eventId, seatIds: [seatId] }, newUser())),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.error?.code === 'SEAT_UNAVAILABLE'));
  });

  test('auto-assignment keeps a party together in one row', async () => {
    const eventId = await createEvent({ seating: { rows: 3, seatsPerRow: 4 } });
    await call('POST', '/api/v1/bookings', { eventId, quantity: 2 }, newUser()); // takes A1, A2
    const res = await call('POST', '/api/v1/bookings', { eventId, quantity: 3 }, newUser());
    assert.equal(res.status, 201);
    const rows = new Set(res.data.seats.map((s: { row: string }) => s.row));
    assert.deepEqual([...rows], ['B']);
  });
});

describe('idempotency', () => {
  test('20 concurrent retries with one Idempotency-Key create a single booking', async () => {
    const eventId = await createEvent({ capacity: 100 });
    const user = newUser();
    const key = `retry-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => call('POST', '/api/v1/bookings', { eventId, quantity: 2 }, user, { 'Idempotency-Key': key })),
    );
    assert.ok(results.every((r) => r.status === 201 || r.status === 200));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(new Set(results.map((r) => r.data.id)).size, 1);
    assert.equal(await bookedCount(eventId), 2);
  });
});

describe('cancellation and waitlist', () => {
  test('cancelling hands tickets to the waitlist in FIFO first-fit order', async () => {
    const eventId = await createEvent({ capacity: 3 });
    const holder = newUser();
    const booking = await call('POST', '/api/v1/bookings', { eventId, quantity: 3 }, holder);
    assert.equal(booking.status, 201);

    const big = newUser(); // first in line, wants 3
    const first = newUser();
    const second = newUser();
    const third = newUser();
    assert.equal((await call('POST', `/api/v1/events/${eventId}/waitlist`, { quantity: 3 }, big)).status, 201);
    assert.equal((await call('POST', `/api/v1/events/${eventId}/waitlist`, { quantity: 2 }, first)).status, 201);
    assert.equal((await call('POST', `/api/v1/events/${eventId}/waitlist`, { quantity: 1 }, second)).status, 201);
    assert.equal((await call('POST', `/api/v1/events/${eventId}/waitlist`, { quantity: 1 }, third)).status, 201);

    // Free 3 tickets: "big" (3) is first in line and fits exactly.
    const cancelled = await call('POST', `/api/v1/bookings/${booking.data.id}/cancel`, undefined, holder);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.waitlistPromoted, 1);

    const mine = await call('GET', '/api/v1/bookings', undefined, big);
    assert.equal(mine.data[0].source, 'waitlist');
    assert.equal(await bookedCount(eventId), 3);

    // big cancels 3 → first (2) + second (1) are promoted; third keeps waiting at position 1.
    await call('POST', `/api/v1/bookings/${mine.data[0].id}/cancel`, undefined, big);
    const waitlist = await call('GET', '/api/v1/waitlist', undefined, third);
    assert.equal(waitlist.data[0].status, 'waiting');
    assert.equal(waitlist.data[0].position, 1);
    assert.equal(await bookedCount(eventId), 3);
  });

  test('joining the waitlist is rejected while tickets are available', async () => {
    const eventId = await createEvent({ capacity: 5 });
    const res = await call('POST', `/api/v1/events/${eventId}/waitlist`, { quantity: 1 }, newUser());
    assert.equal(res.status, 409);
    assert.equal(res.error?.code, 'TICKETS_AVAILABLE');
  });

  test('double cancellation is rejected and other users cannot cancel', async () => {
    const eventId = await createEvent({ capacity: 5 });
    const owner = newUser();
    const { data } = await call('POST', '/api/v1/bookings', { eventId, quantity: 1 }, owner);
    assert.equal((await call('POST', `/api/v1/bookings/${data.id}/cancel`, undefined, newUser())).status, 404);
    assert.equal((await call('POST', `/api/v1/bookings/${data.id}/cancel`, undefined, owner)).status, 200);
    const again = await call('POST', `/api/v1/bookings/${data.id}/cancel`, undefined, owner);
    assert.equal(again.status, 409);
    assert.equal(again.error?.code, 'ALREADY_CANCELLED');
  });
});

describe('inventory sync from catalog', () => {
  test('capacity cannot drop below tickets already sold', async () => {
    const eventId = await createEvent({ capacity: 10 });
    await call('POST', '/api/v1/bookings', { eventId, quantity: 6 }, newUser());
    const res = await call('PUT', `/internal/inventory/${eventId}`, {
      name: 'Test event', venue: 'Test venue', startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: null, capacity: 5, priceCents: 1000, maxPerBooking: 10, status: 'published', seating: null, catalogVersion: 2,
    });
    assert.equal(res.status, 409);
    assert.equal(res.error?.code, 'CAPACITY_BELOW_BOOKED');
  });

  test('requests without the internal token are rejected', async () => {
    const res = await fetch(`${baseUrl}/api/v1/bookings`);
    assert.equal(res.status, 401);
  });
});
