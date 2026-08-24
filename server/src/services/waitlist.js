import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db, writeTxn } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { sendWaitlistOfferEmail } from './mailer.js';
import { publishSeatChanges } from './realtime.js';

const seatDetail = db.prepare(`
  SELECT ss.id, ss.show_id, ss.category_id, ss.price,
         s.row_label, s.seat_number,
         c.name AS category,
         e.title, e.kind,
         sh.starts_at,
         v.name AS venue_name, v.city AS venue_city
    FROM show_seats ss
    JOIN seats s      ON s.id = ss.seat_id
    JOIN categories c ON c.id = ss.category_id
    JOIN shows sh     ON sh.id = ss.show_id
    JOIN events e     ON e.id = sh.event_id
    JOIN venues v     ON v.id = sh.venue_id
   WHERE ss.id = ?
`);

const nextInQueue = db.prepare(`
  SELECT w.id, w.user_id, u.email
    FROM waitlist w
    JOIN users u ON u.id = w.user_id
   WHERE w.show_id = ? AND w.category_id = ? AND w.status = 'waiting'
   ORDER BY w.id
   LIMIT 1
`);

const markOffered = db.prepare(`
  UPDATE waitlist
     SET status = 'offered', offer_seat_id = ?, offer_token = ?, offer_expires_at = ?
   WHERE id = ? AND status = 'waiting'
`);

const holdForOffer = db.prepare(`
  UPDATE show_seats
     SET status = 'held', held_by = ?, hold_expires_at = ?, hold_kind = 'offer'
   WHERE id = ?
`);

const freeSeat = db.prepare(`
  UPDATE show_seats
     SET status = 'available', held_by = NULL, hold_expires_at = NULL, hold_kind = NULL
   WHERE id = ?
`);

const availableInCategory = db.prepare(`
  SELECT COUNT(*) AS n FROM show_seats
   WHERE show_id = ? AND category_id = ?
     AND (status = 'available' OR (status = 'held' AND hold_kind = 'checkout' AND hold_expires_at <= ?))
`);

/**
 * Hands a freed seat to the next person queued for its category, or returns it
 * to general availability when nobody is waiting.
 *
 * Must run inside a write transaction. Side effects the caller has to perform
 * after the commit are returned rather than done here, so a rolled-back
 * transaction can never leave an email already sent.
 */
export const offerFreedSeat = (seatId) => {
  const seat = seatDetail.get(seatId);
  if (!seat) return { change: null, offer: null };

  const candidate = nextInQueue.get(seat.show_id, seat.category_id);

  if (!candidate) {
    freeSeat.run(seatId);
    return {
      change: { id: seat.id, status: 'available', holdExpiresAt: null },
      offer: null,
    };
  }

  const token = randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + config.offerTtlSeconds * 1000;

  // If a concurrent writer already claimed this queue entry, fall back to
  // simply freeing the seat rather than double-offering it.
  if (markOffered.run(seatId, token, expiresAt, candidate.id).changes !== 1) {
    freeSeat.run(seatId);
    return { change: { id: seat.id, status: 'available', holdExpiresAt: null }, offer: null };
  }

  holdForOffer.run(candidate.user_id, expiresAt, seatId);

  return {
    change: { id: seat.id, status: 'held', holdExpiresAt: expiresAt },
    offer: {
      to: candidate.email,
      show: seat,
      seat,
      claimUrl: `${config.publicUrl}/offer/${token}`,
      expiresAt,
    },
  };
};

/** Sends the offer emails a transaction produced. Safe to call with an empty list. */
export const deliverOffers = async (offers) => {
  for (const offer of offers.filter(Boolean)) {
    await sendWaitlistOfferEmail(offer);
  }
};

// --- Customer-facing operations -------------------------------------------

const joinTxn = writeTxn((showId, categoryId, userId) => {
  const show = db.prepare('SELECT id FROM shows WHERE id = ?').get(showId);
  if (!show) throw notFound('Show not found.');

  const category = db
    .prepare('SELECT id FROM show_seats WHERE show_id = ? AND category_id = ? LIMIT 1')
    .get(showId, categoryId);
  if (!category) throw badRequest('That seat category is not part of this show.');

  // A waitlist only makes sense once nothing in the category can be booked.
  // Expired holds count as free, so a stale hold cannot fake a sold-out house.
  const { n } = availableInCategory.get(showId, categoryId, Date.now());
  if (n > 0) throw conflict('Seats are still available in this category.', 'seats_available');

  const existing = db
    .prepare(`SELECT id, status FROM waitlist
               WHERE show_id = ? AND category_id = ? AND user_id = ?
                 AND status IN ('waiting', 'offered')`)
    .get(showId, categoryId, userId);
  if (existing) return { ...existing, alreadyQueued: true };

  const { lastInsertRowid } = db
    .prepare('INSERT INTO waitlist (show_id, category_id, user_id) VALUES (?, ?, ?)')
    .run(showId, categoryId, userId);

  return { id: Number(lastInsertRowid), status: 'waiting', alreadyQueued: false };
});

