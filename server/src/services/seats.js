import { config } from '../config.js';
import { db, writeTxn } from '../db/index.js';
import { conflict, notFound } from '../lib/http.js';
import { publishSeatChanges } from './realtime.js';
import { deliverOffers, offerFreedSeat } from './waitlist.js';

/**
 * Reads the seat map as the given viewer should see it.
 *
 * A hold that is past its expiry is reported as available even before the
 * sweeper has rewritten the row, so the map never shows a seat as taken when
 * the next hold attempt would succeed.
 */
export const readSeatMap = async (showId, viewerId = null) => {
  const now = Date.now();

  const res = await db.query(
    `SELECT ss.id, ss.status, ss.price, ss.held_by AS "heldBy", ss.hold_expires_at AS "holdExpiresAt",
            ss.hold_kind AS "holdKind", ss.category_id AS "categoryId",
            s.row_label AS "rowLabel", s.seat_number AS "seatNumber",
            c.name AS category
       FROM show_seats ss
       JOIN seats s      ON s.id = ss.seat_id
       JOIN categories c ON c.id = ss.category_id
      WHERE ss.show_id = $1
      ORDER BY s.row_label, s.seat_number`,
    [showId]
  );

  return res.rows.map((seat) => {
    const stale = seat.status === 'held' && seat.holdExpiresAt <= now;
    const status = stale ? 'available' : seat.status;

    return {
      id: seat.id,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
      label: `${seat.rowLabel}${seat.seatNumber}`,
      categoryId: seat.categoryId,
      category: seat.category,
      price: seat.price,
      status,
      // Only the holder learns the expiry; other viewers just see "held".
      heldByMe: status === 'held' && seat.heldBy === viewerId,
      holdExpiresAt: status === 'held' && seat.heldBy === viewerId ? seat.holdExpiresAt : null,
      holdKind: status === 'held' && seat.heldBy === viewerId ? seat.holdKind : null,
    };
  });
};

export const categorySummary = async (showId) => {
  const res = await db.query(
    `SELECT c.id AS "categoryId", c.name AS category, sp.price,
            COUNT(*)::int AS total,
            SUM(CASE WHEN ss.status = 'available'
                      OR (ss.status = 'held' AND ss.hold_expires_at <= $1) THEN 1 ELSE 0 END)::int AS available
       FROM show_seats ss
       JOIN categories c  ON c.id = ss.category_id
       LEFT JOIN show_prices sp ON sp.show_id = ss.show_id AND sp.category_id = ss.category_id
      WHERE ss.show_id = $2
      GROUP BY c.id, c.name, sp.price
      ORDER BY sp.price DESC`,
    [Date.now(), showId]
  );
  return res.rows;
};

// --- Holding --------------------------------------------------------------

const MAX_SEATS_PER_HOLD = 8;

const holdTxn = writeTxn(async (client, showId, userId, seatIds) => {
  const now = Date.now();
  const expiresAt = now + config.holdTtlSeconds * 1000;
  const changes = [];

  // Consistent lock ordering: sort seat IDs ascending and lock rows with FOR UPDATE.
  // Prevents deadlocks when concurrent users race for overlapping seat batches.
  const sortedSeatIds = [...seatIds].sort((a, b) => a - b);
  const lockedRows = await client.query(
    `SELECT id, status, held_by AS "heldBy", hold_kind AS "holdKind",
            hold_expires_at AS "holdExpiresAt", price
       FROM show_seats
      WHERE show_id = $1 AND id = ANY($2::int[])
      ORDER BY id
        FOR UPDATE`,
    [showId, sortedSeatIds]
  );

  const lockedMap = new Map(lockedRows.rows.map((r) => [r.id, r]));

  for (const seatId of seatIds) {
    // Conditional UPDATE is the compare-and-swap:
    const updateRes = await client.query(
      `UPDATE show_seats
          SET status = 'held', held_by = $1, hold_expires_at = $2, hold_kind = 'checkout'
        WHERE id = $3 AND show_id = $4
          AND (status = 'available'
               OR (status = 'held' AND hold_kind = 'checkout' AND hold_expires_at <= $5))`,
      [userId, expiresAt, seatId, showId, now]
    );

    if (updateRes.rowCount === 1) {
      changes.push({ id: seatId, status: 'held', holdExpiresAt: expiresAt });
      continue;
    }

    const current = lockedMap.get(seatId);
    if (!current) throw notFound(`Seat ${seatId} is not part of this show.`);

    if (current.status === 'held' && current.heldBy === userId) continue; // already ours and live

    // Abandoning the whole selection is kinder than half-holding it, and the
    // throw rolls back every seat claimed earlier in this transaction.
    throw conflict(
      current.status === 'booked'
        ? 'One of those seats has just been booked. Pick another.'
        : 'One of those seats has just been taken by someone else. Pick another.',
      current.status === 'booked' ? 'seat_booked' : 'seat_held'
    );
  }

  const heldRes = await client.query(
    `SELECT id, price FROM show_seats
      WHERE show_id = $1 AND held_by = $2 AND status = 'held' AND hold_kind = 'checkout'`,
    [showId, userId]
  );
  const held = heldRes.rows;

  return {
    changes,
    expiresAt,
    seatIds: held.map((s) => s.id),
    total: held.reduce((sum, s) => sum + s.price, 0),
  };
});

