import { randomInt } from 'node:crypto';
import { db, writeTxn } from '../db/index.js';
import { conflict, notFound } from '../lib/http.js';
import { sendTicketEmail } from './mailer.js';
import { qrPng } from './qr.js';
import { publishSeatChanges } from './realtime.js';
import { deliverOffers, offerFreedSeat } from './waitlist.js';

// No I, O, 0 or 1, so a reference read off a phone screen is unambiguous.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const newReference = () => {
  let suffix = '';
  for (let i = 0; i < 8; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `SW-${suffix}`;
};

const getShowContext = async (showId) => {
  const res = await db.query(
    `SELECT sh.id, sh.starts_at, e.title, e.kind,
            v.name AS venue_name, v.city AS venue_city
       FROM shows sh
       JOIN events e ON e.id = sh.event_id
       JOIN venues v ON v.id = sh.venue_id
      WHERE sh.id = $1`,
    [showId]
  );
  return res.rows[0] || null;
};

const getSeatLines = async (bookingId) => {
  const res = await db.query(
    `SELECT s.row_label, s.seat_number, c.name AS category, bs.price
       FROM booking_seats bs
       JOIN show_seats ss ON ss.id = bs.show_seat_id
       JOIN seats s       ON s.id = ss.seat_id
       JOIN categories c  ON c.id = ss.category_id
      WHERE bs.booking_id = $1
      ORDER BY s.row_label, s.seat_number`,
    [bookingId]
  );
  return res.rows;
};

