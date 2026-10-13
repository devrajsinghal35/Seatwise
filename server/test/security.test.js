import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { register, startTestServer } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(__dirname, '..');

let api;
let customerToken;
let showId;

before(async () => {
  api = await startTestServer({
    corsOrigins: 'http://localhost:5173',
  });

  customerToken = await register(api, 'security_test@example.com', 'customer');

  const { db } = await import('../src/db/index.js');
  const show = await db.prepare('SELECT id FROM shows LIMIT 1').get();
  showId = show?.id ?? 1;
});

after(async () => api.close());

describe('CORS allowlist & preflight', () => {
  it('allows requests from configured origin', async () => {
    const res = await api.get('/api/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(res.headers.get('vary'), 'Origin');
  });

  it('handles OPTIONS preflight for allowed origin', async () => {
    const res = await api.options('/api/bookings', {
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.ok(res.headers.get('access-control-allow-methods').includes('POST'));
  });

  it('rejects OPTIONS preflight from unlisted origin', async () => {
    const res = await api.options('/api/bookings', {
      headers: {
        Origin: 'http://malicious-site.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('does not send allow-origin header for unlisted origin on GET', async () => {
    const res = await api.get('/api/health', {
      headers: { Origin: 'http://malicious-site.example' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

describe('Production JWT_SECRET validation', () => {
  it('refuses to start in production if JWT_SECRET is unset or default', () => {
    const checkDefault = `
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'seatwise-dev-secret-change-me';
      await import('./src/config.js');
    `;
    const resDefault = spawnSync('node', ['--input-type=module', '-e', checkDefault], {
      cwd: serverRoot,
      encoding: 'utf8',
    });
    assert.notEqual(resDefault.status, 0);
    assert.match(resDefault.stderr, /JWT_SECRET must be set to a secure secret in production/);

    const checkPlaceholder = `
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'change-this-to-a-long-random-string';
      await import('./src/config.js');
    `;
    const resPlaceholder = spawnSync('node', ['--input-type=module', '-e', checkPlaceholder], {
      cwd: serverRoot,
      encoding: 'utf8',
    });
    assert.notEqual(resPlaceholder.status, 0);
    assert.match(resPlaceholder.stderr, /JWT_SECRET must be set to a secure secret in production/);
  });
});

describe('Rate limiting', () => {
  it('returns 429 when auth attempts exceed rate limit', async () => {
    // Start an isolated test server with a tight auth limit of 3
    const rateLimitApi = await startTestServer({ rateLimitAuthMax: 3 });

    try {
      let lastStatus = 200;
      let lastBody = null;

      for (let i = 0; i < 4; i += 1) {
        const res = await rateLimitApi.post('/api/auth/login', {
          email: 'nobody@example.com',
          password: 'wrong-password',
        });
        lastStatus = res.status;
        lastBody = res.body;
      }

      assert.equal(lastStatus, 429);
      assert.equal(lastBody.error, 'rate_limited');
    } finally {
      await rateLimitApi.close();
      delete process.env.RATE_LIMIT_AUTH_MAX;
      const { resetLimiters } = await import('../src/lib/rateLimit.js');
      await resetLimiters('127.0.0.1');
    }
  });
});

describe('Zod request body validation', () => {
  it('returns 400 with field details on invalid registration', async () => {
    const res = await api.post('/api/auth/register', {
      email: 'not-an-email',
      password: 'short',
      name: '',
      role: 'admin',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
    assert.ok(res.body.details);
    assert.ok(res.body.details.email);
    assert.ok(res.body.details.password);
    assert.ok(res.body.details.name);
    assert.ok(res.body.details.role);
  });

  it('returns 400 when seatIds are invalid, empty, or exceed 8 seats', async () => {
    const emptyRes = await api.post(
      `/api/shows/${showId}/hold`,
      { seatIds: [] },
      { token: customerToken }
    );
    assert.equal(emptyRes.status, 400);
    assert.equal(emptyRes.body.error, 'invalid_request');
    assert.ok(emptyRes.body.details.seatIds);

    const tooManyRes = await api.post(
      `/api/shows/${showId}/hold`,
      { seatIds: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { token: customerToken }
    );
    assert.equal(tooManyRes.status, 400);
    assert.equal(tooManyRes.body.error, 'invalid_request');
    assert.ok(tooManyRes.body.details.seatIds);

    const negativeRes = await api.post(
      `/api/shows/${showId}/hold`,
      { seatIds: [-5] },
      { token: customerToken }
    );
    assert.equal(negativeRes.status, 400);
    assert.equal(negativeRes.body.error, 'invalid_request');
  });

  it('returns 400 on checkout with invalid phone or email', async () => {
    const res = await api.post(
      '/api/bookings',
      {
        showId,
        guestName: 'Test Guest',
        guestMobile: 'invalid-non-digits!@#',
        guestEmail: 'invalid-email',
      },
      { token: customerToken }
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
    assert.ok(res.body.details.guestMobile);
    assert.ok(res.body.details.guestEmail);
  });
});
