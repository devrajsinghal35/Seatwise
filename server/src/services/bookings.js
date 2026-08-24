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

const showContext = db.prepare(`
  SELECT sh.id, sh.starts_at, e.title, e.kind,
         v.name AS venue_name, v.city AS venue_city
    FROM shows sh
    JOIN events e ON e.id = sh.event_id
    JOIN venues v ON v.id = sh.venue_id
   WHERE sh.id = ?
`);

const seatLines = db.prepare(`
  SELECT s.row_label, s.seat_number, c.name AS category, bs.price
    FROM booking_seats bs
    JOIN show_seats ss ON ss.id = bs.show_seat_id
    JOIN seats s       ON s.id = ss.seat_id
    JOIN categories c  ON c.id = ss.category_id
   WHERE bs.booking_id = ?
   ORDER BY s.row_label, s.seat_number
`);

const bookSeat = db.prepare(`
  UPDATE show_seats
     SET status = 'booked', held_by = NULL, hold_expires_at = NULL, hold_kind = NULL
   WHERE id = ? AND status = 'held' AND held_by = ? AND hold_expires_at > ?
`);

const insertBooking = db.prepare(
  'INSERT INTO bookings (reference, show_id, user_id, amount, source, idempotency_key, guest_name, guest_mobile, guest_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const insertBookingSeat = db.prepare(
  'INSERT INTO booking_seats (booking_id, show_seat_id, price) VALUES (?, ?, ?)'
);

const findByIdempotencyKey = db.prepare(
  'SELECT id, reference, amount, user_id AS userId FROM bookings WHERE idempotency_key = ?'
);

const checkoutTxn = writeTxn((showId, userId, idempotencyKey, guestName, guestMobile, guestEmail) => {
  if (idempotencyKey) {
    const prior = findByIdempotencyKey.get(idempotencyKey);
    // A retried request must return the original booking, not a second one.
    if (prior && prior.userId === userId) return { bookingId: prior.id, reference: prior.reference, replayed: true };
    if (prior) throw conflict('That idempotency key belongs to another customer.', 'idempotency_conflict');
  }

  const now = Date.now();
  const held = db
    .prepare(`SELECT id, price FROM show_seats
               WHERE show_id = ? AND held_by = ? AND status = 'held'
                 AND hold_kind = 'checkout' AND hold_expires_at > ?
               ORDER BY id`)
    .all(showId, userId, now);

  if (held.length === 0) {
    throw conflict('Your seat hold has expired. Please pick your seats again.', 'hold_expired');
  }

  const amount = Number(held.reduce((sum, s) => sum + s.price, 0).toFixed(2));
  const bookingId = Number(insertBooking.run(newReference(), showId, userId, amount, 'checkout', idempotencyKey || null, guestName || null, guestMobile || null, guestEmail || null).lastInsertRowid);

  for (const seat of held) {
    // Re-check the hold as we write. If it lapsed a moment ago the whole
    // checkout rolls back rather than issuing a ticket for a seat we lost.
    if (bookSeat.run(seat.id, userId, now).changes !== 1) {
      throw conflict('Your seat hold has expired. Please pick your seats again.', 'hold_expired');
    }
    insertBookingSeat.run(bookingId, seat.id, seat.price);
  }

  return {
    bookingId,
    reference: db.prepare('SELECT reference FROM bookings WHERE id = ?').get(bookingId).reference,
    seatIds: held.map((s) => s.id),
    replayed: false,
  };
});

const claimTxn = writeTxn((token, userId) => {
  const entry = db
    .prepare(`SELECT id, user_id AS userId, status, offer_seat_id AS seatId,
                     offer_expires_at AS expiresAt, show_id AS showId
                FROM waitlist WHERE offer_token = ?`)
    .get(token);

  if (!entry) throw notFound('That offer link is not valid.', 'offer_not_found');
  if (entry.userId !== userId) throw notFound('That offer link is not valid.', 'offer_not_found');
  if (entry.status !== 'offered') throw conflict('This offer is no longer open.', 'offer_closed');
  if (entry.expiresAt <= Date.now()) throw conflict('This offer has expired.', 'offer_expired');

  const seat = db.prepare('SELECT id, price FROM show_seats WHERE id = ?').get(entry.seatId);
  if (!seat) throw notFound('The offered seat no longer exists.');

  const booked = db
    .prepare(`UPDATE show_seats
                 SET status = 'booked', held_by = NULL, hold_expires_at = NULL, hold_kind = NULL
               WHERE id = ? AND status = 'held' AND held_by = ? AND hold_kind = 'offer'`)
    .run(seat.id, userId);
  if (booked.changes !== 1) throw conflict('This offer has expired.', 'offer_expired');

  db.prepare(`UPDATE waitlist
                 SET status = 'converted', offer_token = NULL, offer_expires_at = NULL
               WHERE id = ? AND status = 'offered'`).run(entry.id);

  const bookingId = Number(
    insertBooking.run(newReference(), entry.showId, userId, seat.price, 'waitlist_offer', null, null, null, null).lastInsertRowid
  );
  insertBookingSeat.run(bookingId, seat.id, seat.price);

  return {
    bookingId,
    showId: entry.showId,
    reference: db.prepare('SELECT reference FROM bookings WHERE id = ?').get(bookingId).reference,
    seatIds: [seat.id],
    replayed: false,
  };
});

