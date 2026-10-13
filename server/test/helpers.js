import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { config } from '../src/config.js';
import { getPool, setPool } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

/**
 * Boots the API against an isolated PostgreSQL schema on a random port.
 *
 * Each test run creates a unique schema, runs versioned migrations on it,
 * binds the server pool to that search_path, and drops the schema on close().
 */
export const startTestServer = async ({
  holdTtlSeconds = 600,
  offerTtlSeconds = 300,
  rateLimitAuthMax = 10,
  rateLimitHoldMax = 30,
  corsOrigins = 'http://localhost:5173',
  redisUrl = process.env.REDIS_URL || '',
  schema = null,
  dropSchemaOnClose = true,
} = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'seatwise-test-'));

  const testDbUrl = config.testDatabaseUrl;
  const targetSchema = schema || `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const rootClient = new pg.Client({ connectionString: testDbUrl });
  await rootClient.connect();

  if (!schema) {
    await rootClient.query(`CREATE SCHEMA "${targetSchema}"`);
    await runMigrations({ databaseUrl: testDbUrl, schema: targetSchema });
  }

  const testPool = new pg.Pool({
    connectionString: testDbUrl,
    options: `-c search_path=${targetSchema},public`,
    max: 25,
  });

  const previousPool = getPool();
  setPool(testPool);

  process.env.DATABASE_URL = `${testDbUrl}?options=-csearch_path%3D${targetSchema}`;
  process.env.REDIS_URL = redisUrl;
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
    server,
    schema: targetSchema,
    get: (path, opts) => call('GET', path, opts),
    post: (path, body, opts) => call('POST', path, { ...opts, body }),
    del: (path, body, opts) => call('DELETE', path, { ...opts, body }),
    options: (path, opts) => call('OPTIONS', path, opts),
    close: async () => {
      await new Promise((done) => server.close(done));
      await testPool.end();
      if (previousPool && previousPool !== testPool) {
        setPool(previousPool);
      }
      if (dropSchemaOnClose) {
        await rootClient.query(`DROP SCHEMA IF EXISTS "${targetSchema}" CASCADE`);
      }
      await rootClient.end();
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
