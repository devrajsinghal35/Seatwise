import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { register, startTestServer } from './helpers.js';

let api;
let db;
let alice;
let bob;
let show;

const expireHoldNow = (seatId) =>
  db.prepare('UPDATE show_seats SET hold_expires_at = ? WHERE id = ?').run(Date.now() - 1000, seatId);

before(async () => {
  // A two-second hold keeps the real-timer test fast.
  api = await startTestServer({ holdTtlSeconds: 2 });
  ({ db } = await import('../src/db/index.js'));
  const { hashPassword } = await import('../src/lib/passwords.js');

  db.prepare('INSERT INTO users (email, name, password, role) VALUES (?, ?, ?, ?)')
    .run('root@seatwise.test', 'Root', hashPassword('Password123'), 'admin');
  const admin = (await api.post('/api/auth/login', { email: 'root@seatwise.test', password: 'Password123' })).body.token;

  const organiser = await register(api, 'org@seatwise.test', 'organiser');
  alice = await register(api, 'alice@seatwise.test');
  bob = await register(api, 'bob@seatwise.test');

  const venue = await api.post(
    '/api/venues',
    { name: 'Expiry Hall', city: 'Goa', categories: ['Standard'], rows: [{ label: 'A', seats: 6, category: 'Standard' }] },
    { token: admin }
  );
  const event = await api.post('/api/events', { title: 'Timed Show', kind: 'movie' }, { token: organiser });
  const created = await api.post(
    '/api/shows',
    {
      eventId: event.body.event.id,
      venueId: venue.body.venue.id,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      prices: { Standard: 300 },
    },
    { token: organiser }
  );
  show = created.body.show;
});

after(async () => api.close());

const firstAvailable = async () => {
  const { body } = await api.get(`/api/shows/${show.id}/seats`);
  return body.seats.find((s) => s.status === 'available');
};

describe('hold expiry', () => {
  it('reports an expired hold as available before the sweeper has run', async () => {
    const seat = await firstAvailable();
    await api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: alice });

    expireHoldNow(seat.id);

    // The stored row still says "held", but every reader and writer treats the
    // lapsed hold as free, so the map can never show a stale block.
    assert.equal(db.prepare('SELECT status FROM show_seats WHERE id = ?').get(seat.id).status, 'held');

    const { body } = await api.get(`/api/shows/${show.id}/seats`, { token: bob });
    assert.equal(body.seats.find((s) => s.id === seat.id).status, 'available');
  });

  it('lets another customer take a seat whose hold lapsed', async () => {
    const seat = await firstAvailable();
    await api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: alice });
    expireHoldNow(seat.id);

    const taken = await api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: bob });
    assert.equal(taken.status, 200);

    const { body } = await api.get(`/api/shows/${show.id}/seats`, { token: bob });
    assert.equal(body.seats.find((s) => s.id === seat.id).heldByMe, true);
  });

  it('refuses to check out against a lapsed hold', async () => {
    const seat = await firstAvailable();
    await api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: alice });
    expireHoldNow(seat.id);

    const { status, body } = await api.post('/api/bookings', { showId: show.id, guestName: 'Alice', guestMobile: '123', guestEmail: 'alice@example.com' }, { token: alice });
    assert.equal(status, 409);
    assert.equal(body.error, 'hold_expired');

    // Nothing may be left half-written by the rejected checkout.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE show_id = ?").get(show.id).n, 0);
  });

  it('rewrites the row back to available on the next sweep', async () => {
    const seat = await firstAvailable();
    await api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: alice });
    expireHoldNow(seat.id);

    const { runSweep } = await import('../src/services/sweeper.js');
    const result = await runSweep();
    assert.ok(result.holdsReleased >= 1);

    const row = db.prepare('SELECT status, held_by, hold_expires_at, hold_kind FROM show_seats WHERE id = ?').get(seat.id);
    assert.deepEqual(row, { status: 'available', held_by: null, hold_expires_at: null, hold_kind: null });
  });

  it('releases a hold once the configured TTL really elapses', async () => {
    const seat = await firstAvailable();
    const held = await api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: alice });
    assert.equal(held.body.hold.holdTtlSeconds, 2);

    await new Promise((done) => setTimeout(done, 2200));

    const { body } = await api.get(`/api/shows/${show.id}/seats`, { token: bob });
    assert.equal(body.seats.find((s) => s.id === seat.id).status, 'available');
  });

  it('keeps a booked seat booked no matter what the sweeper does', async () => {
    const seat = await firstAvailable();
    await api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: bob });
    const booked = await api.post('/api/bookings', { showId: show.id, guestName: 'Bob', guestMobile: '123', guestEmail: 'bob@example.com' }, { token: bob });
    assert.equal(booked.status, 201);

    const { runSweep } = await import('../src/services/sweeper.js');
    await runSweep();

    const row = db.prepare('SELECT status FROM show_seats WHERE id = ?').get(seat.id);
    assert.equal(row.status, 'booked', 'a paid seat must never be swept back to available');
  });
});