/** Emails the ticket. Runs after the transaction commits, and never throws. */
const issueTicket = async (bookingId) => {
  const booking = db
    .prepare(`SELECT b.id, b.reference, b.amount, b.show_id AS showId, COALESCE(b.guest_email, u.email) AS email
                FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?`)
    .get(bookingId);
  if (!booking) return { delivered: false };

  try {
    const qrBuffer = await qrPng(booking.reference);
    return sendTicketEmail({
      booking,
      seats: seatLines.all(bookingId),
      show: showContext.get(booking.showId),
      qrBuffer,
    });
  } catch (err) {
    console.error(`could not issue ticket for booking ${bookingId}:`, err.message);
    return { delivered: false, error: err.message };
  }
};

export const checkout = async (showId, userId, idempotencyKey, guestName, guestMobile, guestEmail) => {
  const result = checkoutTxn(showId, userId, idempotencyKey, guestName, guestMobile, guestEmail);

  if (!result.replayed) {
    publishSeatChanges(showId, result.seatIds.map((id) => ({ id, status: 'booked', holdExpiresAt: null })));
    await issueTicket(result.bookingId);
  }
  return getBooking(result.bookingId, userId);
};

export const claimWaitlistOffer = async (token, userId) => {
  const result = claimTxn(token, userId);
  publishSeatChanges(result.showId, result.seatIds.map((id) => ({ id, status: 'booked', holdExpiresAt: null })));
  await issueTicket(result.bookingId);
  return getBooking(result.bookingId, userId);
};

// --- Cancellation ---------------------------------------------------------

const cancelTxn = writeTxn((bookingId, userId) => {
  const booking = db
    .prepare(`SELECT b.id, b.status, b.user_id AS userId, b.show_id AS showId, sh.starts_at AS startsAt
                FROM bookings b JOIN shows sh ON sh.id = b.show_id WHERE b.id = ?`)
    .get(bookingId);

  if (!booking || booking.userId !== userId) throw notFound('Booking not found.');
  if (booking.status === 'cancelled') throw conflict('That booking is already cancelled.', 'already_cancelled');
  if (new Date(booking.startsAt).getTime() <= Date.now()) {
    throw conflict('This show has already started, so it can no longer be cancelled.', 'show_started');
  }

  db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?").run(bookingId);

  const seats = db.prepare('SELECT show_seat_id AS seatId FROM booking_seats WHERE booking_id = ? AND released_at IS NULL').all(bookingId);
  db.prepare("UPDATE booking_seats SET released_at = datetime('now') WHERE booking_id = ?").run(bookingId);

  const changes = [];
  const offers = [];

  for (const { seatId } of seats) {
    // This is the waitlist hand-off: a cancelled seat goes to whoever is next
    // in the queue for its category before it returns to the open map.
    const result = offerFreedSeat(seatId);
    if (result.change) changes.push(result.change);
    if (result.offer) offers.push(result.offer);
  }

  return { showId: booking.showId, changes, offers };
});

export const cancelBooking = async (bookingId, userId) => {
  const { showId, changes, offers } = cancelTxn(bookingId, userId);
  publishSeatChanges(showId, changes);
  await deliverOffers(offers);
  return { cancelled: true, seatsReoffered: offers.length };
};

// --- Reads ----------------------------------------------------------------

const bookingBase = `
  SELECT b.id, b.reference, b.amount, b.status, b.source, b.created_at AS createdAt,
         b.cancelled_at AS cancelledAt, b.show_id AS showId,
         b.guest_name AS guestName, b.guest_mobile AS guestMobile, b.guest_email AS guestEmail,
         sh.starts_at AS startsAt, e.title, e.kind,
         v.name AS venueName, v.city AS venueCity
    FROM bookings b
    JOIN shows sh ON sh.id = b.show_id
    JOIN events e ON e.id = sh.event_id
    JOIN venues v ON v.id = sh.venue_id
`;

const withSeats = (row) => {
  if (!row) return null;
  const seats = seatLines.all(row.id).map((s) => ({
    label: `${s.row_label}${s.seat_number}`,
    category: s.category,
    price: s.price,
  }));
  return { ...row, seats };
};

export const getBooking = (bookingId, userId) => {
  const row = db.prepare(`${bookingBase} WHERE b.id = ? AND b.user_id = ?`).get(bookingId, userId);
  if (!row) throw notFound('Booking not found.');
  return withSeats(row);
};

export const listBookings = (userId) =>
  db.prepare(`${bookingBase} WHERE b.user_id = ? ORDER BY b.id DESC`).all(userId).map(withSeats);
