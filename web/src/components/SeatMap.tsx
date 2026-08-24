import { useMemo } from 'react';
import { formatMoney } from '../format';
import type { CategorySummary, Seat } from '../types';

interface SeatMapProps {
  seats: Seat[];
  categories: CategorySummary[];
  selected: number[];
  onToggle: (seat: Seat) => void;
  disabled?: boolean;
}

const statusClass = (seat: Seat, isSelected: boolean) => {
  if (isSelected) return 'seat seat-selected';
  if (seat.status === 'booked') return 'seat seat-booked';
  if (seat.status === 'held') return seat.heldByMe ? 'seat seat-mine' : 'seat seat-held';
  return 'seat seat-open';
};

const describe = (seat: Seat, isSelected: boolean) => {
  if (seat.status === 'booked') return `${seat.label} is already booked`;
  if (seat.status === 'held' && !seat.heldByMe) return `${seat.label} is being booked by someone else`;
  if (seat.heldByMe) return `${seat.label} is held for you`;
  return `${seat.label}, ${seat.category}, ${formatMoney(seat.price)}${isSelected ? ', selected' : ''}`;
};

export const SeatMap = ({ seats, categories, selected, onToggle, disabled }: SeatMapProps) => {
  // Group into rows once per seat change rather than on every render.
  const rows = useMemo(() => {
    const grouped = new Map<string, Seat[]>();
    for (const seat of seats) {
      const row = grouped.get(seat.rowLabel) ?? [];
      row.push(seat);
      grouped.set(seat.rowLabel, row);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, rowSeats]) => ({
        label,
        category: rowSeats[0]?.category ?? '',
        seats: [...rowSeats].sort((a, b) => a.seatNumber - b.seatNumber),
      }));
  }, [seats]);

  return (
    <div className="seatmap">
      <div className="screen" aria-hidden="true">
        Screen / Stage
      </div>

      <div className="seat-rows">
        {rows.map((row) => (
          <div className="seat-row" key={row.label}>
            <span className="row-label" title={row.category}>
              {row.label}
            </span>
            <div className="row-seats">
              {row.seats.map((seat) => {
                const isSelected = selected.includes(seat.id);
                const takeable = seat.status === 'available' || (seat.status === 'held' && seat.heldByMe);

                return (
                  <button
                    type="button"
                    key={seat.id}
                    className={statusClass(seat, isSelected)}
                    onClick={() => onToggle(seat)}
                    disabled={disabled || !takeable}
                    aria-pressed={isSelected}
                    aria-label={describe(seat, isSelected)}
                    title={describe(seat, isSelected)}
                  >
                    {seat.seatNumber}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="legend">
        {categories.map((category) => (
          <span key={category.categoryId} className="legend-item">
            <strong>{category.category}</strong>
            {category.price !== null && <> {formatMoney(category.price)}</>}
            <em>
              {category.available} of {category.total} free
            </em>
          </span>
        ))}
      </div>

      <div className="legend legend-keys">
        <span className="legend-key">
          <i className="seat seat-open" /> Available
        </span>
        <span className="legend-key">
          <i className="seat seat-selected" /> Selected
        </span>
        <span className="legend-key">
          <i className="seat seat-held" /> Held by someone
        </span>
        <span className="legend-key">
          <i className="seat seat-booked" /> Booked
        </span>
      </div>
    </div>
  );
};
