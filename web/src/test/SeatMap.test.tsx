import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SeatMap } from '../components/SeatMap';
import type { CategorySummary, Seat } from '../types';

const mockCategories: CategorySummary[] = [
  { categoryId: 1, category: 'Standard', price: 15, available: 4, total: 6 },
];

const mockSeats: Seat[] = [
  {
    id: 1,
    rowLabel: 'A',
    seatNumber: 1,
    label: 'A1',
    categoryId: 1,
    category: 'Standard',
    price: 15,
    status: 'available',
    heldByMe: false,
    holdExpiresAt: null,
    holdKind: null,
  },
  {
    id: 2,
    rowLabel: 'A',
    seatNumber: 2,
    label: 'A2',
    categoryId: 1,
    category: 'Standard',
    price: 15,
    status: 'available',
    heldByMe: false,
    holdExpiresAt: null,
    holdKind: null,
  },
  {
    id: 3,
    rowLabel: 'A',
    seatNumber: 3,
    label: 'A3',
    categoryId: 1,
    category: 'Standard',
    price: 15,
    status: 'held',
    heldByMe: false,
    holdExpiresAt: Date.now() + 60000,
    holdKind: 'checkout',
  },
  {
    id: 4,
    rowLabel: 'B',
    seatNumber: 1,
    label: 'B1',
    categoryId: 1,
    category: 'Standard',
    price: 15,
    status: 'available',
    heldByMe: false,
    holdExpiresAt: null,
    holdKind: null,
  },
  {
    id: 5,
    rowLabel: 'B',
    seatNumber: 2,
    label: 'B2',
    categoryId: 1,
    category: 'Standard',
    price: 15,
    status: 'available',
    heldByMe: false,
    holdExpiresAt: null,
    holdKind: null,
  },
  {
    id: 6,
    rowLabel: 'B',
    seatNumber: 3,
    label: 'B3',
    categoryId: 1,
    category: 'Standard',
    price: 15,
    status: 'booked',
    heldByMe: false,
    holdExpiresAt: null,
    holdKind: null,
  },
];

describe('SeatMap component', () => {
  it('renders all seats with descriptive accessible labels and status shapes', () => {
    const onToggle = vi.fn();
    render(
      <SeatMap
        seats={mockSeats}
        categories={mockCategories}
        selected={[1]}
        onToggle={onToggle}
      />
    );

    // Selected seat
    const seatA1 = screen.getByRole('button', { name: /Seat A1.*selected/i });
    expect(seatA1).toBeInTheDocument();
    expect(seatA1).toHaveAttribute('aria-pressed', 'true');
    expect(seatA1).toHaveClass('seat-selected');
    expect(seatA1.querySelector('.icon-selected')).toHaveTextContent('✓');

    // Held seat
    const seatA3 = screen.getByRole('button', { name: /Seat A3.*held by someone else/i });
    expect(seatA3).toBeDisabled();
    expect(seatA3).toHaveClass('seat-held');
    expect(seatA3.querySelector('.icon-held')).toHaveTextContent('⏱');

    // Booked seat
    const seatB3 = screen.getByRole('button', { name: /Seat B3.*booked/i });
    expect(seatB3).toBeDisabled();
    expect(seatB3).toHaveClass('seat-booked');
    expect(seatB3.querySelector('.icon-booked')).toHaveTextContent('✕');

    // Available seat
    const seatA2 = screen.getByRole('button', { name: /Seat A2.*available/i });
    expect(seatA2).not.toBeDisabled();
    expect(seatA2).toHaveClass('seat-open');
    expect(seatA2.querySelector('.icon-available')).toHaveTextContent('○');
  });

  it('calls onToggle when an available seat is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <SeatMap
        seats={mockSeats}
        categories={mockCategories}
        selected={[]}
        onToggle={onToggle}
      />
    );

    const seatA1 = screen.getByRole('button', { name: /Seat A1/i });
    await user.click(seatA1);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(mockSeats[0]);
  });

  it('does not call onToggle when disabled prop is true', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <SeatMap
        seats={mockSeats}
        categories={mockCategories}
        selected={[]}
        onToggle={onToggle}
        disabled={true}
      />
    );

    const seatA1 = screen.getByRole('button', { name: /Seat A1/i });
    expect(seatA1).toBeDisabled();
    await user.click(seatA1);

    expect(onToggle).not.toHaveBeenCalled();
  });

  it('supports 2D keyboard navigation between seats and Space/Enter selection', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <SeatMap
        seats={mockSeats}
        categories={mockCategories}
        selected={[]}
        onToggle={onToggle}
      />
    );

    const seatA1 = screen.getByRole('button', { name: /Seat A1/i });
    const seatA2 = screen.getByRole('button', { name: /Seat A2/i });
    const seatB1 = screen.getByRole('button', { name: /Seat B1/i });
    const seatB2 = screen.getByRole('button', { name: /Seat B2/i });

    // Focus first seat
    seatA1.focus();
    expect(document.activeElement).toBe(seatA1);

    // Press ArrowRight -> moves to seat A2
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(seatA2);

    // Press ArrowDown -> moves to seat B2
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(seatB2);

    // Press ArrowLeft -> moves to seat B1
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(seatB1);

    // Press ArrowUp -> moves to seat A1
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(seatA1);

    // Press Space on seat A1 to select it
    await user.keyboard(' ');
    expect(onToggle).toHaveBeenCalledWith(mockSeats[0]);
  });

  it('renders a visible legend explaining all 4 statuses with distinct non-color icons', () => {
    render(
      <SeatMap
        seats={mockSeats}
        categories={mockCategories}
        selected={[]}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Selected')).toBeInTheDocument();
    expect(screen.getByText('Held by someone')).toBeInTheDocument();
    expect(screen.getByText('Booked')).toBeInTheDocument();
  });
});
