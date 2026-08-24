import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { register, startTestServer } from './helpers.js';

let api;
let db;
let outbox;
let organiser;
let alice;
let bob;
let carol;
let show;
let categoryId;

// Nodemailer writes quoted-printable, which folds long lines with "=\n".
// Undo that before looking for the claim URL.
const readOutbox = () =>
  readdirSync(outbox).map((f) => readFileSync(join(outbox, f), 'utf8').replace(/=\r?\n/g, ''));

const claimLinkFor = (needle) => {
  const mail = readOutbox().reverse().find((m) => m.includes('/offer/') && m.includes(needle));
  return mail?.match(/\/offer\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
};

before(async () => {
  // A one-second offer window keeps the expiry test quick.
  api = await startTestServer({ offerTtlSeconds: 1 });
  ({ db } = await import('../src/db/index.js'));
  const { config } = await import('../src/config.js');
  const { hashPassword } = await import('../src/lib/passwords.js');
  outbox = config.mail.outbox;

  db.prepare('INSERT INTO users (email, name, password, role) VALUES (?, ?, ?, ?)')
    .run('root@seatwise.test', 'Root', hashPassword('Password123'), 'admin');
  const admin = (await api.post('/api/auth/login', { email: 'root@seatwise.test', password: 'Password123' })).body.token;

  organiser = await register(api, 'org@seatwise.test', 'organiser');
  alice = await register(api, 'alice@seatwise.test');
  bob = await register(api, 'bob@seatwise.test');
  carol = await register(api, 'carol@seatwise.test');

  // Two seats only, so the category sells out in one booking.
  const venue = await api.post(
    '/api/venues',
    { name: 'Tiny Room', city: 'Kochi', categories: ['Recliner'], rows: [{ label: 'A', seats: 2, category: 'Recliner' }] },
    { token: admin }
  );
  const event = await api.post('/api/events', { title: 'Sold Out Show', kind: 'concert' }, { token: organiser });
  const created = await api.post(
    '/api/shows',
    {
      eventId: event.body.event.id,
      venueId: venue.body.venue.id,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      prices: { Recliner: 500 },
    },
    { token: organiser }
  );
  show = created.body.show;

  const map = await api.get(`/api/shows/${show.id}/seats`);
  categoryId = map.body.seats[0].categoryId;

  // Alice buys both seats, which sells the category out.
  await api.post(`/api/shows/${show.id}/hold`, { seatIds: map.body.seats.map((s) => s.id) }, { token: alice });
  const booking = await api.post('/api/bookings', { showId: show.id, guestName: 'Alice', guestMobile: '123', guestEmail: 'alice@example.com' }, { token: alice });
  assert.equal(booking.status, 201);
});

after(async () => api.close());

describe('joining a waitlist', () => {
  it('refuses while seats are still on sale', async () => {
    const other = await api.post('/api/events', { title: 'Open Show', kind: 'movie' }, { token: organiser });
    const venues = await api.get('/api/venues');
    const openShow = await api.post(
      '/api/shows',
      {
        eventId: other.body.event.id,
        venueId: venues.body.venues[0].id,
        startsAt: new Date(Date.now() + 172_800_000).toISOString(),
        prices: { Recliner: 500 },
      },
      { token: organiser }
    );
    const map = await api.get(`/api/shows/${openShow.body.show.id}/seats`);

    const { status, body } = await api.post(
      `/api/shows/${openShow.body.show.id}/waitlist`,
      { categoryId: map.body.seats[0].categoryId },
      { token: bob }
    );
    assert.equal(status, 409);
    assert.equal(body.error, 'seats_available');
  });

  it('accepts a customer once the category is sold out', async () => {
    const { status, body } = await api.post(`/api/shows/${show.id}/waitlist`, { categoryId }, { token: bob });
    assert.equal(status, 201);
    assert.equal(body.entry.status, 'waiting');
    assert.equal(body.entry.position, 1);
  });

  it('queues a second customer behind the first', async () => {
    const { body } = await api.post(`/api/shows/${show.id}/waitlist`, { categoryId }, { token: carol });
    assert.equal(body.entry.position, 2);
  });

  it('does not queue the same customer twice', async () => {
    const { status, body } = await api.post(`/api/shows/${show.id}/waitlist`, { categoryId }, { token: bob });
    assert.equal(status, 200);
    assert.equal(body.entry.alreadyQueued, true);
  });
});

describe('offer on cancellation', () => {
  let token;

  it('holds the freed seat for the first person in the queue and emails a link', async () => {
    const { body: mine } = await api.get('/api/bookings', { token: alice });
    const cancelled = await api.post(`/api/bookings/${mine.bookings[0].id}/cancel`, {}, { token: alice });

    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.seatsReoffered, 2, 'both freed seats should go to the queue');

    // Bob was first in line, so the seat is held for him rather than resold.
    const map = await api.get(`/api/shows/${show.id}/seats`, { token: bob });
    const forBob = map.body.seats.filter((s) => s.heldByMe);
    assert.equal(forBob.length, 1);
    assert.equal(forBob[0].holdKind, 'offer');

    const seen = await api.get(`/api/shows/${show.id}/seats`, { token: alice });
    assert.ok(seen.body.seats.every((s) => s.status !== 'available'), 'a queued seat is not open to everyone');

    token = claimLinkFor('bob@seatwise.test');
    assert.ok(token, 'bob should have been emailed a claim link');
  });

  it('shows the offer only to the customer it was made to', async () => {
    const mine = await api.get(`/api/offers/${token}`, { token: bob });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.offer.expired, false);

    const theirs = await api.get(`/api/offers/${token}`, { token: carol });
    assert.equal(theirs.status, 404);
  });

  it('turns a claimed offer into a booking', async () => {
    const { status, body } = await api.post(`/api/offers/${token}/claim`, {}, { token: bob });
    assert.equal(status, 201);
    assert.equal(body.booking.source, 'waitlist_offer');
    assert.equal(body.booking.seats.length, 1);

    const entries = await api.get('/api/waitlist', { token: bob });
    assert.equal(entries.body.entries.length, 0, 'a converted entry leaves the queue');
  });

  it('will not let the same offer be claimed twice', async () => {
    const { status } = await api.post(`/api/offers/${token}/claim`, {}, { token: bob });
    assert.equal(status, 404);
  });
});

