import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { signToken } from '../src/lib/auth.js';
import { startTestServer } from './helpers.js';

let api;
let db;
let adminToken;
let organiserToken;
let userSeq = 0;

const createUser = async (role = 'customer') => {
  userSeq += 1;
  const email = `concurrency_user_${userSeq}_${Date.now()}@example.com`;
  const insertUser = db.prepare('INSERT INTO users (email, name, password, role) VALUES (?, ?, ?, ?)');
  const res = await insertUser.run(email, `User ${userSeq}`, 'mock_password_hash', role);
  const id = Number(res.lastInsertRowid);
  const user = { id, email, name: `User ${userSeq}`, role };
  const token = signToken(user);
  return { id, email, role, token };
};

const createShow = async ({ rowCount = 1, seatsPerRow = 6, prices = { Standard: 250 } } = {}) => {
  const categories = Object.keys(prices);
  const rows = [];
  for (let r = 0; r < rowCount; r += 1) {
    const label = String.fromCharCode(65 + r);
    rows.push({ label, seats: seatsPerRow, category: categories[0] });
  }

  const venueRes = await api.post(
    '/api/venues',
    {
      name: `Concurrency Venue ${Date.now()}_${Math.random()}`,
      city: 'Mumbai',
      categories,
      rows,
    },
    { token: adminToken }
  );
  assert.equal(venueRes.status, 201);
  const venue = venueRes.body.venue;

  const eventRes = await api.post(
    '/api/events',
    { title: `Concurrency Event ${Date.now()}_${Math.random()}`, kind: 'concert' },
    { token: organiserToken }
  );
  assert.equal(eventRes.status, 201);
  const event = eventRes.body.event;

  const showRes = await api.post(
    '/api/shows',
    {
      eventId: event.id,
      venueId: venue.id,
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      prices,
    },
    { token: organiserToken }
  );
  assert.equal(showRes.status, 201);
  return showRes.body.show;
};

before(async () => {
  api = await startTestServer({
    holdTtlSeconds: 2,
    offerTtlSeconds: 300,
    rateLimitHoldMax: 10000,
    rateLimitAuthMax: 10000,
  });

  ({ db } = await import('../src/db/index.js'));

  const admin = await createUser('admin');
  adminToken = admin.token;
  const organiser = await createUser('organiser');
  organiserToken = organiser.token;
});

after(async () => api.close());

