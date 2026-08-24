import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { useAuth } from '../auth';
import { Notice } from '../components/Notice';
import { SeatMap } from '../components/SeatMap';
import { formatCountdown, formatDateTime, formatMoney } from '../format';
import { useCountdown, useSeatStream } from '../hooks';
import type { Booking as BookingType, CategorySummary, Hold, Seat, SeatMap as SeatMapData, ShowDetail, WaitlistEntry } from '../types';

export const Booking = () => {
  const { showId: showIdParam } = useParams();
  const showId = Number(showIdParam);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [show, setShow] = useState<ShowDetail | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [priceList, setPriceList] = useState<CategorySummary[]>([]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [queue, setQueue] = useState<WaitlistEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [guestName, setGuestName] = useState('');
  const [guestMobile, setGuestMobile] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  // Reused across retries of the same checkout so a double submit cannot
  // produce two bookings.
  const checkoutKey = useRef<string>(crypto.randomUUID());

  const loadSeats = useCallback(async () => {
    const data = await api.get<SeatMapData>(`/shows/${showId}/seats`);
    setSeats(data.seats);
    setPriceList(data.categories);
    setHold(data.hold);
    setSelected(data.hold?.seatIds ?? []);
  }, [showId]);

  const loadQueue = useCallback(async () => {
    if (user?.role !== 'customer') return;
    const { entries } = await api.get<{ entries: WaitlistEntry[] }>('/waitlist');
    setQueue(entries.filter((entry) => entry.showId === showId));
  }, [showId, user?.role]);

  useEffect(() => {
    if (!Number.isInteger(showId)) return;

    api
      .get<{ show: ShowDetail }>(`/shows/${showId}`)
      .then(({ show: found }) => setShow(found))
      .catch(() => setError('That showing could not be found.'));

    loadSeats().catch(() => setError('Could not load the seat map.'));
    loadQueue().catch(() => undefined);
  }, [showId, loadSeats, loadQueue]);

  // Live updates from other customers, so the map changes under your cursor.
  const streaming = useSeatStream(Number.isInteger(showId) ? showId : null, (changes) => {
    setSeats((current) =>
      current.map((seat) => {
        const change = changes.find((c) => c.id === seat.id);
        if (!change) return seat;

        // The stream is broadcast to everyone, so it must not leak whose hold it
        // is; only a seat this browser already knows is ours stays ours.
        const stillMine = seat.heldByMe && change.status === 'held';
        return {
          ...seat,
          status: change.status,
          heldByMe: stillMine,
          holdExpiresAt: stillMine ? change.holdExpiresAt : null,
          holdKind: stillMine ? seat.holdKind : null,
        };
      })
    );
  });

  // Recounted from the seats currently on screen, so a streamed change updates
  // the availability figures and the sold-out list without another request.
  const categories = useMemo(
    () =>
      priceList.map((category) => ({
        ...category,
        available: seats.filter((seat) => seat.categoryId === category.categoryId && seat.status === 'available').length,
      })),
    [priceList, seats]
  );

  const remaining = useCountdown(hold?.holdExpiresAt ?? null);

  // Put the page back to a clean selecting state when the hold runs out. This
  // is scheduled from the expiry timestamp rather than watched through the
  // countdown value, so it cannot fire on the render that sets the hold.
  useEffect(() => {
    if (!hold) return;

    const expire = () => {
      setHold(null);
      setSelected([]);
      setInfo('Your seat hold expired, so the seats went back on sale.');
      loadSeats().catch(() => undefined);
    };

    const msLeft = hold.holdExpiresAt - Date.now();
    if (msLeft <= 0) {
      expire();
      return;
    }

    const timer = setTimeout(expire, msLeft);
    return () => clearTimeout(timer);
  }, [hold, loadSeats]);

  const toggleSeat = (seat: Seat) => {
    if (hold) return; // seats are locked in once a hold exists
    setError(null);
    setSelected((current) =>
      current.includes(seat.id) ? current.filter((id) => id !== seat.id) : [...current, seat.id]
    );
  };

  const selectedSeats = seats.filter((seat) => selected.includes(seat.id));
  const total = selectedSeats.reduce((sum, seat) => sum + seat.price, 0);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      if (err instanceof ApiError && ['seat_held', 'seat_booked', 'hold_expired'].includes(err.code)) {
        await loadSeats().catch(() => undefined);
        if (err.code === 'hold_expired') setHold(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const holdSeats = () =>
    run(async () => {
      const { hold: created } = await api.post<{ hold: Hold }>(`/shows/${showId}/hold`, { seatIds: selected });
      checkoutKey.current = crypto.randomUUID();
      setHold(created);
      await loadSeats();
    });

  const releaseSeats = () =>
    run(async () => {
      await api.del(`/shows/${showId}/hold`);
      setHold(null);
      setSelected([]);
      await loadSeats();
    });

  const confirmBooking = () =>
    run(async () => {
      const { booking } = await api.post<{ booking: BookingType }>('/bookings', { showId, guestName, guestMobile, guestEmail }, {
        'Idempotency-Key': checkoutKey.current,
      });
      navigate(`/bookings/${booking.id}`, { replace: true });
    });

  const joinWaitlist = (categoryId: number) =>
    run(async () => {
      await api.post(`/shows/${showId}/waitlist`, { categoryId });
      await loadQueue();
      setInfo('You are on the waitlist. We will email you if a seat frees up.');
    });

  if (error && !show) return <Notice kind="error">{error}</Notice>;
  if (!show) return <p className="muted">Loading...</p>;

  const signedInCustomer = user?.role === 'customer';
  const offered = queue.find((entry) => entry.status === 'offered');

  return (
    <>
      <Link className="back" to={`/events/${show.event.id}`}>
        Back to {show.event.title}
      </Link>

      <header className="show-header">
        <h1>{show.event.title}</h1>
        <p className="muted">
          {formatDateTime(show.startsAt)} · {show.venueName}, {show.venueCity}
          {streaming && <span className="live"> live</span>}
        </p>
      </header>

      {error && <Notice kind="error" onDismiss={() => setError(null)}>{error}</Notice>}
      {info && <Notice kind="info" onDismiss={() => setInfo(null)}>{info}</Notice>}

      {offered && (
        <Notice kind="success">
          A seat has been reserved for you from the waitlist.{' '}
          <Link to={`/offer/${offered.offerToken}`}>Claim it now</Link> before the offer expires.
        </Notice>
      )}

      {!user && (
        <Notice kind="info">
          <Link to="/signin">Sign in</Link> to hold and book seats.
        </Notice>
      )}

      <div className="booking-layout">
        <SeatMap
          seats={seats}
          categories={categories}
          selected={selected}
          onToggle={toggleSeat}
          disabled={!signedInCustomer || busy || Boolean(hold)}
        />

        <aside className="card summary">
          <h2>Your selection</h2>

          {selectedSeats.length === 0 ? (
            <p className="muted">Pick one or more seats from the map.</p>
          ) : (
            <>
              <ul className="selection">
                {selectedSeats.map((seat) => (
                  <li key={seat.id}>
                    <span>
                      {seat.label} <em className="muted">{seat.category}</em>
                    </span>
                    <span>{formatMoney(seat.price)}</span>
                  </li>
                ))}
              </ul>
              <p className="total">
                <span>Total</span>
                <strong>{formatMoney(hold?.total ?? total)}</strong>
              </p>
            </>
          )}

          {hold ? (
            <>
              <div className={remaining < 60_000 ? 'countdown urgent' : 'countdown'}>
                <span>Seats held for</span>
                <strong>{formatCountdown(remaining)}</strong>
              </div>
              <p className="muted small">
                If you leave checkout the seats are released automatically and go back on sale.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                <input
                  type="text"
                  placeholder="Guest Name"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  disabled={busy}
                />
                <input
                  type="tel"
                  placeholder="Mobile Number"
                  value={guestMobile}
                  onChange={(e) => setGuestMobile(e.target.value)}
                  disabled={busy}
                />
                <input
                  type="email"
                  placeholder="Email Address"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  disabled={busy}
                />
              </div>

              <button type="button" className="primary" onClick={confirmBooking} disabled={busy || !guestName || !guestMobile || !guestEmail}>
                {busy ? 'Confirming...' : 'Confirm booking'}
              </button>
              <button type="button" className="ghost" onClick={releaseSeats} disabled={busy}>
                Release seats
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={holdSeats}
              disabled={!signedInCustomer || busy || selected.length === 0}
            >
              {busy ? 'Holding...' : `Hold ${selected.length || ''} ${selected.length === 1 ? 'seat' : 'seats'}`.trim()}
            </button>
          )}

          <hr />

          <h2>Sold out categories</h2>
          {categories.filter((category) => category.available === 0).length === 0 ? (
            <p className="muted small">Every category still has seats available.</p>
          ) : (
            <ul className="waitlist-options">
              {categories
                .filter((category) => category.available === 0)
                .map((category) => {
                  const entry = queue.find((q) => q.category === category.category);
                  return (
                    <li key={category.categoryId}>
                      <span>
                        <strong>{category.category}</strong> sold out
                      </span>
                      {entry ? (
                        <em className="muted small">
                          {entry.status === 'offered' ? 'Seat offered to you' : `You are number ${entry.position} in the queue`}
                        </em>
                      ) : (
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() => joinWaitlist(category.categoryId)}
                          disabled={!signedInCustomer || busy}
                        >
                          Join waitlist
                        </button>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
};
