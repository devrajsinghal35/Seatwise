import React, { useCallback, useMemo, useRef, useState } from 'react';
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
  if (seat.status === 'booked') return `Seat ${seat.label}, booked`;
  if (seat.status === 'held' && !seat.heldByMe) return `Seat ${seat.label}, held by someone else`;
  if (seat.heldByMe) return `Seat ${seat.label}, held for you`;
  return `Seat ${seat.label}, ${seat.category}, ${formatMoney(seat.price)}${isSelected ? ', selected' : ', available'}`;
};

interface SeatButtonProps {
  seat: Seat;
  isSelected: boolean;
  disabled?: boolean;
  onToggle: (seat: Seat) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, rowIdx: number, colIdx: number) => void;
  rowIdx: number;
  colIdx: number;
  setRef: (rowIdx: number, colIdx: number, el: HTMLButtonElement | null) => void;
}

const SeatButton = React.memo(
  ({ seat, isSelected, disabled, onToggle, onKeyDown, rowIdx, colIdx, setRef }: SeatButtonProps) => {
    const takeable = seat.status === 'available' || (seat.status === 'held' && seat.heldByMe);
    const isBooked = seat.status === 'booked';
    const isHeldByOther = seat.status === 'held' && !seat.heldByMe;

    const handleClick = useCallback(() => {
      if (!disabled && takeable) {
        onToggle(seat);
      }
    }, [disabled, takeable, onToggle, seat]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown(e, rowIdx, colIdx);
      },
      [onKeyDown, rowIdx, colIdx]
    );

    const refCallback = useCallback(
      (el: HTMLButtonElement | null) => {
        setRef(rowIdx, colIdx, el);
      },
      [setRef, rowIdx, colIdx]
    );

    return (
      <button
        ref={refCallback}
        type="button"
        className={statusClass(seat, isSelected)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        disabled={disabled || !takeable}
        aria-pressed={isSelected}
        aria-label={describe(seat, isSelected)}
        title={describe(seat, isSelected)}
        data-row={rowIdx}
        data-col={colIdx}
        data-seat-id={seat.id}
      >
        <span className="seat-status-indicator" aria-hidden="true">
          {isSelected && <span className="status-icon icon-selected">✓</span>}
          {isBooked && <span className="status-icon icon-booked">✕</span>}
          {isHeldByOther && <span className="status-icon icon-held">⏱</span>}
          {!isSelected && !isBooked && !isHeldByOther && (
            <span className="status-icon icon-available">○</span>
          )}
        </span>
        <span className="seat-number">{seat.seatNumber}</span>
      </button>
    );
  }
);
SeatButton.displayName = 'SeatButton';

export const SeatMap = ({ seats, categories, selected, onToggle, disabled }: SeatMapProps) => {
  const [zoomLevel, setZoomLevel] = useState<'fit' | 'normal'>('normal');
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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

  const setRef = useCallback((rowIdx: number, colIdx: number, el: HTMLButtonElement | null) => {
    const key = `${rowIdx}:${colIdx}`;
    if (el) {
      buttonRefs.current.set(key, el);
    } else {
      buttonRefs.current.delete(key);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, rowIdx: number, colIdx: number) => {
      let nextRow = rowIdx;
      let nextCol = colIdx;

      switch (e.key) {
        case 'ArrowRight':
          nextCol = colIdx + 1;
          e.preventDefault();
          break;
        case 'ArrowLeft':
          nextCol = colIdx - 1;
          e.preventDefault();
          break;
        case 'ArrowDown':
          nextRow = rowIdx + 1;
          e.preventDefault();
          break;
        case 'ArrowUp':
          nextRow = rowIdx - 1;
          e.preventDefault();
          break;
        case 'Home':
          nextCol = 0;
          e.preventDefault();
          break;
        case 'End':
          nextCol = (rows[rowIdx]?.seats.length ?? 1) - 1;
          e.preventDefault();
          break;
        default:
          return;
      }

      // Clamp target within bounds
      if (nextRow < 0) nextRow = 0;
      if (nextRow >= rows.length) nextRow = rows.length - 1;

      const targetRowSeats = rows[nextRow]?.seats ?? [];
      if (nextCol < 0) nextCol = 0;
      if (nextCol >= targetRowSeats.length) nextCol = targetRowSeats.length - 1;

      const targetEl = buttonRefs.current.get(`${nextRow}:${nextCol}`);
      if (targetEl) {
        targetEl.focus();
      }
    },
    [rows]
  );

  return (
    <div className={`seatmap ${zoomLevel === 'fit' ? 'seatmap-fit' : ''}`}>
      <div className="seatmap-toolbar">
        <div className="screen" aria-hidden="true">
          Screen / Stage
        </div>
        <div className="seatmap-view-controls">
          <button
            type="button"
            className={`ghost small ${zoomLevel === 'fit' ? 'active' : ''}`}
            onClick={() => setZoomLevel((z) => (z === 'fit' ? 'normal' : 'fit'))}
            aria-label={zoomLevel === 'fit' ? 'Zoom to standard view' : 'Fit seat map to screen'}
            title={zoomLevel === 'fit' ? 'Standard 100% view' : 'Scale to fit screen'}
          >
            {zoomLevel === 'fit' ? '🔍 Standard' : '📱 Fit to screen'}
          </button>
        </div>
      </div>

      <div className="seat-scroll-container" tabIndex={0} aria-label="Seating area. Use arrow keys to navigate between seats.">
        <div className="seat-rows">
          {rows.map((row, rowIdx) => (
            <div className="seat-row" key={row.label} role="group" aria-label={`Row ${row.label}`}>
              <span className="row-label" title={row.category} aria-hidden="true">
                {row.label}
              </span>
              <div className="row-seats">
                {row.seats.map((seat, colIdx) => {
                  const isSelected = selected.includes(seat.id);

                  return (
                    <SeatButton
                      key={seat.id}
                      seat={seat}
                      isSelected={isSelected}
                      disabled={disabled}
                      onToggle={onToggle}
                      onKeyDown={handleKeyDown}
                      rowIdx={rowIdx}
                      colIdx={colIdx}
                      setRef={setRef}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
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

      <div className="legend legend-keys" aria-label="Seat status key">
        <span className="legend-key">
          <span className="seat-legend-sample seat-open" aria-hidden="true">
            <span className="status-icon icon-available">○</span>
          </span>{' '}
          Available
        </span>
        <span className="legend-key">
          <span className="seat-legend-sample seat-selected" aria-hidden="true">
            <span className="status-icon icon-selected">✓</span>
          </span>{' '}
          Selected
        </span>
        <span className="legend-key">
          <span className="seat-legend-sample seat-held" aria-hidden="true">
            <span className="status-icon icon-held">⏱</span>
          </span>{' '}
          Held by someone
        </span>
        <span className="legend-key">
          <span className="seat-legend-sample seat-booked" aria-hidden="true">
            <span className="status-icon icon-booked">✕</span>
          </span>{' '}
          Booked
        </span>
      </div>
    </div>
  );
};
