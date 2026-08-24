import { config } from '../config.js';
import { publishSeatChanges } from './realtime.js';
import { expireHoldsTxn } from './seats.js';
import { deliverOffers, expireOffersTxn } from './waitlist.js';

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
 * Expiry is also evaluated on read (see readSeatMap) and on write (the
 * conditional UPDATEs in the hold and checkout paths), so correctness never
 * depends on this timer having run recently. The sweep exists to push updates
 * out to watching browsers and to keep the stored rows tidy.
 */
export const runSweep = async () => {
  const now = Date.now();

  const holds = expireHoldsTxn(now);
  const offers = expireOffersTxn(now);

  publishGrouped([...holds.changes, ...offers.changes]);
  await deliverOffers([...holds.offers, ...offers.offers]);

  return { holdsReleased: holds.changes.length, offersExpired: offers.changes.length };
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
