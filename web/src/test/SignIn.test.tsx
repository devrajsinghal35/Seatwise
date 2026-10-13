import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as authModule from '../auth';
import { SignIn } from '../pages/SignIn';
import type { User } from '../types';

describe('SignIn component', () => {
  const mockSignIn = vi.fn();
  const mockSignUp = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(authModule, 'useAuth').mockReturnValue({
      user: null,
      loading: false,
      signIn: mockSignIn,
      signUp: mockSignUp,
      signOut: vi.fn(),
    });
  });

  it('renders email and password inputs and submits credentials', async () => {
    const user = userEvent.setup();
    const customerUser: User = { id: 1, email: 'priya@example.com', name: 'Priya', role: 'customer' };
    mockSignIn.mockResolvedValueOnce(customerUser);

    render(
      <MemoryRouter initialEntries={['/signin']}>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/" element={<div>Home Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    const emailInput = screen.getByLabelText(/Email/i);
    const passwordInput = screen.getByLabelText(/Password/i);
    const submitBtn = screen.getByRole('button', { name: /^Sign in$/i });

    await user.type(emailInput, 'priya@example.com');
    await user.type(passwordInput, 'Password123');
    await user.click(submitBtn);

    expect(mockSignIn).toHaveBeenCalledWith('priya@example.com', 'Password123');
    expect(await screen.findByText('Home Page')).toBeInTheDocument();
  });

  it('redirects to the intended internal "from" location state', async () => {
    const user = userEvent.setup();
    const customerUser: User = { id: 1, email: 'priya@example.com', name: 'Priya', role: 'customer' };
    mockSignIn.mockResolvedValueOnce(customerUser);

    render(
      <MemoryRouter initialEntries={[{ pathname: '/signin', state: { from: '/shows/42' } }]}>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/shows/42" element={<div>Show 42 Seat Map</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/Email/i), 'priya@example.com');
    await user.type(screen.getByLabelText(/Password/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /^Sign in$/i }));

    expect(await screen.findByText('Show 42 Seat Map')).toBeInTheDocument();
  });

  it('rejects untrusted external redirect URLs and falls back to role default', async () => {
    const user = userEvent.setup();
    const organiserUser: User = { id: 2, email: 'org@seatwise.test', name: 'Org', role: 'organiser' };
    mockSignIn.mockResolvedValueOnce(organiserUser);

    // Malicious open redirect attempt in state
    render(
      <MemoryRouter initialEntries={[{ pathname: '/signin', state: { from: 'https://evil.example.com' } }]}>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/organiser" element={<div>Organiser Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByLabelText(/Email/i), 'org@seatwise.test');
    await user.type(screen.getByLabelText(/Password/i), 'Password123');
    await user.click(screen.getByRole('button', { name: /^Sign in$/i }));

    // Must navigate to /organiser instead of external target
    expect(await screen.findByText('Organiser Dashboard')).toBeInTheDocument();
  });

  it('shows demo account drawer and fills credentials when VITE_SHOW_DEMO is true', async () => {
    vi.stubEnv('VITE_SHOW_DEMO', 'true');
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/signin']}>
        <SignIn />
      </MemoryRouter>
    );

    const drawerSummary = screen.getByText('Try a demo account');
    expect(drawerSummary).toBeInTheDocument();

    const customerDemoBtn = screen.getByRole('button', { name: /Customer.*priya@example\.com/i });
    await user.click(customerDemoBtn);

    const emailInput = screen.getByLabelText(/Email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/Password/i) as HTMLInputElement;

    expect(emailInput.value).toBe('priya@example.com');
    expect(passwordInput.value).toBe('Password123');

    vi.unstubAllEnvs();
  });

  it('hides demo account drawer when VITE_SHOW_DEMO is not true', () => {
    vi.stubEnv('VITE_SHOW_DEMO', 'false');

    render(
      <MemoryRouter initialEntries={['/signin']}>
        <SignIn />
      </MemoryRouter>
    );

    expect(screen.queryByText('Try a demo account')).not.toBeInTheDocument();

    vi.unstubAllEnvs();
  });
});