export const holdSeats = async (showId, userId, seatIds) => {
  const unique = [...new Set(seatIds.map(Number))].filter(Number.isInteger);
  if (unique.length === 0) throw conflict('Select at least one seat.', 'no_seats');
  if (unique.length > MAX_SEATS_PER_HOLD) {
    throw conflict(`You can hold at most ${MAX_SEATS_PER_HOLD} seats at a time.`, 'too_many_seats');
  }

  const result = await holdTxn(showId, userId, unique);
  publishSeatChanges(showId, result.changes);

  return {
    seatIds: result.seatIds,
    holdExpiresAt: result.expiresAt,
    holdTtlSeconds: config.holdTtlSeconds,
    total: Number(result.total.toFixed(2)),
  };
};

const releaseTxn = writeTxn(async (client, showId, userId, seatIds) => {
  const query = seatIds?.length
    ? `SELECT id, category_id AS "categoryId" FROM show_seats
        WHERE show_id = $1 AND held_by = $2 AND status = 'held' AND hold_kind = 'checkout'
          AND id = ANY($3::int[])`
    : `SELECT id, category_id AS "categoryId" FROM show_seats
        WHERE show_id = $1 AND held_by = $2 AND status = 'held' AND hold_kind = 'checkout'`;
  const params = seatIds?.length ? [showId, userId, seatIds] : [showId, userId];
  const target = (await client.query(query, params)).rows;

  const changes = [];
  const offers = [];

  for (const seat of target) {
    const result = await offerFreedSeat(client, seat.id);
    if (result.change) changes.push(result.change);
    if (result.offer) offers.push(result.offer);
  }

  return { changes, offers, released: target.length };
});

/** Gives up this customer's checkout holds, e.g. when they leave the page. */
export const releaseHeldSeats = async (showId, userId, seatIds = []) => {
  const { changes, offers, released } = await releaseTxn(showId, userId, seatIds.map(Number).filter(Number.isInteger));
  publishSeatChanges(showId, changes);
  await deliverOffers(offers);
  return { released };
};

export const activeHold = async (showId, userId) => {
  const res = await db.query(
    `SELECT id, price, hold_expires_at AS "holdExpiresAt" FROM show_seats
      WHERE show_id = $1 AND held_by = $2 AND status = 'held'
        AND hold_kind = 'checkout' AND hold_expires_at > $3`,
    [showId, userId, Date.now()]
  );
  const rows = res.rows;

  if (rows.length === 0) return null;
  return {
    seatIds: rows.map((r) => r.id),
    holdExpiresAt: Math.min(...rows.map((r) => r.holdExpiresAt)),
    total: Number(rows.reduce((sum, r) => sum + r.price, 0).toFixed(2)),
  };
};

// --- Expiry sweep ---------------------------------------------------------

/**
 * Releases abandoned checkout holds. Each freed seat is offered to the waitlist
 * first so a queue is never bypassed by whoever refreshes the page fastest.
 */
export const expireHoldsTxn = writeTxn(async (client, now = Date.now()) => {
  const res = await client.query(
    `SELECT id, show_id AS "showId" FROM show_seats
      WHERE status = 'held' AND hold_kind = 'checkout' AND hold_expires_at <= $1
      ORDER BY id
        FOR UPDATE`,
    [now]
  );
  const changes = [];
  const offers = [];

  for (const seat of res.rows) {
    const result = await offerFreedSeat(client, seat.id);
    if (result.change) changes.push({ showId: seat.showId, ...result.change });
    if (result.offer) offers.push(result.offer);
  }

  return { changes, offers };
});