describe('Concurrency & Contention', () => {
  it('handles 50 parallel hold requests from 50 users racing for 3 seats: exactly 3 succeed, rest 409', async () => {
    const show = await createShow({ rowCount: 1, seatsPerRow: 3 });
    const seatRes = await api.get(`/api/shows/${show.id}/seats`);
    const seats = seatRes.body.seats;
    assert.equal(seats.length, 3);

    // Create 50 distinct users
    const users = await Promise.all(Array.from({ length: 50 }, () => createUser('customer')));

    // 50 parallel hold requests racing for these 3 seats
    const requests = users.map((u, i) =>
      api.post(
        `/api/shows/${show.id}/hold`,
        { seatIds: [seats[i % 3].id] },
        { token: u.token }
      )
    );

    const responses = await Promise.all(requests);

    const successes = responses.filter((r) => r.status === 200);
    const conflicts = responses.filter((r) => r.status === 409);

    assert.equal(successes.length, 3, 'Exactly 3 hold requests should succeed');
    assert.equal(conflicts.length, 47, 'Exactly 47 hold requests should return 409');
    assert.equal(responses.length, 50);

    // Verify database state: each of the 3 seats is held by exactly one user
    const dbSeats = await db
      .prepare('SELECT id, status, held_by FROM show_seats WHERE show_id = ?')
      .all(show.id);

    assert.equal(dbSeats.length, 3);
    assert.ok(dbSeats.every((s) => s.status === 'held'));

    const holderIds = dbSeats.map((s) => s.held_by);
    const uniqueHolders = new Set(holderIds);
    assert.equal(uniqueHolders.size, 3, 'Each seat must be held by a distinct user');
  });

  it('handles opposite-order batch race ([1,2,3] vs [3,2,1]): no deadlock, no partial holds, valid outcome', async () => {
    const show = await createShow({ rowCount: 1, seatsPerRow: 3 });
    const seatRes = await api.get(`/api/shows/${show.id}/seats`);
    const [s1, s2, s3] = seatRes.body.seats;

    const userA = await createUser('customer');
    const userB = await createUser('customer');

    // User A holds [s1, s2, s3], User B holds [s3, s2, s1] simultaneously
    const [resA, resB] = await Promise.all([
      api.post(`/api/shows/${show.id}/hold`, { seatIds: [s1.id, s2.id, s3.id] }, { token: userA.token }),
      api.post(`/api/shows/${show.id}/hold`, { seatIds: [s3.id, s2.id, s1.id] }, { token: userB.token }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [200, 409], 'One user must win with 200 and the other must fail with 409');

    const winnerUser = resA.status === 200 ? userA : userB;
    const loserUser = resA.status === 200 ? userB : userA;

    // Check database state
    const heldSeats = await db
      .prepare('SELECT id, status, held_by FROM show_seats WHERE show_id = ?')
      .all(show.id);

    assert.equal(heldSeats.length, 3);
    assert.ok(heldSeats.every((s) => s.status === 'held'));
    assert.ok(heldSeats.every((s) => s.held_by === winnerUser.id), 'Winner must hold all 3 seats');

    // Confirm no partial holds left behind for loser
    const loserHeld = await db
      .prepare('SELECT COUNT(*) AS count FROM show_seats WHERE show_id = ? AND held_by = ?')
      .get(show.id, loserUser.id);
    const loserHeldCount = Number(loserHeld.count);
    assert.equal(loserHeldCount, 0, 'Loser must not hold any seats');
  });

  it('handles hold and checkout race: 20 users hold and checkout the same seat concurrently, exactly one booking row', async () => {
    const show = await createShow({ rowCount: 1, seatsPerRow: 1 });
    const seatRes = await api.get(`/api/shows/${show.id}/seats`);
    const targetSeat = seatRes.body.seats[0];

    const users = await Promise.all(Array.from({ length: 20 }, () => createUser('customer')));

    // 20 users race to hold and then checkout the single seat concurrently
    const raceResults = await Promise.all(
      users.map(async (u, idx) => {
        const holdRes = await api.post(
          `/api/shows/${show.id}/hold`,
          { seatIds: [targetSeat.id] },
          { token: u.token }
        );

        // Attempt checkout
        const checkoutRes = await api.post(
          '/api/bookings',
          {
            showId: show.id,
            guestName: `Contender ${idx}`,
            guestMobile: '9876543210',
            guestEmail: u.email,
          },
          { token: u.token }
        );

        return {
          userId: u.id,
          holdStatus: holdRes.status,
          checkoutStatus: checkoutRes.status,
        };
      })
    );

    const successfulHolds = raceResults.filter((r) => r.holdStatus === 200);
    const successfulCheckouts = raceResults.filter((r) => r.checkoutStatus === 201);

    assert.equal(successfulHolds.length, 1, 'Only one user should successfully hold the seat');
    assert.equal(successfulCheckouts.length, 1, 'Only one user should successfully check out');

    // The other 19 checkouts must have returned 409 (hold_expired / no live hold)
    const failedCheckouts = raceResults.filter((r) => r.checkoutStatus === 409);
    assert.equal(failedCheckouts.length, 19);

    // Verify bookings and unique index in database
    const bookingRows = await db
      .prepare('SELECT id, show_id, user_id, status FROM bookings WHERE show_id = ?')
      .all(show.id);
    assert.equal(bookingRows.length, 1, 'Exactly one booking row must exist');
    assert.equal(bookingRows[0].status, 'confirmed');

    const bookingSeatRows = await db
      .prepare('SELECT booking_id, show_seat_id FROM booking_seats WHERE show_seat_id = ? AND released_at IS NULL')
      .all(targetSeat.id);
    assert.equal(bookingSeatRows.length, 1, 'Unique index idx_seat_one_live_booking must have exactly 1 live row');

    const seatInDb = await db.prepare('SELECT status, held_by FROM show_seats WHERE id = ?').get(targetSeat.id);
    assert.equal(seatInDb.status, 'booked');
    assert.equal(seatInDb.held_by, null);
  });

  it('handles waitlist cascade under load: 10 users on waitlist, cancel 1 booking, exactly one offer issued to earliest queue entry', async () => {
    const show = await createShow({ rowCount: 1, seatsPerRow: 1 });
    const seatRes = await api.get(`/api/shows/${show.id}/seats`);
    const seat = seatRes.body.seats[0];

    // Book the seat with user0 so the show is 100% sold out
    const user0 = await createUser('customer');
    await api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: user0.token });
    const bookingRes = await api.post(
      '/api/bookings',
      { showId: show.id, guestName: 'First Holder', guestMobile: '9876543210', guestEmail: user0.email },
      { token: user0.token }
    );
    assert.equal(bookingRes.status, 201);
    const bookingId = bookingRes.body.booking.id;

    // 10 users join the waitlist in order
    const waitlistUsers = await Promise.all(Array.from({ length: 10 }, () => createUser('customer')));
    for (const u of waitlistUsers) {
      const joinRes = await api.post(
        `/api/shows/${show.id}/waitlist`,
        { categoryId: seat.categoryId },
        { token: u.token }
      );
      assert.equal(joinRes.status, 201);
    }

    // Cancel user0's booking
    const cancelRes = await api.post(`/api/bookings/${bookingId}/cancel`, {}, { token: user0.token });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.seatsReoffered, 1);

    // Verify waitlist in DB: exactly one offer issued, to the earliest queue entry (waitlistUsers[0])
    const waitlistEntries = await db
      .prepare('SELECT id, user_id, status FROM waitlist WHERE show_id = ? ORDER BY id')
      .all(show.id);

    assert.equal(waitlistEntries.length, 10);
    const offeredEntries = waitlistEntries.filter((w) => w.status === 'offered');
    assert.equal(offeredEntries.length, 1, 'Exactly one waitlist offer must be issued');
    assert.equal(offeredEntries[0].user_id, waitlistUsers[0].id, 'Offer must go to the earliest queued customer');

    const waitingEntries = waitlistEntries.filter((w) => w.status === 'waiting');
    assert.equal(waitingEntries.length, 9, 'Remaining 9 customers must stay in waiting status');

    // Seat in DB should be held with hold_kind = 'offer' for waitlistUsers[0]
    const offeredSeat = await db.prepare('SELECT status, held_by, hold_kind FROM show_seats WHERE id = ?').get(seat.id);
    assert.equal(offeredSeat.status, 'held');
    assert.equal(offeredSeat.hold_kind, 'offer');
    assert.equal(offeredSeat.held_by, waitlistUsers[0].id);
  });

  it('handles expiry race: hold expires at same moment another user tries to take seat, seat ends up with exactly one owner', async () => {
    const show = await createShow({ rowCount: 1, seatsPerRow: 1 });
    const seatRes = await api.get(`/api/shows/${show.id}/seats`);
    const seat = seatRes.body.seats[0];

    const alice = await createUser('customer');
    const bob = await createUser('customer');
    const charlie = await createUser('customer');

    // Alice holds the seat
    const holdAlice = await api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: alice.token });
    assert.equal(holdAlice.status, 200);

    // Fast-forward hold expiry into the past
    await db.prepare('UPDATE show_seats SET hold_expires_at = ? WHERE id = ?').run(Date.now() - 1000, seat.id);

    // Concurrently: Alice attempts checkout (on expired hold), while Bob and Charlie attempt to hold the seat
    const [resAliceCheckout, resBobHold, resCharlieHold] = await Promise.all([
      api.post(
        '/api/bookings',
        { showId: show.id, guestName: 'Alice', guestMobile: '9876543210', guestEmail: alice.email },
        { token: alice.token }
      ),
      api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: bob.token }),
      api.post(`/api/shows/${show.id}/hold`, { seatIds: [seat.id] }, { token: charlie.token }),
    ]);

    // Alice's checkout must fail because her hold expired
    assert.equal(resAliceCheckout.status, 409, 'Expired hold checkout must be rejected');

    // Exactly one of Bob or Charlie must successfully hold the seat
    const newHoldStatuses = [resBobHold.status, resCharlieHold.status].sort();
    assert.deepEqual(newHoldStatuses, [200, 409], 'Exactly one new contender must win the seat');

    const winnerId = resBobHold.status === 200 ? bob.id : charlie.id;

    // Database verification: seat ends up with exactly one owner
    const seatInDb = await db.prepare('SELECT status, held_by, hold_expires_at FROM show_seats WHERE id = ?').get(seat.id);
    assert.equal(seatInDb.status, 'held');
    assert.equal(seatInDb.held_by, winnerId);
    assert.ok(seatInDb.hold_expires_at > Date.now(), 'Hold expiry must be refreshed into future');

    // Verify no bookings were made
    const bookingsCountRow = await db.prepare('SELECT COUNT(*) AS count FROM bookings WHERE show_id = ?').get(show.id);
    const bookingsCount = Number(bookingsCountRow.count);
    assert.equal(bookingsCount, 0, 'No booking should have been recorded');
  });
});
