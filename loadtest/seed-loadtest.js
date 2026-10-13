import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(__dirname, '../server');
const serverRequire = createRequire(resolve(serverDir, 'src/index.js'));
const Database = serverRequire('better-sqlite3');
const jwt = serverRequire('jsonwebtoken');

const schemaSql = readFileSync(resolve(serverDir, 'src/db/schema.sql'), 'utf8');

const dbFile = process.env.DATABASE_FILE || resolve(serverDir, 'data/seatwise.db');
mkdirSync(dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(schemaSql);

const JWT_SECRET = process.env.JWT_SECRET || 'seatwise-dev-secret-change-me';
const sign = (user) => jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });

const seed = () => {
  // Wipe all tables
  for (const table of [
    'booking_seats',
    'bookings',
    'waitlist',
    'show_seats',
    'show_prices',
    'shows',
    'events',
    'seats',
    'categories',
    'venues',
    'users',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }

  const insertUser = db.prepare('INSERT INTO users (email, name, password, role) VALUES (?, ?, ?, ?)');

  const adminId = Number(insertUser.run('admin@seatwise.load', 'Load Admin', 'mock_hash', 'admin').lastInsertRowid);
  const organiserId = Number(
    insertUser.run('organiser@seatwise.load', 'Load Organiser', 'mock_hash', 'organiser').lastInsertRowid
  );

  // Seed 250 distinct customer users for up to 200 concurrent VUs
  const tokens = [];
  for (let i = 1; i <= 250; i += 1) {
    const email = `vu_${i}@seatwise.load`;
    const userId = Number(insertUser.run(email, `VU ${i}`, 'mock_hash', 'customer').lastInsertRowid);
    tokens.push(sign({ id: userId, role: 'customer' }));
  }

  // --- Show 1: 20-Seat Race Show ---
  // Venue 1: exactly 20 seats (2 rows of 10)
  const insertVenue = db.prepare('INSERT INTO venues (name, city, created_by) VALUES (?, ?, ?)');
  const raceVenueId = Number(insertVenue.run('Race Colosseum', 'Mumbai', adminId).lastInsertRowid);

  const insertCategory = db.prepare('INSERT INTO categories (venue_id, name) VALUES (?, ?)');
  const raceCatId = Number(insertCategory.run(raceVenueId, 'Standard').lastInsertRowid);

  const insertSeat = db.prepare(
    'INSERT INTO seats (venue_id, category_id, row_label, seat_number) VALUES (?, ?, ?, ?)'
  );
  const raceSeatIds = [];
  for (const row of ['A', 'B']) {
    for (let num = 1; num <= 10; num += 1) {
      raceSeatIds.push(Number(insertSeat.run(raceVenueId, raceCatId, row, num).lastInsertRowid));
    }
  }

  const insertEvent = db.prepare(
    'INSERT INTO events (organiser_id, title, kind, description, language, runtime_min) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const raceEventId = Number(
    insertEvent.run(organiserId, 'Contention Grand Prix', 'concert', 'Load testing contention', 'English', 120)
      .lastInsertRowid
  );

  const insertShow = db.prepare('INSERT INTO shows (event_id, venue_id, starts_at) VALUES (?, ?, ?)');
  const raceStartsAt = new Date(Date.now() + 86400000).toISOString();
  const raceShowId = Number(insertShow.run(raceEventId, raceVenueId, raceStartsAt).lastInsertRowid);

  const insertShowPrice = db.prepare('INSERT INTO show_prices (show_id, category_id, price) VALUES (?, ?, ?)');
  insertShowPrice.run(raceShowId, raceCatId, 500);

  const insertShowSeat = db.prepare(
    'INSERT INTO show_seats (show_id, seat_id, category_id, price, status) VALUES (?, ?, ?, ?, ?)'
  );
  const raceSeats = [];
  for (const seatId of raceSeatIds) {
    const showSeatId = Number(insertShowSeat.run(raceShowId, seatId, raceCatId, 500, 'available').lastInsertRowid);
    raceSeats.push({ id: showSeatId, seatId });
  }

  // --- Show 2: 50-Seat Mixed Show ---
  const mixedVenueId = Number(insertVenue.run('Mixed Arena', 'Bengaluru', adminId).lastInsertRowid);
  const mixedCatId = Number(insertCategory.run(mixedVenueId, 'General').lastInsertRowid);

  const mixedSeatIds = [];
  for (const row of ['A', 'B', 'C', 'D', 'E']) {
    for (let num = 1; num <= 10; num += 1) {
      mixedSeatIds.push(Number(insertSeat.run(mixedVenueId, mixedCatId, row, num).lastInsertRowid));
    }
  }

  const mixedEventId = Number(
    insertEvent.run(organiserId, 'Mixed Live Fest', 'movie', 'Mixed scenario testing', 'English', 90).lastInsertRowid
  );
  const mixedStartsAt = new Date(Date.now() + 172800000).toISOString();
  const mixedShowId = Number(insertShow.run(mixedEventId, mixedVenueId, mixedStartsAt).lastInsertRowid);
  insertShowPrice.run(mixedShowId, mixedCatId, 300);

  const mixedSeats = [];
  for (const seatId of mixedSeatIds) {
    const showSeatId = Number(insertShowSeat.run(mixedShowId, seatId, mixedCatId, 300, 'available').lastInsertRowid);
    mixedSeats.push({ id: showSeatId, seatId });
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

  console.log('Seeded database for load test:');
  console.log(`  Users seeded: 250 customers (tokens saved to loadtest/data.json)`);
  console.log(`  Show 1 (Race): showId=${raceShowId}, total seats=${raceSeats.length}`);
  console.log(`  Show 2 (Mixed): showId=${mixedShowId}, total seats=${mixedSeats.length}`);
};

seed();
db.close();
