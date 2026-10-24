/**
 * Load test: N users try to book the same event at the same instant.
 * Verifies that exactly `capacity` tickets are sold and that the database's
 * counters agree (integrity audit), and reports latency percentiles.
 *
 *   npm run loadtest -- --users 500 --capacity 100
 *   API_URL=https://… npm run loadtest -- --users 300 --capacity 50
 *
 * Note: the gateway's per-IP rate limit (RATE_LIMIT_PER_MINUTE) applies, since
 * every request comes from this machine. For large local runs, start the
 * gateway with RATE_LIMIT_ENABLED=false.
 */
import { parseArgs } from 'node:util';
import { adminToken, api, BASE_URL, daysFromNow, must } from './lib.js';

const { values } = parseArgs({
  options: {
    users: { type: 'string', default: '300' },
    capacity: { type: 'string', default: '100' },
    quantity: { type: 'string', default: '1' },
  },
});
const USERS = Number(values.users);
const CAPACITY = Number(values.capacity);
const QUANTITY = Number(values.quantity);

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

async function inBatches<T>(count: number, size: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < count; i += size) {
    out.push(...(await Promise.all(Array.from({ length: Math.min(size, count - i) }, (_, j) => fn(i + j)))));
  }
  return out;
}

async function main() {
  console.log(`Target ${BASE_URL} · ${USERS} users · capacity ${CAPACITY} · ${QUANTITY} ticket(s) each\n`);
  const admin = await adminToken();
  const event = await must<{ id: string }>('create event', api('POST', '/admin/events', {
    token: admin,
    body: { name: `Load test ${new Date().toISOString()}`, venue: 'Load Arena', startsAt: daysFromNow(30), capacity: CAPACITY, maxPerBooking: Math.max(QUANTITY, 1), priceCents: 1000 },
  }));

  process.stdout.write('Registering users… ');
  const run = Date.now();
  const tokens = await inBatches(USERS, 25, async (i) =>
    (await must<{ token: string }>('register', api('POST', '/auth/register', {
      body: { email: `load-${run}-${i}@evently.dev`, name: `Load ${i}`, password: 'password123' },
    }))).token,
  );
  console.log('done.');

  console.log(`Firing ${USERS} booking requests simultaneously…`);
  const started = performance.now();
  const results = await Promise.all(
    tokens.map((token) => api('POST', '/bookings', { token, body: { eventId: event.id, quantity: QUANTITY }, headers: { 'Idempotency-Key': crypto.randomUUID() } })),
  );
  const wall = performance.now() - started;

  const byStatus = new Map<string, number>();
  for (const r of results) {
    const key = r.status === 201 ? '201 created' : `${r.status} ${r.body.error?.code ?? ''}`.trim();
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
  }
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const sold = results.filter((r) => r.status === 201).length * QUANTITY;

  console.log('\nResponses:');
  for (const [k, v] of [...byStatus].sort()) console.log(`  ${k.padEnd(32)} ${v}`);
  console.log('\nLatency (ms):');
  console.log(`  p50 ${percentile(latencies, 50).toFixed(0)}   p95 ${percentile(latencies, 95).toFixed(0)}   p99 ${percentile(latencies, 99).toFixed(0)}   max ${latencies.at(-1)!.toFixed(0)}`);
  console.log(`  throughput ≈ ${(USERS / (wall / 1000)).toFixed(0)} req/s (wall ${wall.toFixed(0)} ms)`);

  const integrity = await must<{ ok: boolean; mismatches: unknown[] }>('integrity', api('GET', '/admin/analytics/integrity', { token: admin }));
  // Best possible outcome: every request succeeds until the event can't fit another one.
  const expected = Math.min(Math.floor(CAPACITY / QUANTITY), USERS) * QUANTITY;
  const oversold = sold > CAPACITY;
  console.log('\nVerdict:');
  console.log(`  tickets sold ${sold} / capacity ${CAPACITY} → ${oversold ? '❌ OVERSOLD' : '✅ no overselling'}`);
  console.log(`  ${sold === expected ? '✅' : '⚠️ '} sold ${sold} of the ${expected} that could fit${sold < expected ? ' (requests rejected for other reasons, see above)' : ''}`);
  console.log(`  integrity audit: ${integrity.ok ? '✅ counters match bookings' : `❌ ${JSON.stringify(integrity.mismatches)}`}`);
  if (oversold || !integrity.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
