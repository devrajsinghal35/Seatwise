import { render } from '@testing-library/react';
import axe from 'axe-core';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import * as authModule from '../auth';
import { SeatMap } from '../components/SeatMap';
import { SignIn } from '../pages/SignIn';
import type { CategorySummary, Seat } from '../types';

const mockCategories: CategorySummary[] = [
  { categoryId: 1, category: 'Standard', price: 15, available: 2, total: 4 },
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
    status: 'held',
    heldByMe: false,
    holdExpiresAt: Date.now() + 60000,
    holdKind: 'checkout',
  },
  {
    id: 3,
    rowLabel: 'B',
    seatNumber: 1,
    label: 'B1',
    categoryId: 1,
    category: 'Standard',
    price: 15,
    status: 'booked',
    heldByMe: false,
    holdExpiresAt: null,
    holdKind: null,
  },
];

describe('Accessibility Audit (axe-core)', () => {
  it('SeatMap has zero accessibility violations', async () => {
    const { container } = render(
      <SeatMap
        seats={mockSeats}
        categories={mockCategories}
        selected={[1]}
        onToggle={vi.fn()}
      />
    );

    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa'],
      },
    });

    expect(results.violations).toEqual([]);
  });

  it('SignIn page has zero accessibility violations', async () => {
    vi.spyOn(authModule, 'useAuth').mockReturnValue({
      user: null,
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/signin']}>
        <SignIn />
      </MemoryRouter>
    );

    const results = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa'],
      },
    });

    expect(results.violations).toEqual([]);
  });
});
