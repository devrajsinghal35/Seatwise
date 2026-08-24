// Loads a small demo catalogue. Run with --reset to rebuild from scratch.
import { randomInt } from 'node:crypto';
import { db, writeTxn } from './index.js';
import { hashPassword } from '../lib/passwords.js';
import { createShow, createVenue } from '../services/catalogue.js';

const DEMO_PASSWORD = 'Password123';
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const reference = () => `SW-${Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

const reset = process.argv.includes('--reset');

const wipe = writeTxn(() => {
  for (const table of ['booking_seats', 'bookings', 'waitlist', 'show_seats', 'show_prices', 'shows', 'events', 'seats', 'categories', 'venues', 'users']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
});

if (reset) wipe();

if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.log('Database already has data. Re-run with --reset to rebuild it.');
  process.exit(0);
}

const addUser = db.prepare('INSERT INTO users (email, name, password, role) VALUES (?, ?, ?, ?)');
const user = (email, name, role) => Number(addUser.run(email, name, hashPassword(DEMO_PASSWORD), role).lastInsertRowid);

const admin = user('admin@seatwise.test', 'Asha Menon', 'admin');
const organiser = user('organiser@seatwise.test', 'Vikram Rao', 'organiser');
const customer = user('priya@example.com', 'Priya Nair', 'customer');
const secondCustomer = user('rahul@example.com', 'Rahul Sen', 'customer');

const aurora = createVenue({
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
}, admin);

const riverside = createVenue({
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
}, admin);

// Small enough to sell out, which is what makes the waitlist easy to try.
const studio = createVenue({
  name: 'Studio Screen 3',
  city: 'Mumbai',
  categories: ['Recliner'],
  rows: [{ label: 'A', seats: 4, category: 'Recliner' }],
}, admin);

const addEvent = db.prepare(
  'INSERT INTO events (organiser_id, title, kind, description, language, runtime_min) VALUES (?, ?, ?, ?, ?, ?)'
);
const event = (title, kind, description, language, runtime) =>
  Number(addEvent.run(organiser, title, kind, description, language, runtime).lastInsertRowid);

const longAfternoon = event(
  'The Long Afternoon', 'movie',
  'A retired ferry captain spends one summer teaching his estranged daughter to navigate the delta.',
  'English', 118
);
const saltAndStatic = event(
  'Salt and Static', 'movie',
  'Two radio engineers on a remote island start picking up a broadcast that has not been transmitted yet.',
  'Hindi', 134
);
const monsoonSessions = event(
  'Monsoon Sessions Live', 'concert',
  'An evening of contemporary Carnatic fusion, recorded live with a twelve-piece ensemble.',
  'Multilingual', 150
);
const closeQuarters = event(
  'Close Quarters', 'movie',
  'A single-location thriller shot in real time aboard a stranded cable car.',
  'English', 96
);

const at = (daysAhead, hour) => {
  const when = new Date();
  when.setUTCDate(when.getUTCDate() + daysAhead);
  when.setUTCHours(hour, 30, 0, 0);
  return when.toISOString();
};

const shows = [
  createShow({ eventId: longAfternoon, venueId: aurora.id, startsAt: at(1, 13), prices: { Premium: 420, Standard: 260 } }, organiser),
  createShow({ eventId: longAfternoon, venueId: aurora.id, startsAt: at(1, 18), prices: { Premium: 480, Standard: 300 } }, organiser),
  createShow({ eventId: saltAndStatic, venueId: aurora.id, startsAt: at(2, 16), prices: { Premium: 450, Standard: 280 } }, organiser),
  createShow({ eventId: monsoonSessions, venueId: riverside.id, startsAt: at(4, 14), prices: { VIP: 2500, Gold: 1400, General: 750 } }, organiser),
  createShow({ eventId: monsoonSessions, venueId: riverside.id, startsAt: at(9, 14), prices: { VIP: 2800, Gold: 1600, General: 850 } }, organiser),
];

const soldOutShow = createShow(
  { eventId: closeQuarters, venueId: studio.id, startsAt: at(3, 15), prices: { Recliner: 650 } },
  organiser
);

// Sell every seat in the small show so the waitlist and the offer-on-cancellation
// flow can be exercised the moment the app starts.
const sellOut = writeTxn((showId, buyerId) => {
  const seats = db.prepare('SELECT id, price FROM show_seats WHERE show_id = ? ORDER BY id').all(showId);

  for (const seat of seats) {
    const bookingId = Number(
      db.prepare('INSERT INTO bookings (reference, show_id, user_id, amount, source) VALUES (?, ?, ?, ?, ?)')
        .run(reference(), showId, buyerId, seat.price, 'checkout').lastInsertRowid
    );
    db.prepare('INSERT INTO booking_seats (booking_id, show_seat_id, price) VALUES (?, ?, ?)').run(bookingId, seat.id, seat.price);
    db.prepare("UPDATE show_seats SET status = 'booked' WHERE id = ?").run(seat.id);
  }
  return seats.length;
});

const soldSeats = sellOut(soldOutShow.id, secondCustomer);

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
