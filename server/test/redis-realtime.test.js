import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { config } from '../src/config.js';
import { closeRedis } from '../src/lib/redis.js';
import { runMigrations } from '../src/db/migrate.js';
import { register, startTestServer } from './helpers.js';

let instanceA;
let instanceB;
let rootClient;
let sharedSchema;
let adminTokenA;
let customerTokenA;
let show;
let seat;

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

before(async () => {
  sharedSchema = `test_realtime_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const testDbUrl = config.testDatabaseUrl;

  rootClient = new pg.Client({ connectionString: testDbUrl });
  await rootClient.connect();
  await rootClient.query(`CREATE SCHEMA "${sharedSchema}"`);
  await runMigrations({ databaseUrl: testDbUrl, schema: sharedSchema });

  // Start Instance A
  instanceA = await startTestServer({
    schema: sharedSchema,
    dropSchemaOnClose: false,
    redisUrl: REDIS_URL,
  });

  // Start Instance B
  instanceB = await startTestServer({
    schema: sharedSchema,
    dropSchemaOnClose: false,
    redisUrl: REDIS_URL,
  });

  // Setup Admin & Customer on Instance A
  const { db } = await import('../src/db/index.js');
  const { hashPassword } = await import('../src/lib/passwords.js');

  await db.prepare('INSERT INTO users (email, name, password, role) VALUES (?, ?, ?, ?)')
    .run('realtime_admin@seatwise.test', 'Admin', hashPassword('Password123'), 'admin');

  const loginRes = await instanceA.post('/api/auth/login', {
    email: 'realtime_admin@seatwise.test',
    password: 'Password123',
  });
  adminTokenA = loginRes.body.token;

  customerTokenA = await register(instanceA, 'realtime_customer@seatwise.test', 'customer');
  const organiserTokenA = await register(instanceA, 'realtime_organiser@seatwise.test', 'organiser');

  // Create venue via Admin, event & show via Organiser
  const venueRes = await instanceA.post(
    '/api/venues',
    {
      name: 'Realtime Hall',
      city: 'Delhi',
      categories: ['Standard'],
      rows: [{ label: 'A', seats: 4, category: 'Standard' }],
    },
    { token: adminTokenA }
  );
  assert.equal(venueRes.status, 201);

  const eventRes = await instanceA.post(
    '/api/events',
    { title: 'Realtime Event', kind: 'concert' },
    { token: organiserTokenA }
  );
  assert.equal(eventRes.status, 201);

  const showRes = await instanceA.post(
    '/api/shows',
    {
      eventId: eventRes.body.event.id,
      venueId: venueRes.body.venue.id,
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      prices: { Standard: 200 },
    },
    { token: organiserTokenA }
  );
  assert.equal(showRes.status, 201);
  show = showRes.body.show;

  const seatsRes = await instanceA.get(`/api/shows/${show.id}/seats`);
  seat = seatsRes.body.seats[0];
});

after(async () => {
  if (instanceA) await instanceA.close();
  if (instanceB) await instanceB.close();
  await closeRedis();
  if (rootClient) {
    await rootClient.query(`DROP SCHEMA IF EXISTS "${sharedSchema}" CASCADE`);
    await rootClient.end();
  }
});

describe('Redis Multi-Instance Distributed Real-time & Health', () => {
  it('reports healthy Postgres and Redis on /api/health', async () => {
    const resA = await instanceA.get('/api/health');
    assert.equal(resA.status, 200);
    assert.equal(resA.body.status, 'ok');
    assert.equal(resA.body.postgres, 'ok');
    assert.equal(resA.body.redis, 'ok');

    const resB = await instanceB.get('/api/health');
    assert.equal(resB.status, 200);
    assert.equal(resB.body.status, 'ok');
    assert.equal(resB.body.postgres, 'ok');
    assert.equal(resB.body.redis, 'ok');
  });

  it('receives seat change event on Instance B when seat is held on Instance A', async () => {
    // 1. Connect SSE reader to Instance B
    const sseResponse = await fetch(`${instanceB.base}/api/shows/${show.id}/stream`);
    assert.equal(sseResponse.status, 200);
    assert.equal(sseResponse.headers.get('content-type'), 'text/event-stream');

    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';

    const readPromise = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        if (accumulated.includes('event: seats') && accumulated.includes(`"id":${seat.id}`)) {
          return accumulated;
        }
      }
      return accumulated;
    })();

    // Allow SSE subscription to register in Redis
    await new Promise((r) => setTimeout(r, 200));

    // 2. Customer holds seat via Instance A
    const holdRes = await instanceA.post(
      `/api/shows/${show.id}/hold`,
      { seatIds: [seat.id] },
      { token: customerTokenA }
    );
    assert.equal(holdRes.status, 200);

    // 3. Instance B's SSE reader must receive the forwarded event from Redis within 3 seconds
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out waiting for SSE update. Received so far: ${accumulated}`)), 3000)
    );

    const received = await Promise.race([readPromise, timeout]);
    assert.ok(received.includes('event: seats'), 'Must contain event: seats');
    assert.ok(received.includes(`"id":${seat.id}`), 'Must contain the held seat id');
    assert.ok(received.includes('"status":"held"'), 'Must contain status: held');

    // Cancel SSE reader stream
    await reader.cancel();
  });
});
