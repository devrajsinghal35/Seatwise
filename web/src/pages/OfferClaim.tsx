import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { useAuth } from '../auth';
import { Notice } from '../components/Notice';
import { formatCountdown, formatDateTime, formatMoney } from '../format';
import { useCountdown } from '../hooks';
import type { Booking, Offer } from '../types';

/** The page behind the time-limited link emailed to a waitlisted customer. */
export const OfferClaim = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;

    api
      .get<{ offer: Offer }>(`/offers/${token}`)
      .then(({ offer: found }) => setOffer(found))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'That offer link could not be opened.')
      );
  }, [token, user, authLoading]);

  const remaining = useCountdown(offer && !offer.expired ? offer.expiresAt : null);
  // Checked against the clock directly; the countdown only drives the display.
  const lapsed = Boolean(offer && (offer.expired || offer.expiresAt <= Date.now()));

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const { booking } = await api.post<{ booking: Booking }>(`/offers/${token}/claim`);
      navigate(`/bookings/${booking.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not claim that seat.');
      setBusy(false);
    }
  };

  if (authLoading) return <p className="muted">Loading...</p>;

  if (!user) {
    return (
      <div className="narrow">
        <h1>Claim your seat</h1>
        <Notice kind="info">
          <Link to="/signin">Sign in</Link> with the account that joined the waitlist to claim this seat.
        </Notice>
      </div>
    );
  }

  if (error && !offer) {
    return (
      <div className="narrow">
        <h1>Claim your seat</h1>
        <Notice kind="error">{error}</Notice>
        <Link className="button ghost" to="/bookings">
          My bookings
        </Link>
      </div>
    );
  }

  if (!offer) return <p className="muted">Loading your offer...</p>;

  return (
    <div className="narrow">
      <h1>A seat is waiting for you</h1>

      {error && <Notice kind="error" onDismiss={() => setError(null)}>{error}</Notice>}

      {lapsed ? (
        <Notice kind="info">
          This offer has expired and the seat has passed to the next person in the queue. You can rejoin the
          waitlist from the showing page.
        </Notice>
      ) : (
        <div className={remaining < 60_000 ? 'countdown urgent' : 'countdown'}>
          <span>Offer expires in</span>
          <strong>{formatCountdown(remaining)}</strong>
        </div>
      )}

      <div className="card stack">
        <h2>{offer.title}</h2>
        <p className="muted">
          {formatDateTime(offer.startsAt)}
          <br />
          {offer.venueName}, {offer.venueCity}
        </p>

        <dl className="ticket-facts">
          <div>
            <dt>Seat</dt>
            <dd>
              {offer.rowLabel}
              {offer.seatNumber} ({offer.category})
            </dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>{formatMoney(offer.price)}</dd>
          </div>
        </dl>

        {!lapsed && (
          <button type="button" className="primary" onClick={claim} disabled={busy}>
            {busy ? 'Claiming...' : 'Claim this seat'}
          </button>
        )}

        <Link className="button ghost" to={`/shows/${offer.showId}`}>
          View the seat map
        </Link>
      </div>
    </div>
  );
};
