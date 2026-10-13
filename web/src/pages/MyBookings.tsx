import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api';
import { EmptyState, ErrorBanner } from '../components/EmptyState';
import { Notice } from '../components/Notice';
import { BookingsSkeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { formatCountdown, formatDateTime, formatMoney } from '../format';
import { useCountdown } from '../hooks';
import type { Booking, WaitlistEntry } from '../types';

const OfferCountdown = ({ entry }: { entry: WaitlistEntry }) => {
  const remaining = useCountdown(entry.offerExpiresAt);
  return <strong>{formatCountdown(remaining)}</strong>;
};

export const MyBookings = () => {
  const { toast } = useToast();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [queue, setQueue] = useState<WaitlistEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ bookings: mine }, { entries }] = await Promise.all([
        api.get<{ bookings: Booking[] }>('/bookings'),
        api.get<{ entries: WaitlistEntry[] }>('/waitlist'),
      ]);
      setBookings(mine);
      setQueue(entries);
    } catch {
      setError('Could not load your bookings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = async (booking: Booking) => {
    if (!window.confirm(`Cancel booking ${booking.reference}? This cannot be undone.`)) return;

    setBusyId(booking.id);
    setError(null);
    setInfo(null);
    try {
      const result = await api.post<{ seatsReoffered: number }>(`/bookings/${booking.id}/cancel`);
      const msg =
        result.seatsReoffered > 0
          ? `Booking cancelled. ${result.seatsReoffered} ${result.seatsReoffered === 1 ? 'seat was' : 'seats were'} offered to waitlist customers.`
          : 'Booking cancelled and the seats are back on sale.';
      setInfo(msg);
      toast(msg, 'info');
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not cancel that booking.';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const leaveQueue = async (entry: WaitlistEntry) => {
    setBusyId(entry.id);
    try {
      await api.del(`/waitlist/${entry.id}`);
      toast('Left the waitlist queue.', 'info');
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not leave that waitlist.';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <header className="page-header">
        <h1>My bookings</h1>
        <p className="muted">Manage your tickets and active waitlist positions.</p>
      </header>

      {error && <ErrorBanner message={error} onRetry={load} onDismiss={() => setError(null)} />}
      {info && <Notice kind="success" onDismiss={() => setInfo(null)}>{info}</Notice>}

      {queue.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2>Waitlists</h2>
          <ul className="stack">
            {queue.map((entry) => (
              <li key={entry.id} className="card row">
                <div>
                  <strong>{entry.title}</strong>
                  <p className="muted small">
                    {entry.category} · {formatDateTime(entry.startsAt)} · {entry.venueName}
                  </p>
                </div>
                <div className="row-actions">
                  {entry.status === 'offered' ? (
                    <>
                      <span className="small">
                        Seat offered, expires in <OfferCountdown entry={entry} />
                      </span>
                      <Link className="button" to={`/offer/${entry.offerToken}`}>
                        Claim seat
                      </Link>
                    </>
                  ) : (
                    <>
                      <span className="small muted">Number {entry.position} in queue</span>
                      <button
                        type="button"
                        className="button ghost small"
                        onClick={() => leaveQueue(entry)}
                        disabled={busyId === entry.id}
                      >
                        Leave
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Tickets</h2>
        {loading && bookings.length === 0 ? (
          <BookingsSkeleton />
        ) : bookings.length === 0 ? (
          <EmptyState
            title="No tickets yet"
            description="You have not booked any tickets yet. Explore what's on to discover movies and concerts."
            action={
              <Link className="button" to="/">
                Browse what's on
              </Link>
            }
          />
        ) : (
          <ul className="stack">
            {bookings.map((booking) => {
              const past = new Date(booking.startsAt).getTime() <= Date.now();
              return (
                <li key={booking.id} className={booking.status === 'cancelled' ? 'card row faded' : 'card row'}>
                  <div>
                    <strong>{booking.title}</strong>
                    <p className="muted small">
                      {formatDateTime(booking.startsAt)} · {booking.venueName}
                      <br />
                      {booking.seats.map((seat) => seat.label).join(', ')} · {formatMoney(booking.amount)} ·{' '}
                      <span className="reference">{booking.reference}</span>
                    </p>
                  </div>
                  <div className="row-actions">
                    {booking.status === 'cancelled' ? (
                      <span className="small muted">Cancelled</span>
                    ) : (
                      <>
                        <Link className="button ghost small" to={`/bookings/${booking.id}`}>
                          View ticket
                        </Link>
                        {!past && (
                          <button
                            type="button"
                            className="button ghost small danger"
                            onClick={() => cancel(booking)}
                            disabled={busyId === booking.id}
                          >
                            {busyId === booking.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
};
