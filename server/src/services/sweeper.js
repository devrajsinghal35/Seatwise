import { config } from '../config.js';
import { getPool } from '../db/index.js';
import { publishSeatChanges } from './realtime.js';
import { expireHoldsTxn } from './seats.js';
import { deliverOffers, expireOffersTxn } from './waitlist.js';

// Dedicated 32-bit integer key for Postgres advisory lock to ensure only one sweeper runs across instances
export const SWEEPER_LOCK_KEY = 847291038;

const publishGrouped = (changes) => {
  const byShow = new Map();
  for (const { showId, ...change } of changes) {
    const list = byShow.get(showId) ?? [];
    list.push(change);
    byShow.set(showId, list);
  }
  for (const [showId, list] of byShow) publishSeatChanges(showId, list);
};

/**
 * One pass of the expiry work: abandoned checkout holds are released and
 * unclaimed waitlist offers move down the queue.
 *
 * Safe across multiple instances via PostgreSQL advisory locking (pg_try_advisory_lock).
 *
 * Expiry is also evaluated on read (see readSeatMap) and on write (the
 * conditional UPDATEs in the hold and checkout paths), so correctness never
 * depends on this timer having run recently. The sweep exists to push updates
 * out to watching browsers and to keep the stored rows tidy.
 */
export const runSweep = async () => {
  const client = await getPool().connect();
  let locked = false;
  try {
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [SWEEPER_LOCK_KEY]);
    locked = lockRes.rows[0]?.locked === true;
    if (!locked) {
      return { skipped: true, holdsReleased: 0, offersExpired: 0 };
    }

    const now = Date.now();

    const holds = await expireHoldsTxn(now);
    const offers = await expireOffersTxn(now);

    publishGrouped([...holds.changes, ...offers.changes]);
    await deliverOffers([...holds.offers, ...offers.offers]);

    return { holdsReleased: holds.changes.length, offersExpired: offers.changes.length };
  } finally {
    try {
      if (locked) {
        await client.query('SELECT pg_advisory_unlock($1)', [SWEEPER_LOCK_KEY]);
      }
    } catch (err) {
      console.error('Failed to release sweeper advisory lock:', err.message);
    }
    client.release();
  }
};

export const startSweeper = () => {
  const tick = () => {
    runSweep().catch((err) => console.error('sweep failed:', err.message));
  };

  const timer = setInterval(tick, config.sweepIntervalSeconds * 1000);
  timer.unref(); // never hold the process open just for the sweeper
  tick();
  return timer;
};