const checkoutTxn = writeTxn(async (client, showId, userId, idempotencyKey, guestName, guestMobile, guestEmail) => {
  if (idempotencyKey) {
    const priorRes = await client.query(
      'SELECT id, reference, amount, user_id AS "userId" FROM bookings WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    const prior = priorRes.rows[0];
    // A retried request must return the original booking, not a second one.
    if (prior && prior.userId === userId) return { bookingId: prior.id, reference: prior.reference, replayed: true };
    if (prior) throw conflict('That idempotency key belongs to another customer.', 'idempotency_conflict');
  }

  const now = Date.now();
  // Lock held rows in consistent order
  const heldRes = await client.query(
    `SELECT id, price FROM show_seats
      WHERE show_id = $1 AND held_by = $2 AND status = 'held'
        AND hold_kind = 'checkout' AND hold_expires_at > $3
      ORDER BY id
        FOR UPDATE`,
    [showId, userId, now]
  );
  const held = heldRes.rows;

  if (held.length === 0) {
    throw conflict('Your seat hold has expired. Please pick your seats again.', 'hold_expired');
  }

  const amount = Number(held.reduce((sum, s) => sum + s.price, 0).toFixed(2));
  const ref = newReference();

  const insertBookingRes = await client.query(
    `INSERT INTO bookings (reference, show_id, user_id, amount, source, idempotency_key, guest_name, guest_mobile, guest_email)
     VALUES ($1, $2, $3, $4, 'checkout', $5, $6, $7, $8)
     RETURNING id`,
    [ref, showId, userId, amount, idempotencyKey || null, guestName || null, guestMobile || null, guestEmail || null]
  );
  const bookingId = insertBookingRes.rows[0].id;

  for (const seat of held) {
    // Re-check the hold as we write. If it lapsed a moment ago the whole
    // checkout rolls back rather than issuing a ticket for a seat we lost.
    const updateRes = await client.query(
      `UPDATE show_seats
          SET status = 'booked', held_by = NULL, hold_expires_at = NULL, hold_kind = NULL
        WHERE id = $1 AND status = 'held' AND held_by = $2 AND hold_expires_at > $3`,
      [seat.id, userId, now]
    );
    if (updateRes.rowCount !== 1) {
      throw conflict('Your seat hold has expired. Please pick your seats again.', 'hold_expired');
    }
    await client.query(
      'INSERT INTO booking_seats (booking_id, show_seat_id, price) VALUES ($1, $2, $3)',
      [bookingId, seat.id, seat.price]
    );
  }

  return {
    bookingId,
    reference: ref,
    seatIds: held.map((s) => s.id),
    replayed: false,
  };
});

const claimTxn = writeTxn(async (client, token, userId) => {
  const entryRes = await client.query(
    `SELECT id, user_id AS "userId", status, offer_seat_id AS "seatId",
            offer_expires_at AS "expiresAt", show_id AS "showId"
       FROM waitlist WHERE offer_token = $1
        FOR UPDATE`,
    [token]
  );
  const entry = entryRes.rows[0];

  if (!entry) throw notFound('That offer link is not valid.', 'offer_not_found');
  if (entry.userId !== userId) throw notFound('That offer link is not valid.', 'offer_not_found');
  if (entry.status !== 'offered') throw conflict('This offer is no longer open.', 'offer_closed');
  if (entry.expiresAt <= Date.now()) throw conflict('This offer has expired.', 'offer_expired');

  const seatRes = await client.query(
    'SELECT id, price FROM show_seats WHERE id = $1 FOR UPDATE',
    [entry.seatId]
  );
  const seat = seatRes.rows[0];
  if (!seat) throw notFound('The offered seat no longer exists.');

  const updateRes = await client.query(
    `UPDATE show_seats
        SET status = 'booked', held_by = NULL, hold_expires_at = NULL, hold_kind = NULL
      WHERE id = $1 AND status = 'held' AND held_by = $2 AND hold_kind = 'offer'`,
    [seat.id, userId]
  );
  if (updateRes.rowCount !== 1) throw conflict('This offer has expired.', 'offer_expired');

  await client.query(
    `UPDATE waitlist
        SET status = 'converted', offer_token = NULL, offer_expires_at = NULL
      WHERE id = $1 AND status = 'offered'`,
    [entry.id]
  );

  const ref = newReference();
  const insertBookingRes = await client.query(
    `INSERT INTO bookings (reference, show_id, user_id, amount, source)
     VALUES ($1, $2, $3, $4, 'waitlist_offer')
     RETURNING id`,
    [ref, entry.showId, userId, seat.price]
  );
  const bookingId = insertBookingRes.rows[0].id;

  await client.query(
    'INSERT INTO booking_seats (booking_id, show_seat_id, price) VALUES ($1, $2, $3)',
    [bookingId, seat.id, seat.price]
  );

  return {
    bookingId,
    showId: entry.showId,
    reference: ref,
    seatIds: [seat.id],
    replayed: false,
  };
});

/** Emails the ticket. Runs after the transaction commits, and never throws. */
const issueTicket = async (bookingId) => {
  const bookingRes = await db.query(
    `SELECT b.id, b.reference, b.amount, b.show_id AS "showId", COALESCE(b.guest_email, u.email) AS email
       FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = $1`,
    [bookingId]
  );
  const booking = bookingRes.rows[0];
  if (!booking) return { delivered: false };

  try {
    const qrBuffer = await qrPng(booking.reference);
    const [seats, show] = await Promise.all([
      getSeatLines(bookingId),
      getShowContext(booking.showId),
    ]);
    return sendTicketEmail({
      booking,
      seats,
      show,
      qrBuffer,
    });
  } catch (err) {
    console.error(`could not issue ticket for booking ${bookingId}:`, err.message);
    return { delivered: false, error: err.message };
  }
};

export const checkout = async (showId, userId, idempotencyKey, guestName, guestMobile, guestEmail) => {
  const result = await checkoutTxn(showId, userId, idempotencyKey, guestName, guestMobile, guestEmail);

  if (!result.replayed) {
    publishSeatChanges(showId, result.seatIds.map((id) => ({ id, status: 'booked', holdExpiresAt: null })));
    await issueTicket(result.bookingId);
  }
  return getBooking(result.bookingId, userId);
};

export const claimWaitlistOffer = async (token, userId) => {
  const result = await claimTxn(token, userId);
  publishSeatChanges(result.showId, result.seatIds.map((id) => ({ id, status: 'booked', holdExpiresAt: null })));
  await issueTicket(result.bookingId);
  return getBooking(result.bookingId, userId);
};

// --- Cancellation ---------------------------------------------------------

const cancelTxn = writeTxn(async (client, bookingId, userId) => {
  const bookingRes = await client.query(
    `SELECT b.id, b.status, b.user_id AS "userId", b.show_id AS "showId", sh.starts_at AS "startsAt"
       FROM bookings b JOIN shows sh ON sh.id = b.show_id WHERE b.id = $1
        FOR UPDATE`,
    [bookingId]
  );
  const booking = bookingRes.rows[0];

  if (!booking || booking.userId !== userId) throw notFound('Booking not found.');
  if (booking.status === 'cancelled') throw conflict('That booking is already cancelled.', 'already_cancelled');
  if (new Date(booking.startsAt).getTime() <= Date.now()) {
    throw conflict('This show has already started, so it can no longer be cancelled.', 'show_started');
  }

  await client.query("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1", [bookingId]);

  const seatsRes = await client.query(
    'SELECT show_seat_id AS "seatId" FROM booking_seats WHERE booking_id = $1 AND released_at IS NULL',
    [bookingId]
  );
  await client.query('UPDATE booking_seats SET released_at = NOW() WHERE booking_id = $1', [bookingId]);

  const changes = [];
  const offers = [];

  for (const { seatId } of seatsRes.rows) {
    // This is the waitlist hand-off: a cancelled seat goes to whoever is next
    // in the queue for its category before it returns to the open map.
    const result = await offerFreedSeat(client, seatId);
    if (result.change) changes.push(result.change);
    if (result.offer) offers.push(result.offer);
  }

  return { showId: booking.showId, changes, offers };
});

export const cancelBooking = async (bookingId, userId) => {
  const { showId, changes, offers } = await cancelTxn(bookingId, userId);
  publishSeatChanges(showId, changes);
  await deliverOffers(offers);
  return { cancelled: true, seatsReoffered: offers.length };
};

// --- Reads ----------------------------------------------------------------

const bookingBase = `
  SELECT b.id, b.reference, b.amount, b.status, b.source, b.created_at AS "createdAt",
         b.cancelled_at AS "cancelledAt", b.show_id AS "showId",
         b.guest_name AS "guestName", b.guest_mobile AS "guestMobile", b.guest_email AS "guestEmail",
         sh.starts_at AS "startsAt", e.title, e.kind,
         v.name AS "venueName", v.city AS "venueCity"
    FROM bookings b
    JOIN shows sh ON sh.id = b.show_id
    JOIN events e ON e.id = sh.event_id
    JOIN venues v ON v.id = sh.venue_id
`;

const withSeats = async (row) => {
  if (!row) return null;
  const lines = await getSeatLines(row.id);
  const seats = lines.map((s) => ({
    label: `${s.row_label}${s.seat_number}`,
    category: s.category,
    price: s.price,
  }));
  return { ...row, seats };
};

export const getBooking = async (bookingId, userId) => {
  const res = await db.query(`${bookingBase} WHERE b.id = $1 AND b.user_id = $2`, [bookingId, userId]);
  const row = res.rows[0];
  if (!row) throw notFound('Booking not found.');
  return withSeats(row);
};

export const listBookings = async (userId) => {
  const res = await db.query(`${bookingBase} WHERE b.user_id = $1 ORDER BY b.id DESC`, [userId]);
  return Promise.all(res.rows.map(withSeats));
};