describe('offer expiry', () => {
  it('passes an unclaimed seat to the next person in the queue', async () => {
    // Carol was second in line and holds the other freed seat.
    const before = claimLinkFor('carol@seatwise.test');
    assert.ok(before, 'carol should have been emailed a claim link');

    const entry = db.prepare("SELECT id FROM waitlist WHERE status = 'offered'").get();
    assert.ok(entry, 'carol should have a live offer');

    // A fourth customer joins behind carol, then carol lets her window lapse.
    const dave = await register(api, 'dave@seatwise.test');
    const queued = await api.post(`/api/shows/${show.id}/waitlist`, { categoryId }, { token: dave });
    assert.equal(queued.status, 201);

    db.prepare('UPDATE waitlist SET offer_expires_at = ? WHERE id = ?').run(Date.now() - 1000, entry.id);

    const { runSweep } = await import('../src/services/sweeper.js');
    const result = await runSweep();
    assert.ok(result.offersExpired >= 1);

    const carolEntry = db.prepare('SELECT status FROM waitlist WHERE id = ?').get(entry.id);
    assert.equal(carolEntry.status, 'expired');

    const daveOffer = claimLinkFor('dave@seatwise.test');
    assert.ok(daveOffer, 'dave should now hold the offer');

    const seat = await api.get(`/api/shows/${show.id}/seats`, { token: dave });
    assert.equal(seat.body.seats.filter((s) => s.heldByMe && s.holdKind === 'offer').length, 1);
  });

  it('returns the seat to general sale when the queue empties', async () => {
    const entry = db.prepare("SELECT id FROM waitlist WHERE status = 'offered'").get();
    db.prepare('UPDATE waitlist SET offer_expires_at = ? WHERE id = ?').run(Date.now() - 1000, entry.id);

    const { runSweep } = await import('../src/services/sweeper.js');
    await runSweep();

    const map = await api.get(`/api/shows/${show.id}/seats`);
    assert.equal(map.body.seats.filter((s) => s.status === 'available').length, 1);
  });

  it('lets a customer leave the queue', async () => {
    const eve = await register(api, 'eve@seatwise.test');
    const joined = await api.post(`/api/shows/${show.id}/waitlist`, { categoryId }, { token: eve });
    assert.equal(joined.status, 409, 'a free seat means there is nothing to queue for');

    const bobEntries = await api.get('/api/waitlist', { token: bob });
    assert.equal(bobEntries.body.entries.length, 0);
  });
});
