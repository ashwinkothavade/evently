/**
 * Seeds demo data through the public API (so every service and read model is
 * populated exactly as in real use). Safe to re-run: existing events are kept.
 *
 *   npm run seed                         # against http://localhost:8080
 *   API_URL=https://… npm run seed       # against a deployment
 */
import { adminToken, api, BASE_URL, daysFromNow, must, userToken } from './lib.js';

const EVENTS = [
  { name: 'Midnight Jazz at the Blue Room', venue: 'Blue Room, New Orleans', startsAt: daysFromNow(3, 23), endsAt: daysFromNow(4, 2), capacity: 80, priceCents: 3500,
    description: 'An intimate late-night set with the Marcus Hale Quartet. Standing room and bar seating.' },
  { name: 'Hamilton – Evening Performance', venue: 'Grand Theatre, Chicago', startsAt: daysFromNow(10), endsAt: daysFromNow(10, 22), seating: { rows: 8, seatsPerRow: 14 }, priceCents: 12900, maxPerBooking: 6,
    description: 'The award-winning musical. Reserved seating – pick your seats on the seat map.' },
  { name: 'Indie Rock Festival 2026', venue: 'Riverside Park, Austin', startsAt: daysFromNow(21, 14), endsAt: daysFromNow(21, 23), capacity: 2000, priceCents: 8900,
    description: 'Twelve bands, two stages, one unforgettable day. Food trucks and craft beer on site.' },
  { name: 'Startup Founders Meetup', venue: 'WeWork Downtown, San Francisco', startsAt: daysFromNow(5, 18), endsAt: daysFromNow(5, 21), capacity: 120, priceCents: 0, maxPerBooking: 2,
    description: 'Lightning talks, pitch practice and networking. Free entry – registration required.' },
  { name: 'Stand-up Comedy Night', venue: 'The Laugh Factory, Los Angeles', startsAt: daysFromNow(7, 20), endsAt: daysFromNow(7, 22), seating: { rows: 5, seatsPerRow: 10 }, priceCents: 2500,
    description: 'Five comedians, one mic. Front rows may be part of the show.' },
  { name: 'Chef’s Table: Seasonal Tasting', venue: 'Maison Lumière, New York', startsAt: daysFromNow(14, 19), capacity: 12, priceCents: 18000, maxPerBooking: 4,
    description: 'A seven-course seasonal tasting menu with wine pairing. Very limited seats.' },
  { name: 'Kubernetes Deep-Dive Workshop', venue: 'Online · Zoom', startsAt: daysFromNow(9, 16), endsAt: daysFromNow(9, 20), capacity: 300, priceCents: 4900,
    description: 'Hands-on workshop: operators, autoscaling and production-grade observability.' },
  { name: 'Sunrise Yoga on the Beach', venue: 'Santa Monica Pier', startsAt: daysFromNow(2, 6), endsAt: daysFromNow(2, 7), capacity: 4, priceCents: 1500, maxPerBooking: 2,
    description: 'Start your day with a guided flow by the ocean. Mats provided.' },
];

const USERS = [
  ['alice@evently.dev', 'Alice Johnson'],
  ['bob@evently.dev', 'Bob Smith'],
  ['carol@evently.dev', 'Carol Diaz'],
  ['dan@evently.dev', 'Dan Okafor'],
  ['erin@evently.dev', 'Erin Walsh'],
  ['frank@evently.dev', 'Frank Li'],
] as const;

async function main() {
  console.log(`Seeding ${BASE_URL} …`);
  const admin = await adminToken();

  const existing = await must<{ name: string; id: string }[]>('list events', api('GET', '/admin/events?limit=100', { token: admin }));
  const byName = new Map(existing.map((e) => [e.name, e.id]));
  const ids: Record<string, string> = {};
  let created = 0;
  for (const e of EVENTS) {
    if (byName.has(e.name)) {
      ids[e.name] = byName.get(e.name)!;
      continue;
    }
    const event = await must<{ id: string }>(`create ${e.name}`, api('POST', '/admin/events', { token: admin, body: e }));
    ids[e.name] = event.id;
    created++;
    console.log(`  + event  ${e.name}`);
  }
  if (created < EVENTS.length) {
    console.log('Demo events were already present – skipping bookings to keep the data stable.');
    return;
  }

  const tokens: string[] = [];
  for (const [email, name] of USERS) tokens.push(await userToken(email, name));
  console.log(`  + ${tokens.length} users (password: password123)`);

  const book = (t: number, event: string, quantity: number) =>
    api('POST', '/bookings', { token: tokens[t], body: { eventId: ids[event], quantity }, headers: { 'Idempotency-Key': crypto.randomUUID() } });

  // A spread of bookings so lists and analytics have something to show.
  const plan: [number, string, number][] = [
    [0, 'Midnight Jazz at the Blue Room', 2], [1, 'Midnight Jazz at the Blue Room', 4], [2, 'Midnight Jazz at the Blue Room', 2],
    [0, 'Hamilton – Evening Performance', 2], [3, 'Hamilton – Evening Performance', 4], [4, 'Hamilton – Evening Performance', 3],
    [1, 'Indie Rock Festival 2026', 6], [2, 'Indie Rock Festival 2026', 4], [5, 'Indie Rock Festival 2026', 2],
    [3, 'Startup Founders Meetup', 1], [4, 'Startup Founders Meetup', 2], [5, 'Startup Founders Meetup', 1],
    [0, 'Stand-up Comedy Night', 2], [2, 'Stand-up Comedy Night', 2],
    [1, 'Chef’s Table: Seasonal Tasting', 4], [3, 'Chef’s Table: Seasonal Tasting', 4], [4, 'Chef’s Table: Seasonal Tasting', 2],
    [2, 'Kubernetes Deep-Dive Workshop', 1], [5, 'Kubernetes Deep-Dive Workshop', 1],
    [0, 'Sunrise Yoga on the Beach', 2], [1, 'Sunrise Yoga on the Beach', 2],
  ];
  const bookingIds: string[] = [];
  for (const [t, event, qty] of plan) {
    const r = await book(t, event, qty);
    if (r.status === 201) bookingIds.push(r.body.data.id);
  }
  console.log(`  + ${bookingIds.length} bookings`);

  // Sunrise Yoga is now sold out → two users join the waitlist.
  await api('POST', `/events/${ids['Sunrise Yoga on the Beach']}/waitlist`, { token: tokens[3], body: { quantity: 1 } });
  await api('POST', `/events/${ids['Sunrise Yoga on the Beach']}/waitlist`, { token: tokens[4], body: { quantity: 2 } });
  // One cancellation elsewhere for the cancellation-rate metric.
  await api('POST', `/bookings/${bookingIds[2]}/cancel`, { token: tokens[2] });
  console.log('  + waitlist entries and a cancellation');
  console.log('\nDone. Sign in as admin@evently.dev / admin12345 or alice@evently.dev / password123.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
