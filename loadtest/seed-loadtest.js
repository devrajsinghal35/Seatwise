import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(__dirname, '../server');
const serverRequire = createRequire(resolve(serverDir, 'src/index.js'));
const pg = serverRequire('pg');
const jwt = serverRequire('jsonwebtoken');

const databaseUrl = process.env.DATABASE_URL || 'postgres://localhost:5432/seatwise';
const pool = new pg.Pool({ connectionString: databaseUrl });

const JWT_SECRET = process.env.JWT_SECRET || 'seatwise-dev-secret-change-me';
const sign = (user) => jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });

async function seed() {
  const { runMigrations } = await import('../server/src/db/migrate.js');
  await runMigrations({ databaseUrl });

  // Wipe all tables
  await pool.query(`
    TRUNCATE TABLE booking_seats, bookings, waitlist, show_seats, show_prices,
                   shows, events, seats, categories, venues, users RESTART IDENTITY CASCADE
  `);

  const insertUser = async (email, name, role) => {
    const res = await pool.query(
      'INSERT INTO users (email, name, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, name, 'mock_hash', role]
    );
    return res.rows[0].id;
  };

  const adminId = await insertUser('admin@seatwise.load', 'Load Admin', 'admin');
  const organiserId = await insertUser('organiser@seatwise.load', 'Load Organiser', 'organiser');

  // Seed 250 distinct customer users for up to 200 concurrent VUs
  const tokens = [];
  for (let i = 1; i <= 250; i += 1) {
    const email = `vu_${i}@seatwise.load`;
    const userId = await insertUser(email, `VU ${i}`, 'customer');
    tokens.push(sign({ id: userId, role: 'customer' }));
  }

  // --- Show 1: 20-Seat Race Show ---
  const insertVenue = async (name, city) => {
    const res = await pool.query('INSERT INTO venues (name, city, created_by) VALUES ($1, $2, $3) RETURNING id', [
      name,
      city,
      adminId,
    ]);
    return res.rows[0].id;
  };
  const raceVenueId = await insertVenue('Race Colosseum', 'Mumbai');

  const insertCat = async (venueId, name) => {
    const res = await pool.query('INSERT INTO categories (venue_id, name) VALUES ($1, $2) RETURNING id', [venueId, name]);
    return res.rows[0].id;
  };
  const raceCatId = await insertCat(raceVenueId, 'Standard');

  const raceSeatIds = [];
  for (const row of ['A', 'B']) {
    for (let num = 1; num <= 10; num += 1) {
      const res = await pool.query(
        'INSERT INTO seats (venue_id, category_id, row_label, seat_number) VALUES ($1, $2, $3, $4) RETURNING id',
        [raceVenueId, raceCatId, row, num]
      );
      raceSeatIds.push(res.rows[0].id);
    }
  }

  const insertEvent = async (title, kind) => {
    const res = await pool.query(
      'INSERT INTO events (organiser_id, title, kind, description, language, runtime_min) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [organiserId, title, kind, 'Load testing contention', 'English', 120]
    );
    return res.rows[0].id;
  };
  const raceEventId = await insertEvent('Contention Grand Prix', 'concert');

  const raceStartsAt = new Date(Date.now() + 86400000).toISOString();
  const raceShowRes = await pool.query(
    'INSERT INTO shows (event_id, venue_id, starts_at) VALUES ($1, $2, $3) RETURNING id',
    [raceEventId, raceVenueId, raceStartsAt]
  );
  const raceShowId = raceShowRes.rows[0].id;

  await pool.query('INSERT INTO show_prices (show_id, category_id, price) VALUES ($1, $2, $3)', [
    raceShowId,
    raceCatId,
    500,
  ]);

  const raceSeats = [];
  for (const seatId of raceSeatIds) {
    const res = await pool.query(
      'INSERT INTO show_seats (show_id, seat_id, category_id, price, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [raceShowId, seatId, raceCatId, 500, 'available']
    );
    raceSeats.push({ id: res.rows[0].id, seatId });
  }

  // --- Show 2: 50-Seat Mixed Show ---
  const mixedVenueId = await insertVenue('Mixed Arena', 'Bengaluru');
  const mixedCatId = await insertCat(mixedVenueId, 'General');

  const mixedSeatIds = [];
  for (const row of ['A', 'B', 'C', 'D', 'E']) {
    for (let num = 1; num <= 10; num += 1) {
      const res = await pool.query(
        'INSERT INTO seats (venue_id, category_id, row_label, seat_number) VALUES ($1, $2, $3, $4) RETURNING id',
        [mixedVenueId, mixedCatId, row, num]
      );
      mixedSeatIds.push(res.rows[0].id);
    }
  }

  const mixedEventId = await insertEvent('Mixed Live Fest', 'movie');
  const mixedStartsAt = new Date(Date.now() + 172800000).toISOString();
  const mixedShowRes = await pool.query(
    'INSERT INTO shows (event_id, venue_id, starts_at) VALUES ($1, $2, $3) RETURNING id',
    [mixedEventId, mixedVenueId, mixedStartsAt]
  );
  const mixedShowId = mixedShowRes.rows[0].id;

  await pool.query('INSERT INTO show_prices (show_id, category_id, price) VALUES ($1, $2, $3)', [
    mixedShowId,
    mixedCatId,
    300,
  ]);

  const mixedSeats = [];
  for (const seatId of mixedSeatIds) {
    const res = await pool.query(
      'INSERT INTO show_seats (show_id, seat_id, category_id, price, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [mixedShowId, seatId, mixedCatId, 300, 'available']
    );
    mixedSeats.push({ id: res.rows[0].id, seatId });
  }

  const output = {
    baseUrl: process.env.API_URL || 'http://127.0.0.1:4000',
    raceShowId,
    raceSeats,
    mixedShowId,
    mixedSeats,
    tokens,
  };

  mkdirSync(resolve(__dirname, 'results'), { recursive: true });
  writeFileSync(resolve(__dirname, 'data.json'), JSON.stringify(output, null, 2));

  console.log('Seeded database for load test on PostgreSQL:');
  console.log(`  Users seeded: 250 customers (tokens saved to loadtest/data.json)`);
  console.log(`  Show 1 (Race): showId=${raceShowId}, total seats=${raceSeats.length}`);
  console.log(`  Show 2 (Mixed): showId=${mixedShowId}, total seats=${mixedSeats.length}`);

  await pool.end();
}

seed().catch((err) => {
  console.error('Failed to seed loadtest:', err);
  process.exit(1);
});