export const joinWaitlist = (showId, categoryId, userId) => {
  const entry = joinTxn(showId, categoryId, userId);
  return { ...entry, position: positionOf(entry.id) };
};

const positionOf = (entryId) => {
  const row = db
    .prepare(`SELECT COUNT(*) AS ahead FROM waitlist w
               JOIN waitlist me ON me.id = ?
              WHERE w.show_id = me.show_id AND w.category_id = me.category_id
                AND w.status = 'waiting' AND w.id < me.id`)
    .get(entryId);
  return (row?.ahead ?? 0) + 1;
};

export const listWaitlistForUser = (userId) =>
  db
    .prepare(`SELECT w.id, w.status, w.offer_expires_at AS offerExpiresAt, w.offer_token AS offerToken,
                     c.name AS category, e.title, sh.starts_at AS startsAt, sh.id AS showId,
                     v.name AS venueName
                FROM waitlist w
                JOIN categories c ON c.id = w.category_id
                JOIN shows sh     ON sh.id = w.show_id
                JOIN events e     ON e.id = sh.event_id
                JOIN venues v     ON v.id = sh.venue_id
               WHERE w.user_id = ? AND w.status IN ('waiting', 'offered')
               ORDER BY w.id DESC`)
    .all(userId)
    .map((row) => ({ ...row, position: row.status === 'waiting' ? positionOf(row.id) : null }));

const leaveTxn = writeTxn((entryId, userId) => {
  const entry = db.prepare('SELECT * FROM waitlist WHERE id = ?').get(entryId);
  if (!entry) throw notFound('Waitlist entry not found.');
  if (entry.user_id !== userId) throw notFound('Waitlist entry not found.');
  if (!['waiting', 'offered'].includes(entry.status)) {
    throw conflict('That waitlist entry is no longer active.', 'not_active');
  }

  db.prepare(`UPDATE waitlist
                 SET status = 'cancelled', offer_token = NULL, offer_expires_at = NULL, offer_seat_id = NULL
               WHERE id = ?`).run(entryId);

  // Giving up a live offer must pass the seat straight to the next person.
  if (entry.status === 'offered' && entry.offer_seat_id) {
    return { showId: entry.show_id, ...offerFreedSeat(entry.offer_seat_id) };
  }
  return { showId: entry.show_id, change: null, offer: null };
});

export const leaveWaitlist = async (entryId, userId) => {
  const { showId, change, offer } = leaveTxn(entryId, userId);
  if (change) publishSeatChanges(showId, [change]);
  await deliverOffers([offer]);
  return { ok: true };
};

// --- Offer claim ----------------------------------------------------------

export const readOffer = (token) => {
  const row = db
    .prepare(`SELECT w.id, w.status, w.offer_expires_at AS expiresAt, w.user_id AS userId,
                     ss.id AS showSeatId, ss.price, ss.show_id AS showId,
                     s.row_label AS rowLabel, s.seat_number AS seatNumber,
                     c.name AS category, e.title, e.kind, sh.starts_at AS startsAt,
                     v.name AS venueName, v.city AS venueCity
                FROM waitlist w
                JOIN show_seats ss ON ss.id = w.offer_seat_id
                JOIN seats s       ON s.id = ss.seat_id
                JOIN categories c  ON c.id = ss.category_id
                JOIN shows sh      ON sh.id = ss.show_id
                JOIN events e      ON e.id = sh.event_id
                JOIN venues v      ON v.id = sh.venue_id
               WHERE w.offer_token = ?`)
    .get(token);

  if (!row) throw notFound('That offer link is not valid.', 'offer_not_found');
  return { ...row, expired: row.status !== 'offered' || row.expiresAt <= Date.now() };
};

// --- Expiry sweep ---------------------------------------------------------

const expiredOffers = db.prepare(`
  SELECT id, offer_seat_id, show_id FROM waitlist
   WHERE status = 'offered' AND offer_expires_at <= ?
   ORDER BY id
`);

const expireOfferRow = db.prepare(`
  UPDATE waitlist
     SET status = 'expired', offer_token = NULL, offer_expires_at = NULL
   WHERE id = ? AND status = 'offered'
`);

/**
 * Expires offers nobody claimed and passes each seat down the queue.
 * Returns the SSE changes and emails for the caller to flush after commit.
 */
export const expireOffersTxn = writeTxn((now = Date.now()) => {
  const changes = [];
  const offers = [];

  for (const row of expiredOffers.all(now)) {
    if (expireOfferRow.run(row.id).changes !== 1) continue; // another sweep won
    const result = offerFreedSeat(row.offer_seat_id);
    if (result.change) changes.push({ showId: row.show_id, ...result.change });
    if (result.offer) offers.push(result.offer);
  }

  return { changes, offers };
});
