import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { register, startTestServer } from './helpers.js';

let api;
let admin;
let organiser;
let alice;
let bob;
let show;

const setUpAdmin = async () => {
  // Admin accounts are never self-serve, so one is inserted directly.
  const { db } = await import('../src/db/index.js');
  const { hashPassword } = await import('../src/lib/passwords.js');
  db.prepare('INSERT INTO users (email, name, password, role) VALUES (?, ?, ?, ?)')
    .run('root@seatwise.test', 'Root', hashPassword('Password123'), 'admin');

  const { body } = await api.post('/api/auth/login', { email: 'root@seatwise.test', password: 'Password123' });
  return body.token;
};

before(async () => {
  api = await startTestServer();
  admin = await setUpAdmin();
  organiser = await register(api, 'org@seatwise.test', 'organiser');
  alice = await register(api, 'alice@seatwise.test');
  bob = await register(api, 'bob@seatwise.test');

  const venue = await api.post(
    '/api/venues',
    { name: 'Test Hall', city: 'Pune', categories: ['Premium', 'Standard'], rows: [
      { label: 'A', seats: 3, category: 'Premium' },
      { label: 'B', seats: 4, category: 'Standard' },
    ] },
    { token: admin }
  );
  assert.equal(venue.status, 201);
  assert.equal(venue.body.venue.seatCount, 7);

  const event = await api.post('/api/events', { title: 'Test Feature', kind: 'movie' }, { token: organiser });
  assert.equal(event.status, 201);

  const created = await api.post(
    '/api/shows',
    {
      eventId: event.body.event.id,
      venueId: venue.body.venue.id,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      prices: { Premium: 400, Standard: 250 },
    },
    { token: organiser }
  );
  assert.equal(created.status, 201);
  show = created.body.show;
});

after(async () => api.close());

describe('seat map', () => {
  it('lists every seat as available with its category price', async () => {
    const { body } = await api.get(`/api/shows/${show.id}/seats`);
    assert.equal(body.seats.length, 7);
    assert.ok(body.seats.every((s) => s.status === 'available'));

    const premium = body.seats.find((s) => s.category === 'Premium');
    assert.equal(premium.price, 400);
    assert.equal(premium.label, 'A1');
  });

  it('reports availability per category', async () => {
    const { body } = await api.get(`/api/shows/${show.id}/seats`);
    const premium = body.categories.find((c) => c.category === 'Premium');
    assert.equal(premium.total, 3);
    assert.equal(premium.available, 3);
  });
});

describe('holding seats', () => {
  it('holds the requested seats and hides the expiry from other viewers', async () => {
    const { body: map } = await api.get(`/api/shows/${show.id}/seats`);
    const seatIds = map.seats.slice(0, 2).map((s) => s.id);

    const held = await api.post(`/api/shows/${show.id}/hold`, { seatIds }, { token: alice });
    assert.equal(held.status, 200);
    assert.deepEqual(held.body.hold.seatIds.sort(), seatIds.sort());
    assert.equal(held.body.hold.total, 800);

    const mine = await api.get(`/api/shows/${show.id}/seats`, { token: alice });
    const seat = mine.body.seats.find((s) => s.id === seatIds[0]);
    assert.equal(seat.status, 'held');
    assert.equal(seat.heldByMe, true);
    assert.ok(seat.holdExpiresAt > Date.now());

    const theirs = await api.get(`/api/shows/${show.id}/seats`, { token: bob });
    const same = theirs.body.seats.find((s) => s.id === seatIds[0]);
    assert.equal(same.status, 'held');
    assert.equal(same.heldByMe, false);
    assert.equal(same.holdExpiresAt, null);
  });

  it('lets the same customer re-send a hold without failing', async () => {
    const { body: map } = await api.get(`/api/shows/${show.id}/seats`, { token: alice });
    const seatIds = map.seats.filter((s) => s.heldByMe).map((s) => s.id);

    const again = await api.post(`/api/shows/${show.id}/hold`, { seatIds }, { token: alice });
    assert.equal(again.status, 200);
  });

  it('refuses a seat another customer already holds', async () => {
    const { body: map } = await api.get(`/api/shows/${show.id}/seats`, { token: alice });
    const taken = map.seats.find((s) => s.heldByMe).id;

    const attempt = await api.post(`/api/shows/${show.id}/hold`, { seatIds: [taken] }, { token: bob });
    assert.equal(attempt.status, 409);
    assert.equal(attempt.body.error, 'seat_held');
  });

  it('holds nothing at all when one seat in the selection is taken', async () => {
    const { body: map } = await api.get(`/api/shows/${show.id}/seats`, { token: alice });
    const taken = map.seats.find((s) => s.heldByMe).id;
    const free = map.seats.find((s) => s.status === 'available').id;

    const attempt = await api.post(`/api/shows/${show.id}/hold`, { seatIds: [free, taken] }, { token: bob });
    assert.equal(attempt.status, 409);

    // The free seat must not have been left half-held by the failed request.
    const after = await api.get(`/api/shows/${show.id}/seats`);
    assert.equal(after.body.seats.find((s) => s.id === free).status, 'available');
  });

  it('gives exactly one winner when two customers race for the same seat', async () => {
    const { body: map } = await api.get(`/api/shows/${show.id}/seats`);
    const contested = map.seats.filter((s) => s.status === 'available').at(-1).id;

    const results = await Promise.all([
      api.post(`/api/shows/${show.id}/hold`, { seatIds: [contested] }, { token: alice }),
      api.post(`/api/shows/${show.id}/hold`, { seatIds: [contested] }, { token: bob }),
    ]);

    const won = results.filter((r) => r.status === 200);
    const lost = results.filter((r) => r.status === 409);
    assert.equal(won.length, 1, 'exactly one hold should succeed');
    assert.equal(lost.length, 1);
  });

  it('releases a hold on request', async () => {
    const { body: map } = await api.get(`/api/shows/${show.id}/seats`, { token: bob });
    const free = map.seats.find((s) => s.status === 'available');
    await api.post(`/api/shows/${show.id}/hold`, { seatIds: [free.id] }, { token: bob });

    const { body: held } = await api.get(`/api/shows/${show.id}/seats`, { token: bob });
    const mine = held.seats.filter((s) => s.heldByMe).map((s) => s.id);
    assert.ok(mine.includes(free.id));

    const released = await api.del(`/api/shows/${show.id}/hold`, {}, { token: bob });
    assert.equal(released.status, 200);
    assert.equal(released.body.released, mine.length);

    const after = await api.get(`/api/shows/${show.id}/seats`);
    assert.ok(mine.every((id) => after.body.seats.find((s) => s.id === id).status === 'available'));
  });
});

