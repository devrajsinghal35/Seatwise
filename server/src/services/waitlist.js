import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db, writeTxn } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { sendWaitlistOfferEmail } from './mailer.js';
import { publishSeatChanges } from './realtime.js';

/**
 * Hands a freed seat to the next person queued for its category, or returns it
 * to general availability when nobody is waiting.
 *
 * Must run inside a write transaction. Side effects the caller has to perform
 * after the commit are returned rather than done here, so a rolled-back
 * transaction can never leave an email already sent.
 */
export const offerFreedSeat = async (client, seatId) => {
  const seatRes = await client.query(
    `SELECT ss.id, ss.show_id, ss.category_id, ss.price,
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
      WHERE ss.id = $1`,
    [seatId]
  );
  const seat = seatRes.rows[0];
  if (!seat) return { change: null, offer: null };

  const candidateRes = await client.query(
    `SELECT w.id, w.user_id, u.email
       FROM waitlist w
       JOIN users u ON u.id = w.user_id
      WHERE w.show_id = $1 AND w.category_id = $2 AND w.status = 'waiting'
      ORDER BY w.id
      LIMIT 1
      FOR UPDATE OF w`,
    [seat.show_id, seat.category_id]
  );
  const candidate = candidateRes.rows[0];

  if (!candidate) {
    await client.query(
      `UPDATE show_seats
          SET status = 'available', held_by = NULL, hold_expires_at = NULL, hold_kind = NULL
        WHERE id = $1`,
      [seatId]
    );
    return {
      change: { id: seat.id, status: 'available', holdExpiresAt: null },
      offer: null,
    };
  }

  const token = randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + config.offerTtlSeconds * 1000;

  // If a concurrent writer already claimed this queue entry, fall back to
  // simply freeing the seat rather than double-offering it.
  const markRes = await client.query(
    `UPDATE waitlist
        SET status = 'offered', offer_seat_id = $1, offer_token = $2, offer_expires_at = $3
      WHERE id = $4 AND status = 'waiting'`,
    [seatId, token, expiresAt, candidate.id]
  );

  if (markRes.rowCount !== 1) {
    await client.query(
      `UPDATE show_seats
          SET status = 'available', held_by = NULL, hold_expires_at = NULL, hold_kind = NULL
        WHERE id = $1`,
      [seatId]
    );
    return { change: { id: seat.id, status: 'available', holdExpiresAt: null }, offer: null };
  }

  await client.query(
    `UPDATE show_seats
        SET status = 'held', held_by = $1, hold_expires_at = $2, hold_kind = 'offer'
      WHERE id = $3`,
    [candidate.user_id, expiresAt, seatId]
  );

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

const joinTxn = writeTxn(async (client, showId, categoryId, userId) => {
  const showRes = await client.query('SELECT id FROM shows WHERE id = $1', [showId]);
  if (!showRes.rows[0]) throw notFound('Show not found.');

  const categoryRes = await client.query(
    'SELECT id FROM show_seats WHERE show_id = $1 AND category_id = $2 LIMIT 1',
    [showId, categoryId]
  );
  if (!categoryRes.rows[0]) throw badRequest('That seat category is not part of this show.');

  // A waitlist only makes sense once nothing in the category can be booked.
  // Expired holds count as free, so a stale hold cannot fake a sold-out house.
  const availRes = await client.query(
    `SELECT COUNT(*) AS n FROM show_seats
      WHERE show_id = $1 AND category_id = $2
        AND (status = 'available' OR (status = 'held' AND hold_kind = 'checkout' AND hold_expires_at <= $3))`,
    [showId, categoryId, Date.now()]
  );
  const n = parseInt(availRes.rows[0]?.n ?? 0, 10);
  if (n > 0) throw conflict('Seats are still available in this category.', 'seats_available');

  const existingRes = await client.query(
    `SELECT id, status FROM waitlist
       WHERE show_id = $1 AND category_id = $2 AND user_id = $3
         AND status IN ('waiting', 'offered')`,
    [showId, categoryId, userId]
  );
  if (existingRes.rows[0]) return { ...existingRes.rows[0], alreadyQueued: true };

  const insertRes = await client.query(
    'INSERT INTO waitlist (show_id, category_id, user_id) VALUES ($1, $2, $3) RETURNING id',
    [showId, categoryId, userId]
  );

  return { id: insertRes.rows[0].id, status: 'waiting', alreadyQueued: false };
});

const positionOf = async (entryId) => {
  const res = await db.query(
    `SELECT COUNT(*) AS ahead FROM waitlist w
       JOIN waitlist me ON me.id = $1
      WHERE w.show_id = me.show_id AND w.category_id = me.category_id
        AND w.status = 'waiting' AND w.id < me.id`,
    [entryId]
  );
  const ahead = parseInt(res.rows[0]?.ahead ?? 0, 10);
  return ahead + 1;
};

export const joinWaitlist = async (showId, categoryId, userId) => {
  const entry = await joinTxn(showId, categoryId, userId);
  return { ...entry, position: await positionOf(entry.id) };
};

export const listWaitlistForUser = async (userId) => {
  const res = await db.query(
    `SELECT w.id, w.status, w.offer_expires_at AS "offerExpiresAt", w.offer_token AS "offerToken",
            c.name AS category, e.title, sh.starts_at AS "startsAt", sh.id AS "showId",
            v.name AS "venueName"
       FROM waitlist w
       JOIN categories c ON c.id = w.category_id
       JOIN shows sh     ON sh.id = w.show_id
       JOIN events e     ON e.id = sh.event_id
       JOIN venues v     ON v.id = sh.venue_id
      WHERE w.user_id = $1 AND w.status IN ('waiting', 'offered')
      ORDER BY w.id DESC`,
    [userId]
  );

  const entries = [];
  for (const row of res.rows) {
    const position = row.status === 'waiting' ? await positionOf(row.id) : null;
    entries.push({ ...row, position });
  }
  return entries;
};

const leaveTxn = writeTxn(async (client, entryId, userId) => {
  const entryRes = await client.query('SELECT * FROM waitlist WHERE id = $1 FOR UPDATE', [entryId]);
  const entry = entryRes.rows[0];
  if (!entry) throw notFound('Waitlist entry not found.');
  if (entry.user_id !== userId) throw notFound('Waitlist entry not found.');
  if (!['waiting', 'offered'].includes(entry.status)) {
    throw conflict('That waitlist entry is no longer active.', 'not_active');
  }

  await client.query(
    `UPDATE waitlist
        SET status = 'cancelled', offer_token = NULL, offer_expires_at = NULL, offer_seat_id = NULL
      WHERE id = $1`,
    [entryId]
  );

  // Giving up a live offer must pass the seat straight to the next person.
  if (entry.status === 'offered' && entry.offer_seat_id) {
    const handoff = await offerFreedSeat(client, entry.offer_seat_id);
    return { showId: entry.show_id, ...handoff };
  }
  return { showId: entry.show_id, change: null, offer: null };
});

export const leaveWaitlist = async (entryId, userId) => {
  const { showId, change, offer } = await leaveTxn(entryId, userId);
  if (change) publishSeatChanges(showId, [change]);
  await deliverOffers([offer]);
  return { ok: true };
};

// --- Offer claim ----------------------------------------------------------

export const readOffer = async (token) => {
  const res = await db.query(
    `SELECT w.id, w.status, w.offer_expires_at AS "expiresAt", w.user_id AS "userId",
            ss.id AS "showSeatId", ss.price, ss.show_id AS "showId",
            s.row_label AS "rowLabel", s.seat_number AS "seatNumber",
            c.name AS category, e.title, e.kind, sh.starts_at AS "startsAt",
            v.name AS "venueName", v.city AS "venueCity"
       FROM waitlist w
       JOIN show_seats ss ON ss.id = w.offer_seat_id
       JOIN seats s       ON s.id = ss.seat_id
       JOIN categories c  ON c.id = ss.category_id
       JOIN shows sh      ON sh.id = ss.show_id
       JOIN events e      ON e.id = sh.event_id
       JOIN venues v      ON v.id = sh.venue_id
      WHERE w.offer_token = $1`,
    [token]
  );

  const row = res.rows[0];
  if (!row) throw notFound('That offer link is not valid.', 'offer_not_found');
  return { ...row, expired: row.status !== 'offered' || row.expiresAt <= Date.now() };
};

// --- Expiry sweep ---------------------------------------------------------

/**
 * Expires offers nobody claimed and passes each seat down the queue.
 * Returns the SSE changes and emails for the caller to flush after commit.
 */
export const expireOffersTxn = writeTxn(async (client, now = Date.now()) => {
  const changes = [];
  const offers = [];

  const expiredRes = await client.query(
    `SELECT id, offer_seat_id, show_id FROM waitlist
      WHERE status = 'offered' AND offer_expires_at <= $1
      ORDER BY id
      FOR UPDATE`,
    [now]
  );

  for (const row of expiredRes.rows) {
    const updateRes = await client.query(
      `UPDATE waitlist
          SET status = 'expired', offer_token = NULL, offer_expires_at = NULL
        WHERE id = $1 AND status = 'offered'`,
      [row.id]
    );
    if (updateRes.rowCount !== 1) continue; // another sweep won
    const result = await offerFreedSeat(client, row.offer_seat_id);
    if (result.change) changes.push({ showId: row.show_id, ...result.change });
    if (result.offer) offers.push(result.offer);
  }

  return { changes, offers };
});
