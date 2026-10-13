// Loads a small demo catalogue. Run with --reset to rebuild from scratch.
import { randomInt } from 'node:crypto';
import { db, getPool, writeTxn } from './index.js';
import { runMigrations } from './migrate.js';
import { hashPassword } from '../lib/passwords.js';
import { createShow, createVenue } from '../services/catalogue.js';

const DEMO_PASSWORD = 'Password123';
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const reference = () => `SW-${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

const reset = process.argv.includes('--reset');

const at = (daysAhead, hour) => {
  const when = new Date();
  when.setUTCDate(when.getUTCDate() + daysAhead);
  when.setUTCHours(hour, 30, 0, 0);
  return when.toISOString();
};

const sellOut = writeTxn(async (client, showId, buyerId) => {
  const seatsRes = await client.query('SELECT id, price FROM show_seats WHERE show_id = $1 ORDER BY id', [showId]);
  const seats = seatsRes.rows;

  for (const seat of seats) {
    const bookingRes = await client.query(
      'INSERT INTO bookings (reference, show_id, user_id, amount, source) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [reference(), showId, buyerId, seat.price, 'checkout']
    );
    const bookingId = bookingRes.rows[0].id;
    await client.query('INSERT INTO booking_seats (booking_id, show_seat_id, price) VALUES ($1, $2, $3)', [
      bookingId,
      seat.id,
      seat.price,
    ]);
    await client.query("UPDATE show_seats SET status = 'booked' WHERE id = $1", [seat.id]);
  }
  return seats.length;
});

async function main() {
  await runMigrations();

  if (reset) {
    await db.query(`
      TRUNCATE TABLE booking_seats, bookings, waitlist, show_seats, show_prices,
                     shows, events, seats, categories, venues, users RESTART IDENTITY CASCADE
    `);
  }

  const countRes = await db.query('SELECT COUNT(*) AS n FROM users');
  if (Number(countRes.rows[0]?.n ?? 0) > 0) {
    console.log('Database already has data. Re-run with --reset to rebuild it.');
    await getPool().end();
    return;
  }

  const user = async (email, name, role) => {
    const res = await db.query(
      'INSERT INTO users (email, name, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, name, hashPassword(DEMO_PASSWORD), role]
    );
    return res.rows[0].id;
  };

  const admin = await user('admin@seatwise.test', 'Asha Menon', 'admin');
  const organiser = await user('organiser@seatwise.test', 'Vikram Rao', 'organiser');
  const customer = await user('priya@example.com', 'Priya Nair', 'customer');
  const secondCustomer = await user('rahul@example.com', 'Rahul Sen', 'customer');

  const aurora = await createVenue(
    {
      name: 'Aurora Cinemas',
      city: 'Mumbai',
      categories: ['Premium', 'Standard'],
      rows: [
        { label: 'A', seats: 12, category: 'Premium' },
        { label: 'B', seats: 12, category: 'Premium' },
        { label: 'C', seats: 14, category: 'Standard' },
        { label: 'D', seats: 14, category: 'Standard' },
        { label: 'E', seats: 14, category: 'Standard' },
      ],
    },
    admin
  );

  const riverside = await createVenue(
    {
      name: 'Riverside Arena',
      city: 'Bengaluru',
      categories: ['VIP', 'Gold', 'General'],
      rows: [
        { label: 'A', seats: 10, category: 'VIP' },
        { label: 'B', seats: 16, category: 'Gold' },
        { label: 'C', seats: 16, category: 'Gold' },
        { label: 'D', seats: 20, category: 'General' },
        { label: 'E', seats: 20, category: 'General' },
      ],
    },
    admin
  );

  // Small enough to sell out, which is what makes the waitlist easy to try.
  const studio = await createVenue(
    {
      name: 'Studio Screen 3',
      city: 'Mumbai',
      categories: ['Recliner'],
      rows: [{ label: 'A', seats: 4, category: 'Recliner' }],
    },
    admin
  );

  const event = async (title, kind, description, language, runtime) => {
    const res = await db.query(
      'INSERT INTO events (organiser_id, title, kind, description, language, runtime_min) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [organiser, title, kind, description, language, runtime]
    );
    return res.rows[0].id;
  };

  const longAfternoon = await event(
    'The Long Afternoon',
    'movie',
    'A retired ferry captain spends one summer teaching his estranged daughter to navigate the delta.',
    'English',
    118
  );
  const saltAndStatic = await event(
    'Salt and Static',
    'movie',
    'Two radio engineers on a remote island start picking up a broadcast that has not been transmitted yet.',
    'Hindi',
    134
  );
  const monsoonSessions = await event(
    'Monsoon Sessions Live',
    'concert',
    'An evening of contemporary Carnatic fusion, recorded live with a twelve-piece ensemble.',
    'Multilingual',
    150
  );
  const closeQuarters = await event(
    'Close Quarters',
    'movie',
    'A single-location thriller shot in real time aboard a stranded cable car.',
    'English',
    96
  );

  const shows = [
    await createShow(
      { eventId: longAfternoon, venueId: aurora.id, startsAt: at(1, 13), prices: { Premium: 420, Standard: 260 } },
      organiser
    ),
    await createShow(
      { eventId: longAfternoon, venueId: aurora.id, startsAt: at(1, 18), prices: { Premium: 480, Standard: 300 } },
      organiser
    ),
    await createShow(
      { eventId: saltAndStatic, venueId: aurora.id, startsAt: at(2, 16), prices: { Premium: 450, Standard: 280 } },
      organiser
    ),
    await createShow(
      { eventId: monsoonSessions, venueId: riverside.id, startsAt: at(4, 14), prices: { VIP: 2500, Gold: 1400, General: 750 } },
      organiser
    ),
    await createShow(
      { eventId: monsoonSessions, venueId: riverside.id, startsAt: at(9, 14), prices: { VIP: 2800, Gold: 1600, General: 850 } },
      organiser
    ),
  ];

  const soldOutShow = await createShow(
    { eventId: closeQuarters, venueId: studio.id, startsAt: at(3, 15), prices: { Recliner: 650 } },
    organiser
  );

  const soldSeats = await sellOut(soldOutShow.id, secondCustomer);

  console.log('Seeded SeatWise demo data.');
  console.log('');
  console.log(`  venues            3 (${soldSeats} seats sold out in Studio Screen 3)`);
  console.log(`  events            4`);
  console.log(`  shows             ${shows.length + 1}`);
  console.log('');
  console.log('Sign in with any of these (password for all: %s)', DEMO_PASSWORD);
  console.log('  admin@seatwise.test      admin     - creates venues and seat layouts');
  console.log('  organiser@seatwise.test  organiser - creates events, shows and sees revenue');
  console.log('  priya@example.com        customer  - books seats, joins waitlists');
  console.log('  rahul@example.com        customer  - already holds every seat for "Close Quarters"');
  console.log('');
  console.log('To try the waitlist: sign in as priya, open "Close Quarters" (sold out) and');
  console.log('join the Recliner waitlist. Then sign in as rahul and cancel that booking.');

  await getPool().end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
