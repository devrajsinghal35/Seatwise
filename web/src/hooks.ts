import { useEffect, useRef, useState } from 'react';

/** Milliseconds left until `target`, refreshed every second. Null target stops the clock. */
export const useCountdown = (target: number | null) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return;
    setNow(Date.now());

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [target]);

  // Derived from the target on every render rather than held in state. Storing
  // the remaining time left it one render behind, so a target that had just
  // been set still read as zero and looked like it had already elapsed.
  return target ? Math.max(0, target - now) : 0;
};

export interface SeatChange {
  id: number;
  status: 'available' | 'held' | 'booked';
  holdExpiresAt: number | null;
}

/**
 * Subscribes to the show's seat stream and hands each batch of changes to the
 * caller. EventSource reconnects on its own if the connection drops.
 */
export const useSeatStream = (showId: number | null, onChanges: (changes: SeatChange[]) => void) => {
  const handler = useRef(onChanges);
  handler.current = onChanges;

  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!showId) return;

    const source = new EventSource(`/api/shows/${showId}/stream`);

    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('error', () => setConnected(false));
    source.addEventListener('seats', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { seats: SeatChange[] };
        handler.current(payload.seats);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    });

    return () => source.close();
  }, [showId]);

  return connected;
};
