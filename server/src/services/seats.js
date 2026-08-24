import { config } from '../config.js';
import { db, writeTxn } from '../db/index.js';
import { conflict, notFound } from '../lib/http.js';
import { publishSeatChanges } from './realtime.js';
import { deliverOffers, offerFreedSeat } from './waitlist.js';

const seatRows = db.prepare(`
  SELECT ss.id, ss.status, ss.price, ss.held_by AS heldBy, ss.hold_expires_at AS holdExpiresAt,
         ss.hold_kind AS holdKind, ss.category_id AS categoryId,
         s.row_label AS rowLabel, s.seat_number AS seatNumber,
         c.name AS category
    FROM show_seats ss
    JOIN seats s      ON s.id = ss.seat_id
    JOIN categories c ON c.id = ss.category_id
   WHERE ss.show_id = ?
   ORDER BY s.row_label, s.seat_number
`);

/**
 * Reads the seat map as the given viewer should see it.
 *
 * A hold that is past its expiry is reported as available even before the
 * sweeper has rewritten the row, so the map never shows a seat as taken when
 * the next hold attempt would succeed.
 */
export const readSeatMap = (showId, viewerId = null) => {
  const now = Date.now();

  return seatRows.all(showId).map((seat) => {
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

export const categorySummary = (showId) =>
  db
    .prepare(`SELECT c.id AS categoryId, c.name AS category, sp.price,
                     COUNT(*) AS total,
                     SUM(CASE WHEN ss.status = 'available'
                               OR (ss.status = 'held' AND ss.hold_expires_at <= ?) THEN 1 ELSE 0 END) AS available
                FROM show_seats ss
                JOIN categories c  ON c.id = ss.category_id
                LEFT JOIN show_prices sp ON sp.show_id = ss.show_id AND sp.category_id = ss.category_id
               WHERE ss.show_id = ?
               GROUP BY c.id
               ORDER BY sp.price DESC`)
    .all(Date.now(), showId);

// --- Holding --------------------------------------------------------------

const seatForUpdate = db.prepare(
  'SELECT id, status, held_by AS heldBy, hold_kind AS holdKind, hold_expires_at AS holdExpiresAt, price FROM show_seats WHERE id = ? AND show_id = ?'
);

// A conditional UPDATE is the compare-and-swap: the row only moves to "held" if
// it is still free at write time, so a stale read can never win the seat.
const claimSeat = db.prepare(`
  UPDATE show_seats
     SET status = 'held', held_by = ?, hold_expires_at = ?, hold_kind = 'checkout'
   WHERE id = ? AND show_id = ?
     AND (status = 'available'
          OR (status = 'held' AND hold_kind = 'checkout' AND hold_expires_at <= ?))
`);

const MAX_SEATS_PER_HOLD = 8;

const holdTxn = writeTxn((showId, userId, seatIds) => {
  const now = Date.now();
  const expiresAt = now + config.holdTtlSeconds * 1000;
  const changes = [];

  for (const seatId of seatIds) {
    if (claimSeat.run(userId, expiresAt, seatId, showId, now).changes === 1) {
      changes.push({ id: seatId, status: 'held', holdExpiresAt: expiresAt });
      continue;
    }

    // The swap failed, so work out whether that is a genuine clash or just this
    // customer clicking the same seat twice.
    const current = seatForUpdate.get(seatId, showId);
    if (!current) throw notFound(`Seat ${seatId} is not part of this show.`);

    if (current.status === 'held' && current.heldBy === userId) continue; // already ours

    // Abandoning the whole selection is kinder than half-holding it, and the
    // throw rolls back every seat claimed earlier in this loop.
    throw conflict(
      current.status === 'booked'
        ? 'One of those seats has just been booked. Pick another.'
        : 'One of those seats has just been taken by someone else. Pick another.',
      current.status === 'booked' ? 'seat_booked' : 'seat_held'
    );
  }

  const held = db
    .prepare(`SELECT id, price FROM show_seats
               WHERE show_id = ? AND held_by = ? AND status = 'held' AND hold_kind = 'checkout'`)
    .all(showId, userId);

  return {
    changes,
    expiresAt,
    seatIds: held.map((s) => s.id),
    total: held.reduce((sum, s) => sum + s.price, 0),
  };
});

export const holdSeats = (showId, userId, seatIds) => {
  const unique = [...new Set(seatIds.map(Number))].filter(Number.isInteger);
  if (unique.length === 0) throw conflict('Select at least one seat.', 'no_seats');
  if (unique.length > MAX_SEATS_PER_HOLD) {
    throw conflict(`You can hold at most ${MAX_SEATS_PER_HOLD} seats at a time.`, 'too_many_seats');
  }

  const result = holdTxn(showId, userId, unique);
  publishSeatChanges(showId, result.changes);

  return {
    seatIds: result.seatIds,
    holdExpiresAt: result.expiresAt,
    holdTtlSeconds: config.holdTtlSeconds,
    total: Number(result.total.toFixed(2)),
  };
};

const releaseTxn = writeTxn((showId, userId, seatIds) => {
  const target = seatIds?.length
    ? db
        .prepare(`SELECT id, category_id FROM show_seats
                   WHERE show_id = ? AND held_by = ? AND status = 'held' AND hold_kind = 'checkout'
                     AND id IN (${seatIds.map(() => '?').join(',')})`)
        .all(showId, userId, ...seatIds)
    : db
        .prepare(`SELECT id, category_id FROM show_seats
                   WHERE show_id = ? AND held_by = ? AND status = 'held' AND hold_kind = 'checkout'`)
        .all(showId, userId);

  const changes = [];
  const offers = [];

  for (const seat of target) {
    // Someone may already be queued for this category, so the seat goes to the
    // front of that queue rather than straight back onto the map.
    const result = offerFreedSeat(seat.id);
    if (result.change) changes.push(result.change);
    if (result.offer) offers.push(result.offer);
  }

  return { changes, offers, released: target.length };
});

/** Gives up this customer's checkout holds, e.g. when they leave the page. */
export const releaseHeldSeats = async (showId, userId, seatIds = []) => {
  const { changes, offers, released } = releaseTxn(showId, userId, seatIds.map(Number).filter(Number.isInteger));
  publishSeatChanges(showId, changes);
  await deliverOffers(offers);
  return { released };
};

export const activeHold = (showId, userId) => {
  const rows = db
    .prepare(`SELECT id, price, hold_expires_at AS holdExpiresAt FROM show_seats
               WHERE show_id = ? AND held_by = ? AND status = 'held'
                 AND hold_kind = 'checkout' AND hold_expires_at > ?`)
    .all(showId, userId, Date.now());

  if (rows.length === 0) return null;
  return {
    seatIds: rows.map((r) => r.id),
    holdExpiresAt: Math.min(...rows.map((r) => r.holdExpiresAt)),
    total: Number(rows.reduce((sum, r) => sum + r.price, 0).toFixed(2)),
  };
};

// --- Expiry sweep ---------------------------------------------------------

const expiredHolds = db.prepare(`
  SELECT id, show_id AS showId FROM show_seats
   WHERE status = 'held' AND hold_kind = 'checkout' AND hold_expires_at <= ?
   ORDER BY id
`);

/**
 * Releases abandoned checkout holds. Each freed seat is offered to the waitlist
 * first so a queue is never bypassed by whoever refreshes the page fastest.
 */
export const expireHoldsTxn = writeTxn((now = Date.now()) => {
  const changes = [];
  const offers = [];

  for (const seat of expiredHolds.all(now)) {
    const result = offerFreedSeat(seat.id);
    if (result.change) changes.push({ showId: seat.showId, ...result.change });
    if (result.offer) offers.push(result.offer);
  }

  return { changes, offers };
});
