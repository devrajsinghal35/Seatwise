import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { useAuth } from '../auth';
import { SeatMap } from '../components/SeatMap';
import { SeatMapSkeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { formatCountdown, formatDateTime, formatMoney } from '../format';
import { useCountdown, useSeatStream } from '../hooks';
import type { Booking as BookingType, CategorySummary, Hold, Seat, SeatMap as SeatMapData, ShowDetail, WaitlistEntry } from '../types';

export const Booking = () => {
  const { showId: showIdParam } = useParams();
  const showId = Number(showIdParam);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [show, setShow] = useState<ShowDetail | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [priceList, setPriceList] = useState<CategorySummary[]>([]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [queue, setQueue] = useState<WaitlistEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [holdExpired, setHoldExpired] = useState(false);
  const [loading, setLoading] = useState(true);

  const [guestName, setGuestName] = useState(user?.name ?? '');
  const [guestMobile, setGuestMobile] = useState('');
  const [guestEmail, setGuestEmail] = useState(user?.email ?? '');

  useEffect(() => {
    if (user) {
      setGuestName((prev) => prev || user.name || '');
      setGuestEmail((prev) => prev || user.email || '');
    }
  }, [user]);

  // Reused across retries of the same checkout so a double submit cannot produce two bookings.
  const checkoutKey = useRef<string>(crypto.randomUUID());

  const loadSeats = useCallback(async () => {
    const data = await api.get<SeatMapData>(`/shows/${showId}/seats`);
    setSeats(data.seats);
    setPriceList(data.categories);
    setHold(data.hold);
    if (data.hold) {
      setSelected(data.hold.seatIds);
    }
  }, [showId]);

  const loadQueue = useCallback(async () => {
    if (user?.role !== 'customer') return;
    const { entries } = await api.get<{ entries: WaitlistEntry[] }>('/waitlist');
    setQueue(entries.filter((entry) => entry.showId === showId));
  }, [showId, user?.role]);

  useEffect(() => {
    if (!Number.isInteger(showId)) return;
    setLoading(true);

    Promise.all([
      api.get<{ show: ShowDetail }>(`/shows/${showId}`).then(({ show: found }) => setShow(found)),
      loadSeats(),
      loadQueue().catch(() => undefined),
    ])
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load showing details.'))
      .finally(() => setLoading(false));
  }, [showId, loadSeats, loadQueue]);

  // Live updates from other customers, so the map changes under your cursor.
  const streaming = useSeatStream(Number.isInteger(showId) ? showId : null, (changes) => {
    setSeats((current) =>
      current.map((seat) => {
        const change = changes.find((c) => c.id === seat.id);
        if (!change) return seat;

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

  const categories = useMemo(
    () =>
      priceList.map((category) => ({
        ...category,
        available: seats.filter((seat) => seat.categoryId === category.categoryId && seat.status === 'available').length,
      })),
    [priceList, seats]
  );

  const remaining = useCountdown(hold?.holdExpiresAt ?? null);

  // Expired hold handling
  useEffect(() => {
    if (!hold) return;

    const expire = () => {
      setHold(null);
      setSelected([]);
      setHoldExpired(true);
      toast('Your seat hold has expired.', 'warning');
      loadSeats().catch(() => undefined);
    };

    const msLeft = hold.holdExpiresAt - Date.now();
    if (msLeft <= 0) {
      expire();
      return;
    }

    const timer = setTimeout(expire, msLeft);
    return () => clearTimeout(timer);
  }, [hold, loadSeats, toast]);

  const toggleSeat = useCallback(
    (seat: Seat) => {
      if (hold) return;
      setError(null);
      setHoldExpired(false);
      setSelected((current) =>
        current.includes(seat.id) ? current.filter((id) => id !== seat.id) : [...current, seat.id]
      );
    },
    [hold]
  );

  const selectedSeats = useMemo(
    () => seats.filter((seat) => selected.includes(seat.id)),
    [seats, selected]
  );
  const total = useMemo(
    () => selectedSeats.reduce((sum, seat) => sum + seat.price, 0),
    [selectedSeats]
  );

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
      setError(msg);
      toast(msg, 'error');
      if (err instanceof ApiError && ['seat_held', 'seat_booked', 'hold_expired'].includes(err.code)) {
        await loadSeats().catch(() => undefined);
        if (err.code === 'hold_expired') {
          setHold(null);
          setHoldExpired(true);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const holdSeats = () =>
    run(async () => {
      setHoldExpired(false);
      const { hold: created } = await api.post<{ hold: Hold }>(`/shows/${showId}/hold`, { seatIds: selected });
      checkoutKey.current = crypto.randomUUID();
      setHold(created);
      toast('Seats reserved! Complete checkout before the timer expires.', 'success');
      await loadSeats();
    });

  const releaseSeats = () =>
    run(async () => {
      await api.del(`/shows/${showId}/hold`);
      setHold(null);
      setSelected([]);
      setHoldExpired(false);
      toast('Seats released.', 'info');
      await loadSeats();
    });

  const confirmBooking = () =>
    run(async () => {
      const { booking } = await api.post<{ booking: BookingType }>(
        '/bookings',
        { showId, guestName, guestMobile, guestEmail },
        { 'Idempotency-Key': checkoutKey.current }
      );
      toast('Booking confirmed!', 'success');
      navigate(`/bookings/${booking.id}`, { replace: true });
    });

  const joinWaitlist = (categoryId: number) =>
    run(async () => {
      await api.post(`/shows/${showId}/waitlist`, { categoryId });
      await loadQueue();
      const msg = 'You are on the waitlist. We will email you if a seat opens up.';
      setInfo(msg);
      toast(msg, 'success');
    });

  const handlePickSeatsAgain = () => {
    setHoldExpired(false);
    setHold(null);
    setSelected([]);
    loadSeats().catch(() => undefined);
  };

  if (loading && !show) return <SeatMapSkeleton />;
  if (error && !show) {
    return (
      <div className="card empty-state" role="alert">
        <h2 className="empty-state-title">Showing not found</h2>
        <p className="muted">{error}</p>
        <Link className="button" to="/">
          Browse what's on
        </Link>
      </div>
    );
  }
  if (!show) return null;

  const signedInCustomer = user?.role === 'customer';
  const offered = queue.find((entry) => entry.status === 'offered');
  const isUrgent = remaining < 60_000 && remaining > 0;

  return (
    <>
      <Link className="back" to={`/events/${show.event.id}`}>
        &larr; Back to {show.event.title}
      </Link>

      <header className="show-header">
        <h1>{show.event.title}</h1>
        <p className="muted">
          {formatDateTime(show.startsAt)} · {show.venueName}, {show.venueCity}
          {streaming && <span className="live"> live</span>}
        </p>
      </header>

      {offered && (
        <div className="notice notice-success" role="status">
          <span>
            A seat has opened up for you from the waitlist.{' '}
            <Link to={`/offer/${offered.offerToken}`}>Claim it now</Link> before the offer expires.
          </span>
        </div>
      )}

      {!user && (
        <div className="notice notice-info" role="status">
          <span>
            <Link to="/signin" state={{ from: `/shows/${showId}` }}>
              Sign in
            </Link>{' '}
            to hold and book seats.
          </span>
        </div>
      )}

      {info && (
        <div className="notice notice-info" role="status">
          <span>{info}</span>
          <button type="button" className="notice-close" onClick={() => setInfo(null)} aria-label="Dismiss">
            &times;
          </button>
        </div>
      )}

      {holdExpired && (
        <div className="notice notice-warning expired-banner" role="alert">
          <div className="expired-content">
            <strong>Your seat hold has expired.</strong>
            <p className="small muted">The seats have been released back to general sale.</p>
          </div>
          <button type="button" className="button primary small" onClick={handlePickSeatsAgain}>
            Pick seats again
          </button>
        </div>
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
          {/* Prominent Countdown when held */}
          {hold && (
            <div
              className={`countdown-card ${isUrgent ? 'countdown-urgent-pulse' : ''}`}
              role="timer"
              aria-live="polite"
              aria-label={`Time remaining to complete booking: ${formatCountdown(remaining)}`}
            >
              <div className="countdown-header">
                <span className="countdown-badge">{isUrgent ? '⚠️ Expiring Soon' : '⏱ Seats Held'}</span>
                <strong className="countdown-clock">{formatCountdown(remaining)}</strong>
              </div>
              <p className="countdown-note small">
                {isUrgent
                  ? 'Hurry! Complete checkout before your hold expires.'
                  : 'Your seats are held. Finish details below to confirm.'}
              </p>
            </div>
          )}

          <h2>Order summary</h2>

          {selectedSeats.length === 0 ? (
            <div className="selection-empty">
              <p className="muted small">Select up to 8 seats from the seating map to reserve them.</p>
            </div>
          ) : (
            <>
              <ul className="selection" aria-label="Selected seats">
                {selectedSeats.map((seat) => (
                  <li key={seat.id}>
                    <span>
                      <strong>Seat {seat.label}</strong> <em className="muted small">({seat.category})</em>
                    </span>
                    <span>{formatMoney(seat.price)}</span>
                  </li>
                ))}
              </ul>
              <div className="total">
                <span>Total</span>
                <strong>{formatMoney(hold?.total ?? total)}</strong>
              </div>
            </>
          )}

          {/* Guest Details Form - Visible alongside seat selection */}
          <section className="guest-details-section">
            <h3 className="section-title">Guest details</h3>
            <div className="stack guest-form">
              <label>
                Full name
                <input
                  type="text"
                  placeholder="e.g. Priya Sharma"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  disabled={busy}
                  autoComplete="name"
                  required
                />
              </label>
              <label>
                Mobile number
                <input
                  type="tel"
                  placeholder="e.g. +91 98765 43210"
                  value={guestMobile}
                  onChange={(e) => setGuestMobile(e.target.value)}
                  disabled={busy}
                  autoComplete="tel"
                  required
                />
              </label>
              <label>
                Email address
                <input
                  type="email"
                  placeholder="e.g. priya@example.com"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  disabled={busy}
                  autoComplete="email"
                  required
                />
              </label>
            </div>
          </section>

          {hold ? (
            <div className="checkout-actions">
              <button
                type="button"
                className="button primary checkout-btn"
                onClick={confirmBooking}
                disabled={busy || !guestName.trim() || !guestMobile.trim() || !guestEmail.trim()}
              >
                {busy ? 'Confirming...' : 'Confirm booking'}
              </button>
              <button type="button" className="button ghost small" onClick={releaseSeats} disabled={busy}>
                Release seats
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button primary"
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
                          {entry.status === 'offered'
                            ? 'Seat offered to you'
                            : `You are #${entry.position} in queue`}
                        </em>
                      ) : (
                        <button
                          type="button"
                          className="button ghost small"
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
