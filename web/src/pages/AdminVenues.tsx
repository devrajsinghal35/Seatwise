import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { Notice } from '../components/Notice';
import type { Venue } from '../types';

interface RowDraft {
  label: string;
  seats: string;
  category: string;
}

const nextLabel = (index: number) => String.fromCharCode(65 + (index % 26));

export const AdminVenues = () => {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [categories, setCategories] = useState<string[]>(['Premium', 'Standard']);
  const [rows, setRows] = useState<RowDraft[]>([
    { label: 'A', seats: '10', category: 'Premium' },
    { label: 'B', seats: '12', category: 'Standard' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { venues: all } = await api.get<{ venues: Venue[] }>('/venues');
    setVenues(all);
  }, []);

  useEffect(() => {
    load().catch(() => setError('Could not load venues.'));
  }, [load]);

  const totalSeats = rows.reduce((sum, row) => sum + (Number(row.seats) || 0), 0);

  const setCategory = (index: number, value: string) => {
    const previous = categories[index];
    setCategories(categories.map((entry, i) => (i === index ? value : entry)));
    // Keep rows pointing at the renamed category rather than silently orphaning them.
    setRows(rows.map((row) => (row.category === previous ? { ...row, category: value } : row)));
  };

  const removeCategory = (index: number) => {
    const removed = categories[index];
    const remaining = categories.filter((_, i) => i !== index);
    setCategories(remaining);
    setRows(rows.map((row) => (row.category === removed ? { ...row, category: remaining[0] ?? '' } : row)));
  };

  const submit = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const { venue } = await api.post<{ venue: Venue & { seatCount: number } }>('/venues', {
        name,
        city,
        categories,
        rows: rows.map((row) => ({ label: row.label, seats: Number(row.seats), category: row.category })),
      });
      setInfo(`${venue.name} created with ${venue.seatCount} seats.`);
      setName('');
      setCity('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that venue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Venues and seat layouts</h1>

      {error && <Notice kind="error" onDismiss={() => setError(null)}>{error}</Notice>}
      {info && <Notice kind="success" onDismiss={() => setInfo(null)}>{info}</Notice>}

      <div className="two-column">
        <section>
          <h2>Existing venues</h2>
          {venues.length === 0 ? (
            <p className="muted">No venues yet.</p>
          ) : (
            <ul className="stack">
              {venues.map((venue) => (
                <li key={venue.id} className="card">
                  <strong>{venue.name}</strong>
                  <p className="muted small">
                    {venue.city} · {venue.seatCount} seats ·{' '}
                    {venue.categories.map((category) => category.name).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Add a venue</h2>
          <form className="card stack" onSubmit={submit}>
            <div className="side-by-side">
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label>
                City
                <input value={city} onChange={(e) => setCity(e.target.value)} required />
              </label>
            </div>

            <fieldset className="stack">
              <legend>Seat categories</legend>
              {categories.map((category, index) => (
                <div className="inline-row" key={index}>
                  <input value={category} onChange={(e) => setCategory(index, e.target.value)} required />
                  {categories.length > 1 && (
                    <button type="button" className="ghost small" onClick={() => removeCategory(index)}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="ghost small" onClick={() => setCategories([...categories, ''])}>
                Add category
              </button>
            </fieldset>

            <fieldset className="stack">
              <legend>Rows ({totalSeats} seats total)</legend>
              {rows.map((row, index) => (
                <div className="inline-row" key={index}>
                  <input
                    className="tiny"
                    value={row.label}
                    onChange={(e) =>
                      setRows(rows.map((r, i) => (i === index ? { ...r, label: e.target.value.toUpperCase() } : r)))
                    }
                    aria-label={`Row ${index + 1} label`}
                    required
                  />
                  <input
                    className="tiny"
                    type="number"
                    min={1}
                    max={40}
                    value={row.seats}
                    onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, seats: e.target.value } : r)))}
                    aria-label={`Row ${index + 1} seat count`}
                    required
                  />
                  <select
                    value={row.category}
                    onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, category: e.target.value } : r)))}
                    aria-label={`Row ${index + 1} category`}
                  >
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => setRows(rows.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="ghost small"
                onClick={() =>
                  setRows([...rows, { label: nextLabel(rows.length), seats: '10', category: categories[0] ?? '' }])
                }
              >
                Add row
              </button>
            </fieldset>

            {/* Live Interactive Venue Seat Preview */}
            <div className="card venue-preview-card" style={{ marginTop: '16px', marginBottom: '16px' }}>
              <div className="venue-preview-header">
                <div>
                  <strong>Live Layout Preview</strong>
                  <p className="muted small">
                    {name.trim() || 'New Venue'} {city.trim() ? `(${city.trim()})` : ''} · {totalSeats} seats across {rows.length} rows
                  </p>
                </div>
                <span className="live-badge">Live</span>
              </div>

              <div className="venue-preview-stage" aria-hidden="true">
                STAGE / SCREEN
              </div>

              <div className="venue-preview-grid" role="region" aria-label="Venue layout preview">
                {rows.map((row, rIdx) => {
                  const count = Math.min(Math.max(0, Number(row.seats) || 0), 40);
                  const catColorIndex = Math.max(0, categories.indexOf(row.category)) % 4;
                  return (
                    <div key={rIdx} className="venue-preview-row">
                      <span className="venue-preview-row-label">{row.label || String.fromCharCode(65 + rIdx)}</span>
                      <div className="venue-preview-seats">
                        {Array.from({ length: count }).map((_, sIdx) => (
                          <div
                            key={sIdx}
                            className={`venue-preview-seat cat-color-${catColorIndex}`}
                            title={`Row ${row.label}, Seat ${sIdx + 1} (${row.category})`}
                          >
                            {sIdx + 1}
                          </div>
                        ))}
                      </div>
                      <span className="venue-preview-row-cat muted small">{row.category}</span>
                    </div>
                  );
                })}
              </div>

              <div className="venue-preview-legend">
                {categories.filter(Boolean).map((cat, idx) => (
                  <span key={idx} className="preview-legend-item">
                    <span className={`preview-legend-swatch cat-color-${idx % 4}`} />
                    <span>{cat}</span>
                  </span>
                ))}
              </div>
            </div>

            <button type="submit" className="primary" disabled={busy || totalSeats === 0}>
              Create venue
            </button>
          </form>
        </section>
      </div>
    </>
  );
};
