import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Notice } from '../components/Notice';
import { formatDateTime } from '../format';
import type { EventListing } from '../types';

interface Filters {
  q: string;
  kind: '' | 'movie' | 'concert';
  city: string;
  date: string;
}

const EMPTY: Filters = { q: '', kind: '', city: '', date: '' };

export const Browse = () => {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [events, setEvents] = useState<EventListing[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ cities: string[] }>('/cities').then(({ cities: list }) => setCities(list)).catch(() => setCities([]));
  }, []);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);

    const timer = setTimeout(() => {
      setLoading(true);
      api
        .get<{ events: EventListing[] }>(`/events?${params}`)
        .then(({ events: found }) => {
          setEvents(found);
          setError(null);
        })
        .catch(() => setError('Could not load events. Is the API running?'))
        .finally(() => setLoading(false));
    }, 200);

    return () => clearTimeout(timer);
  }, [filters]);

  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const isFiltered = Object.values(filters).some(Boolean);

  return (
    <>
      <h1>What's on</h1>

      <div className="filters card">
        <label className="grow">
          Search
          <input
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Title or description"
          />
        </label>

        <label>
          Type
          <select value={filters.kind} onChange={(e) => update({ kind: e.target.value as Filters['kind'] })}>
            <option value="">All</option>
            <option value="movie">Movies</option>
            <option value="concert">Concerts</option>
          </select>
        </label>

        <label>
          City
          <select value={filters.city} onChange={(e) => update({ city: e.target.value })}>
            <option value="">All</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>

        <label>
          Date
          <input type="date" value={filters.date} onChange={(e) => update({ date: e.target.value })} />
        </label>

        {isFiltered && (
          <button type="button" className="link" onClick={() => setFilters(EMPTY)}>
            Clear
          </button>
        )}
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {loading && events.length === 0 ? (
        <p className="muted">Loading...</p>
      ) : events.length === 0 ? (
        <p className="muted">
          {isFiltered ? 'Nothing matches those filters.' : 'No events have been scheduled yet.'}
        </p>
      ) : (
        <ul className="event-grid">
          {events.map((event) => (
            <li key={event.id} className="card event-card">
              <span className={`tag tag-${event.kind}`}>{event.kind}</span>
              <h2>
                <Link to={`/events/${event.id}`}>{event.title}</Link>
              </h2>
              <p className="muted small">
                {event.language}
                {event.runtimeMin ? ` · ${event.runtimeMin} min` : ''} · by {event.organiser}
              </p>
              <p className="description">{event.description}</p>
              <p className="small">
                Next show {formatDateTime(event.nextShowAt)} · {event.showCount}{' '}
                {event.showCount === 1 ? 'showing' : 'showings'}
              </p>
              <Link className="button" to={`/events/${event.id}`}>
                See showings
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};
