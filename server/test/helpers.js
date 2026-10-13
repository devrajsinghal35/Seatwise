import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Boots the API against a throwaway SQLite file on a random port.
 *
 * config.js and db/index.js both read their settings at import time, so the
 * environment has to be set before the dynamic imports below.
 */
export const startTestServer = async ({
  holdTtlSeconds = 600,
  offerTtlSeconds = 300,
  rateLimitAuthMax = 10,
  rateLimitHoldMax = 30,
  corsOrigins = 'http://localhost:5173',
} = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'seatwise-test-'));

  process.env.DATABASE_FILE = join(dir, 'test.db');
  process.env.HOLD_TTL_SECONDS = String(holdTtlSeconds);
  process.env.OFFER_TTL_SECONDS = String(offerTtlSeconds);
  process.env.RATE_LIMIT_AUTH_MAX = String(rateLimitAuthMax);
  process.env.RATE_LIMIT_HOLD_MAX = String(rateLimitHoldMax);
  process.env.CORS_ORIGINS = String(corsOrigins);
  process.env.JWT_SECRET = 'test-secret';
  process.env.BREVO_API_KEY = '';
  process.env.MAIL_OUTBOX = join(dir, 'outbox');

  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(0);
  await new Promise((done) => server.once('listening', done));

  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { token, body: reqBody, headers } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(reqBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: reqBody ? JSON.stringify(reqBody) : undefined,
    });
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: res.status, headers: res.headers, body };
  };

  return {
    base,
    get: (path, opts) => call('GET', path, opts),
    post: (path, body, opts) => call('POST', path, { ...opts, body }),
    del: (path, body, opts) => call('DELETE', path, { ...opts, body }),
    options: (path, opts) => call('OPTIONS', path, opts),
    close: async () => {
      await new Promise((done) => server.close(done));
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

export const register = async (api, email, role = 'customer') => {
  const { body } = await api.post('/api/auth/register', {
    email,
    password: 'Password123',
    name: email.split('@')[0],
    role,
  });
  return body.token;
};
