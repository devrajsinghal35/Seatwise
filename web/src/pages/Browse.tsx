import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, ErrorBanner } from '../components/EmptyState';
import { EventGridSkeleton } from '../components/Skeleton';
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
    api
      .get<{ cities: string[] }>('/cities')
      .then(({ cities: list }) => setCities(list))
      .catch(() => setCities([]));
  }, []);

  const fetchEvents = useCallback(
    (currentFilters: Filters) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(currentFilters)) {
        if (value) params.set(key, value);
      }

      setLoading(true);
      setError(null);

      api
        .get<{ events: EventListing[] }>(`/events?${params}`)
        .then(({ events: found }) => {
          setEvents(found);
          setError(null);
        })
        .catch(() => setError('Could not load events. Is the server running?'))
        .finally(() => setLoading(false));
    },
    []
  );

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchEvents(filters);
    }, 200);

    return () => clearTimeout(timer);
  }, [filters, fetchEvents]);

  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const isFiltered = Object.values(filters).some(Boolean);

  return (
    <>
      <header className="page-header">
        <h1>What's on</h1>
        <p className="muted">Book seats in real time. Holds expire automatically and waitlists cascade in turn.</p>
      </header>

      <div className="filters card">
        <label className="grow">
          Search
          <input
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Title, genre or performer"
          />
        </label>

        <label>
          Type
          <select value={filters.kind} onChange={(e) => update({ kind: e.target.value as Filters['kind'] })}>
            <option value="">All Types</option>
            <option value="movie">Movies</option>
            <option value="concert">Concerts</option>
          </select>
        </label>

        <label>
          City
          <select value={filters.city} onChange={(e) => update({ city: e.target.value })}>
            <option value="">All Cities</option>
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
          <button type="button" className="button ghost small" onClick={() => setFilters(EMPTY)}>
            Reset filters
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => fetchEvents(filters)} onDismiss={() => setError(null)} />}

      {loading && events.length === 0 ? (
        <EventGridSkeleton />
      ) : events.length === 0 ? (
        <EmptyState
          title={isFiltered ? 'No matching events found' : 'No upcoming events'}
          description={
            isFiltered
              ? 'Try adjusting your search criteria or clearing active filters to see all available listings.'
              : 'Check back soon as organisers regularly schedule new showings.'
          }
          action={
            isFiltered ? (
              <button type="button" className="button primary small" onClick={() => setFilters(EMPTY)}>
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="event-grid">
          {events.map((event) => (
            <li key={event.id} className="card event-card">
              <div className="event-card-top">
                <span className={`tag tag-${event.kind}`}>{event.kind}</span>
                <span className="small muted">
                  {event.showCount} {event.showCount === 1 ? 'showing' : 'showings'}
                </span>
              </div>
              <h2>
                <Link to={`/events/${event.id}`}>{event.title}</Link>
              </h2>
              <p className="muted small">
                {event.language}
                {event.runtimeMin ? ` · ${event.runtimeMin} min` : ''} · by {event.organiser}
              </p>
              <p className="description">{event.description}</p>
              <p className="small next-show">Next show {formatDateTime(event.nextShowAt)}</p>
              <Link className="button" to={`/events/${event.id}`}>
                View showings
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};
