import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Notice } from '../components/Notice';
import { formatDate, formatDateTime, formatMoney } from '../format';
import type { EventDetail as EventDetailType } from '../types';

export const EventDetail = () => {
  const { eventId } = useParams();
  const [event, setEvent] = useState<EventDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ event: EventDetailType }>(`/events/${eventId}`)
      .then(({ event: found }) => setEvent(found))
      .catch(() => setError('That event could not be found.'));
  }, [eventId]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!event) return <p className="muted">Loading...</p>;

  // Showings are grouped by day so a long run stays readable.
  const byDay = new Map<string, typeof event.shows>();
  for (const show of event.shows) {
    const day = show.startsAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), show]);
  }

  return (
    <>
      <Link className="back" to="/">
        Back to listings
      </Link>

      <header className="event-header">
        <span className={`tag tag-${event.kind}`}>{event.kind}</span>
        <h1>{event.title}</h1>
        <p className="muted">
          {event.language}
          {event.runtimeMin ? ` · ${event.runtimeMin} min` : ''} · presented by {event.organiser}
        </p>
        <p className="description">{event.description}</p>
      </header>

      <h2>Showings</h2>

      {event.shows.length === 0 ? (
        <p className="muted">No showings have been scheduled yet.</p>
      ) : (
        [...byDay.entries()].map(([day, shows]) => (
          <section key={day} className="day-group">
            <h3>{formatDate(day)}</h3>
            <ul className="show-list">
              {shows.map((show) => {
                const soldOut = show.available === 0;
                return (
                  <li key={show.id} className="card show-row">
                    <div>
                      <strong>{formatDateTime(show.startsAt)}</strong>
                      <p className="muted small">
                        {show.venueName}, {show.venueCity}
                      </p>
                    </div>
                    <div className="show-meta">
                      {show.fromPrice !== null && <span className="small">from {formatMoney(show.fromPrice)}</span>}
                      <span className={soldOut ? 'small sold-out' : 'small'}>
                        {soldOut ? 'Sold out' : `${show.available} of ${show.seats} seats free`}
                      </span>
                    </div>
                    <Link className={soldOut ? 'button ghost' : 'button'} to={`/shows/${show.id}`}>
                      {soldOut ? 'Join waitlist' : 'Pick seats'}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
};
