import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Notice } from '../components/Notice';
import { formatDateTime, formatMoney } from '../format';
import type { Booking } from '../types';

export const BookingDetail = () => {
  const { bookingId } = useParams();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ booking: Booking }>(`/bookings/${bookingId}`)
      .then(({ booking: found }) => setBooking(found))
      .catch(() => setError('That booking could not be found.'));

    api
      .get<{ dataUrl: string }>(`/bookings/${bookingId}/qr`)
      .then(({ dataUrl }) => setQr(dataUrl))
      .catch(() => setQr(null));
  }, [bookingId]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!booking) return <p className="muted">Loading...</p>;

  const cancelled = booking.status === 'cancelled';

  return (
    <div className="narrow">
      {!cancelled && <Notice kind="success">Booking confirmed. A copy has been emailed to you.</Notice>}
      {cancelled && <Notice kind="info">This booking was cancelled.</Notice>}

      <div className={cancelled ? 'card ticket cancelled' : 'card ticket'}>
        <div className="ticket-main">
          <span className={`tag tag-${booking.kind}`}>{booking.kind}</span>
          <h1>{booking.title}</h1>
          <p className="muted">
            {formatDateTime(booking.startsAt)}
            <br />
            {booking.venueName}, {booking.venueCity}
          </p>

          <dl className="ticket-facts">
            <div>
              <dt>Reference</dt>
              <dd className="reference">{booking.reference}</dd>
            </div>
            <div>
              <dt>{booking.seats.length === 1 ? 'Seat' : 'Seats'}</dt>
              <dd>{booking.seats.map((seat) => `${seat.label} (${seat.category})`).join(', ')}</dd>
            </div>
            <div>
              <dt>Total paid</dt>
              <dd>{formatMoney(booking.amount)}</dd>
            </div>
            {booking.source === 'waitlist_offer' && (
              <div>
                <dt>Booked via</dt>
                <dd>Waitlist offer</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="ticket-qr">
          {qr ? (
            <img src={qr} alt={`QR code for booking ${booking.reference}`} width={200} height={200} />
          ) : (
            <div className="qr-placeholder">QR unavailable</div>
          )}
          <p className="muted small">Show this at the entrance</p>
        </div>
      </div>

      <Link className="button ghost" to="/bookings">
        All my bookings
      </Link>
    </div>
  );
};