describe('checkout', () => {
  it('turns the held seats into a booking and emails a ticket', async () => {
    const { body: before } = await api.get(`/api/shows/${show.id}/seats`, { token: alice });
    const heldIds = before.seats.filter((s) => s.heldByMe).map((s) => s.id);
    assert.ok(heldIds.length > 0);

    const { status, body } = await api.post('/api/bookings', { showId: show.id, guestName: 'Alice', guestMobile: '123', guestEmail: 'alice@example.com' }, { token: alice });
    assert.equal(status, 201);
    assert.match(body.booking.reference, /^SW-[2-9A-HJ-NP-Z]{8}$/);
    assert.equal(body.booking.status, 'confirmed');
    assert.equal(body.booking.seats.length, heldIds.length);

    const { config } = await import('../src/config.js');
    const written = readdirSync(config.mail.outbox).filter((f) => f.includes('seatwise-ticket'));
    assert.ok(written.length > 0, 'a ticket email should have been written to the outbox');

    const after = await api.get(`/api/shows/${show.id}/seats`);
    assert.ok(heldIds.every((id) => after.body.seats.find((s) => s.id === id).status === 'booked'));
  });

  it('serves a QR code for the booking reference', async () => {
    const { body: list } = await api.get('/api/bookings', { token: alice });
    const { status, body } = await api.get(`/api/bookings/${list.bookings[0].id}/qr`, { token: alice });
    assert.equal(status, 200);
    assert.equal(body.reference, list.bookings[0].reference);
    assert.match(body.dataUrl, /^data:image\/png;base64,/);
  });

  it('rejects a checkout with no live hold', async () => {
    const { status, body } = await api.post('/api/bookings', { showId: show.id, guestName: 'Bob', guestMobile: '123', guestEmail: 'bob@example.com' }, { token: bob });
    assert.equal(status, 409);
    assert.equal(body.error, 'hold_expired');
  });

  it('returns the original booking when a request is retried', async () => {
    const { body: map } = await api.get(`/api/shows/${show.id}/seats`);
    const free = map.seats.find((s) => s.status === 'available').id;
    await api.post(`/api/shows/${show.id}/hold`, { seatIds: [free] }, { token: bob });

    const key = 'retry-key-1';
    const first = await api.post('/api/bookings', { showId: show.id, guestName: 'Bob', guestMobile: '123', guestEmail: 'bob@example.com' }, { token: bob, headers: { 'Idempotency-Key': key } });
    const second = await api.post('/api/bookings', { showId: show.id, guestName: 'Bob', guestMobile: '123', guestEmail: 'bob@example.com' }, { token: bob, headers: { 'Idempotency-Key': key } });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(first.body.booking.id, second.body.booking.id);

    const { body } = await api.get('/api/bookings', { token: bob });
    assert.equal(body.bookings.filter((b) => b.reference === first.body.booking.reference).length, 1);
  });
});

describe('permissions', () => {
  it('stops a customer creating events', async () => {
    const { status } = await api.post('/api/events', { title: 'Nope', kind: 'movie' }, { token: alice });
    assert.equal(status, 403);
  });

  it('stops an organiser creating venues', async () => {
    const { status } = await api.post('/api/venues', { name: 'X', city: 'Y', categories: ['A'], rows: [] }, { token: organiser });
    assert.equal(status, 403);
  });

  it('requires a token for the booking history', async () => {
    const { status } = await api.get('/api/bookings');
    assert.equal(status, 401);
  });

  it('does not let a customer read another customer booking', async () => {
    const { body } = await api.get('/api/bookings', { token: alice });
    const { status } = await api.get(`/api/bookings/${body.bookings[0].id}`, { token: bob });
    assert.equal(status, 404);
  });
});

describe('organiser reporting', () => {
  it('reports revenue and occupancy for the organiser own event', async () => {
    const { body: events } = await api.get('/api/organiser/events', { token: organiser });
    const { status, body } = await api.get(`/api/organiser/events/${events.events[0].id}/summary`, { token: organiser });

    assert.equal(status, 200);
    assert.ok(body.summary.revenue > 0);
    assert.equal(body.summary.seats, 7);
    assert.ok(body.summary.booked > 0);
    assert.ok(body.summary.byCategory.length > 0);
  });
});
