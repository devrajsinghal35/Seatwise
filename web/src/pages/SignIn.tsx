import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { Notice } from '../components/Notice';
import type { Role } from '../types';

const DEMO_ACCOUNTS = [
  { email: 'priya@example.com', role: 'Customer' },
  { email: 'organiser@seatwise.test', role: 'Organiser' },
  { email: 'admin@seatwise.test', role: 'Admin' },
];

export const SignIn = () => {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('customer');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const user = mode === 'signin' ? await signIn(email, password) : await signUp({ email, password, name, role });
      navigate(user.role === 'organiser' ? '/organiser' : user.role === 'admin' ? '/venues' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const useDemo = (demoEmail: string) => {
    setMode('signin');
    setEmail(demoEmail);
    setPassword('Password123');
    setError(null);
  };

  return (
    <div className="narrow">
      <h1>{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>

      {error && <Notice kind="error">{error}</Notice>}

      <form onSubmit={submit} className="card stack">
        {mode === 'signup' && (
          <label>
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </label>
        )}

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </label>

        {mode === 'signup' && (
          <fieldset className="roles">
            <legend>I want to</legend>
            <label className="radio">
              <input type="radio" checked={role === 'customer'} onChange={() => setRole('customer')} />
              Book tickets
            </label>
            <label className="radio">
              <input type="radio" checked={role === 'organiser'} onChange={() => setRole('organiser')} />
              List events as an organiser
            </label>
          </fieldset>
        )}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p className="muted">
        {mode === 'signin' ? 'Need an account?' : 'Already registered?'}{' '}
        <button type="button" className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Create one' : 'Sign in'}
        </button>
      </p>

      <div className="card demo-accounts">
        <h2>Demo accounts</h2>
        <p className="muted">Seeded by <code>npm run seed</code>. The password for all of them is Password123.</p>
        <ul>
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button type="button" className="link" onClick={() => useDemo(account.email)}>
                {account.email}
              </button>
              <span className="muted"> {account.role}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
