import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { Notice } from '../components/Notice';
import { formatDateTime, formatMoney } from '../format';
import type { EventRevenue, Venue } from '../types';

interface OrganiserEvent {
  id: number;
  title: string;
  kind: 'movie' | 'concert';
  language: string;
  runtimeMin: number | null;
  showCount: number;
  revenue: number;
}

const emptyEvent = { title: '', kind: 'movie' as 'movie' | 'concert', description: '', language: '', runtimeMin: '' };

export const Organiser = () => {
  const [events, setEvents] = useState<OrganiserEvent[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [summary, setSummary] = useState<EventRevenue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState(emptyEvent);
  const [showDraft, setShowDraft] = useState({ eventId: '', venueId: '', startsAt: '' });
  const [prices, setPrices] = useState<Record<number, string>>({});

  const openSummary = useCallback(async (eventId: number) => {
    try {
      const { summary: found } = await api.get<{ summary: EventRevenue }>(`/organiser/events/${eventId}/summary`);
      setSummary(found);
    } catch {
      setError('Could not load that revenue summary.');
    }
  }, []);

  const load = useCallback(async () => {
    const [{ events: mine }, { venues: all }] = await Promise.all([
      api.get<{ events: OrganiserEvent[] }>('/organiser/events'),
      api.get<{ venues: Venue[] }>('/venues'),
    ]);
    setEvents(mine);
    setVenues(all);
    return mine;
  }, []);

  useEffect(() => {
    load()
      .then((mine) => (mine.length > 0 ? openSummary(mine[0].id) : undefined))
      .catch(() => setError('Could not load your events.'));
  }, [load, openSummary]);

  const selectedVenue = venues.find((venue) => venue.id === Number(showDraft.venueId));

  const createEvent = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await api.post('/events', {
        ...draft,
        runtimeMin: draft.runtimeMin ? Number(draft.runtimeMin) : null,
      });
      setDraft(emptyEvent);
      setInfo('Event created. Now schedule a showing for it.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that event.');
    } finally {
      setBusy(false);
    }
  };

  const createShow = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await api.post('/shows', {
        eventId: Number(showDraft.eventId),
        venueId: Number(showDraft.venueId),
        // datetime-local gives a local wall-clock value; send it as a real instant.
        startsAt: new Date(showDraft.startsAt).toISOString(),
        prices: Object.fromEntries(Object.entries(prices).map(([id, value]) => [id, Number(value)])),
      });
      setInfo('Showing scheduled and the seat map is ready.');
      setShowDraft({ eventId: '', venueId: '', startsAt: '' });
      setPrices({});
      await load();
      if (summary) await openSummary(summary.event.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not schedule that showing.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Organiser dashboard</h1>

      {error && <Notice kind="error" onDismiss={() => setError(null)}>{error}</Notice>}
      {info && <Notice kind="success" onDismiss={() => setInfo(null)}>{info}</Notice>}

      <div className="two-column">
        <section>
          <h2>Your events</h2>
          {events.length === 0 ? (
            <p className="muted">You have not created any events yet.</p>
          ) : (
            <ul className="stack">
              {events.map((event) => (
                <li key={event.id} className="card row">
                  <div>
                    <strong>{event.title}</strong>
                    <p className="muted small">
                      {event.kind} · {event.showCount} {event.showCount === 1 ? 'showing' : 'showings'} ·{' '}
                      {formatMoney(event.revenue)} earned
                    </p>
                  </div>
                  <button type="button" className="ghost small" onClick={() => openSummary(event.id)}>
                    View revenue
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h2>Add an event</h2>
          <form className="card stack" onSubmit={createEvent}>
            <label>
              Title
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
            </label>
            <label>
              Type
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as 'movie' | 'concert' })}
              >
                <option value="movie">Movie</option>
                <option value="concert">Concert</option>
              </select>
            </label>
            <label>
              Description
              <textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <div className="side-by-side">
              <label>
                Language
                <input value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} />
              </label>
              <label>
                Runtime (min)
                <input
                  type="number"
                  min={1}
                  value={draft.runtimeMin}
                  onChange={(e) => setDraft({ ...draft, runtimeMin: e.target.value })}
                />
              </label>
            </div>
            <button type="submit" className="primary" disabled={busy}>
              Create event
            </button>
          </form>

          <h2>Schedule a showing</h2>
          <form className="card stack" onSubmit={createShow}>
            <label>
              Event
              <select
                value={showDraft.eventId}
                onChange={(e) => setShowDraft({ ...showDraft, eventId: e.target.value })}
                required
              >
                <option value="">Choose an event</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Venue
              <select
                value={showDraft.venueId}
                onChange={(e) => {
                  setShowDraft({ ...showDraft, venueId: e.target.value });
                  setPrices({});
                }}
                required
              >
                <option value="">Choose a venue</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}, {venue.city} ({venue.seatCount} seats)
                  </option>
                ))}
              </select>
            </label>

            <label>
              Starts at
              <input
                type="datetime-local"
                value={showDraft.startsAt}
                onChange={(e) => setShowDraft({ ...showDraft, startsAt: e.target.value })}
                required
              />
            </label>

            {selectedVenue && (
              <fieldset className="stack">
                <legend>Price per seat category</legend>
                {selectedVenue.categories.map((category) => (
                  <label key={category.id}>
                    {category.name}
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={prices[category.id] ?? ''}
                      onChange={(e) => setPrices({ ...prices, [category.id]: e.target.value })}
                      required
                    />
                  </label>
                ))}
              </fieldset>
            )}

            <button type="submit" className="primary" disabled={busy || !selectedVenue}>
              Schedule showing
            </button>
          </form>
        </section>

        <section>
          <h2>Revenue</h2>
          {!summary ? (
            <p className="muted">Pick an event to see its numbers.</p>
          ) : (
            <>
              <div className="card">
                <h3>{summary.event.title}</h3>
                <div className="stat-grid">
                  <div>
                    <span className="stat">{formatMoney(summary.revenue)}</span>
                    <em>revenue</em>
                  </div>
                  <div>
                    <span className="stat">{summary.confirmedBookings}</span>
                    <em>bookings</em>
                  </div>
                  <div>
                    <span className="stat">{summary.occupancy}%</span>
                    <em>seats filled</em>
                  </div>
                  <div>
                    <span className="stat">{summary.waiting}</span>
                    <em>on waitlists</em>
                  </div>
                </div>
                {summary.cancelledBookings > 0 && (
                  <p className="muted small">
                    {summary.cancelledBookings} cancelled, {formatMoney(summary.refunded)} refunded.
                  </p>
                )}
              </div>

              <div className="card">
                <h3>By seat category</h3>
                <ul className="bars">
                  {summary.byCategory.map((row) => (
                    <li key={row.category}>
                      <span className="bar-label">
                        {row.category}
                        <em className="muted">
                          {row.booked}/{row.seats} · {formatMoney(row.revenue)}
                        </em>
                      </span>
                      <span className="bar-track">
                        <span
                          className="bar-fill"
                          style={{ width: `${row.seats ? (row.booked / row.seats) * 100 : 0}%` }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card">
                <h3>By showing</h3>
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Venue</th>
                      <th>Filled</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.shows.map((show) => (
                      <tr key={show.id}>
                        <td>{formatDateTime(show.startsAt)}</td>
                        <td>{show.venueName}</td>
                        <td>
                          {show.booked}/{show.seats} ({show.occupancy}%)
                        </td>
                        <td>{formatMoney(show.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
};
