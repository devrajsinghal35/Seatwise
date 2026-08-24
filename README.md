# SeatWise

A ticket booking platform for movies and concerts. Customers pick seats from a
visual map, seats are held for a limited time while they check out, abandoned
holds are released automatically, and when a show sells out customers can join a
per-category waitlist that is served in order when someone cancels.

Two processes: an Express API with a SQLite database, and a React frontend.
There is no message broker, cache server or background worker to install.

## Requirements

- Node.js 20 or newer (`node --version`)
- npm

Nothing else. SQLite is embedded, so there is no database server to run.

## Setup

Install and start the API:

```
cd server
npm install
npm run seed
npm start
```

The API listens on <http://localhost:4000>.

In a second terminal, start the frontend:

```
cd web
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server proxies `/api` to the API, so both
run on one origin and no CORS configuration is involved.

`npm run seed` loads three venues, four events, six showings and the demo
accounts below. Re-run it with `npm run seed -- --reset` to start over.

## Demo accounts

The password for all of them is `Password123`.

| Email | Role | What it can do |
| --- | --- | --- |
| `admin@seatwise.test` | admin | Create venues and their seat layouts |
| `organiser@seatwise.test` | organiser | Create events and showings, see revenue |
| `priya@example.com` | customer | Book seats, join waitlists |
| `rahul@example.com` | customer | Holds every seat for the sold-out showing |

New sign-ups can choose customer or organiser. Admin is seeded only, so nobody
can grant themselves venue control through the registration form.

## Trying the main flows

**Seat hold and auto-release.** Sign in as `priya`, open any showing, select
seats and press *Hold*. A countdown appears. Open the same showing in a private
window and the seats already show as held. Walk away and they return to sale
when the hold expires. To see it quickly, restart the API with a short TTL:

```
HOLD_TTL_SECONDS=20 npm start
```

**Concurrency.** With the showing open in two browsers signed in as different
customers, click the same seat in both. One gets the hold; the other is told the
seat has just been taken. The seat map in the losing browser updates on its own.

**Waitlist and the time-limited offer.** "Close Quarters" is seeded sold out.
Sign in as `priya`, open it, and join the Recliner waitlist. Then sign in as
`rahul` and cancel his booking for that showing. The freed seat is held for
priya and she is emailed a claim link; it also appears under *My bookings*. If
she does not claim it within `OFFER_TTL_SECONDS` the seat passes to the next
person in the queue, or returns to sale if the queue is empty.

**Email.** With no SMTP credentials configured, every message is written to
`server/outbox` as a `.eml` file you can open in any mail client, and the path
is logged. Set the `SMTP_*` variables to send for real.

**Revenue.** Sign in as `organiser@seatwise.test` for bookings, revenue,
occupancy and waitlist depth per event, broken down by seat category and by
showing.

## Configuration

Copy `server/.env.example` to `server/.env` to change any of it. Every setting
has a working default, so the app runs with no `.env` file at all.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `JWT_SECRET` | dev value | Signing key for access tokens. Set this before deploying. |
| `TOKEN_TTL` | `12h` | How long a sign-in lasts |
| `DATABASE_FILE` | `./data/seatwise.db` | SQLite file; the directory is created on first run |
| `HOLD_TTL_SECONDS` | `600` | How long a checkout hold survives |
| `OFFER_TTL_SECONDS` | `300` | How long a waitlisted customer has to claim a seat |
| `SWEEP_INTERVAL_SECONDS` | `5` | How often expiries are swept |
| `PUBLIC_URL` | `http://localhost:5173` | Base URL for the claim link in offer emails |
| `MAIL_FROM` | `SeatWise <no-reply@seatwise.local>` | Sender address |
| `MAIL_OUTBOX` | `./outbox` | Where `.eml` files land when SMTP is unset |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | empty | Set all four to send real email |

## Tests

```
cd server
npm test
```

35 tests over three files, using Node's built-in test runner. Each file boots
the API on a random port against a throwaway database, so they leave nothing
behind. They cover seat holds, the all-or-nothing multi-seat selection, two
customers racing for one seat, checkout and retries, hold expiry, role
permissions, revenue reporting, and the full waitlist chain from cancellation
through claim, expiry and hand-off to the next person.

## API

All request and response bodies are JSON. Authenticated endpoints expect
`Authorization: Bearer <token>` from a sign-in.

### Authentication

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | anyone | Create a customer or organiser account |
| POST | `/api/auth/login` | anyone | Exchange email and password for a token |
| GET | `/api/auth/me` | signed in | The current account |

### Catalogue

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/events` | anyone | List events. Filters: `q`, `kind`, `city`, `date` |
| GET | `/api/events/:id` | anyone | One event with its showings |
| POST | `/api/events` | organiser | Create an event |
| GET | `/api/cities` | anyone | Cities that have a venue |
| GET | `/api/shows/:id` | anyone | One showing |
| POST | `/api/shows` | organiser | Schedule a showing and build its seat map |
| GET | `/api/venues` | anyone | List venues with their seat categories |
| GET | `/api/venues/:id` | anyone | One venue with its row layout |
| POST | `/api/venues` | admin | Create a venue, its categories and its seats |

### Seats and holds

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/shows/:id/seats` | anyone | Seat map, per-category availability, and the caller's own hold |
| GET | `/api/shows/:id/stream` | anyone | Server-sent events carrying live seat changes |
| POST | `/api/shows/:id/hold` | customer | Hold seats. Body `{ "seatIds": [1, 2] }` |
| DELETE | `/api/shows/:id/hold` | customer | Give up your holds for this showing |

### Bookings

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/api/bookings` | customer | Convert your live hold into a booking. Body `{ "showId": 1 }`. Send an `Idempotency-Key` header so a retry cannot double-book. |
| GET | `/api/bookings` | signed in | Your booking history |
| GET | `/api/bookings/:id` | owner | One booking |
| GET | `/api/bookings/:id/qr` | owner | The ticket QR as a PNG data URL |
| POST | `/api/bookings/:id/cancel` | owner | Cancel and release the seats to the waitlist |

### Waitlist

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/api/shows/:id/waitlist` | customer | Join a sold-out category. Body `{ "categoryId": 3 }` |
| GET | `/api/waitlist` | signed in | Your live queue entries and any open offer |
| DELETE | `/api/waitlist/:id` | owner | Leave the queue, passing on any open offer |
| GET | `/api/offers/:token` | the offer's owner | Read an offer opened from the emailed link |
| POST | `/api/offers/:token/claim` | the offer's owner | Turn the offer into a booking |

### Organiser reporting

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/organiser/events` | organiser | Your events with revenue to date |
| GET | `/api/organiser/events/:id/summary` | organiser | Revenue, occupancy and waitlist depth, by category and showing |

Errors carry a stable machine-readable code alongside the message:

```json
{ "error": "seat_held", "message": "One of those seats has just been taken by someone else. Pick another." }
```

`400 invalid_request`, `401 unauthenticated`, `401 invalid_credentials`,
`403 forbidden`, `404 not_found`, `404 offer_not_found`, `409 seat_held`,
`409 seat_booked`, `409 hold_expired`, `409 seats_available`,
`409 offer_expired`, `409 already_cancelled`, `409 show_started`.

## Database schema

SQLite, created from `server/src/db/schema.sql` on first boot.

| Table | Holds | Notable constraints |
| --- | --- | --- |
| `users` | Accounts and scrypt password hashes | `email` unique; `role` in customer, organiser, admin |
| `venues` | Physical venues | |
| `categories` | Seat tiers within a venue, e.g. Premium | unique per `(venue, name)` |
| `seats` | Every physical seat and its tier | unique per `(venue, row, number)` |
| `events` | A movie or concert owned by an organiser | `kind` in movie, concert |
| `shows` | One screening of an event at a venue | unique per `(venue, starts_at)` |
| `show_prices` | Price per category for a showing | |
| `show_seats` | One row per seat per showing: the contended table | unique per `(show, seat)`; a hold must have an expiry, a holder and a kind, and nothing else may |
| `bookings` | A confirmed or cancelled booking | `reference` unique; `idempotency_key` unique |
| `booking_seats` | The seats on a booking | partial unique index on `show_seat_id where released_at is null` |
| `waitlist` | Queue entries and open offers | `offer_token` unique; one live entry per `(show, category, user)`; an offered row must have a token |

Two invariants are enforced by the database rather than by application code, so
they hold no matter which code path writes:

- `booking_seats` has a **partial unique index** on `show_seat_id` limited to
  rows where `released_at is null`. A seat can therefore sit in only one live
  booking at a time, while cancelled rows stay behind for history. This is the
  backstop against double-booking.
- `show_seats` **check constraints** tie `hold_expires_at`, `held_by` and
  `hold_kind` to `status = 'held'`. A stale expiry cannot survive on a booked
  seat, which is what would otherwise let an expiry sweep free a paid seat.

## How seat holds work

Selecting seats does not reserve them; pressing *Hold* does. A hold moves
`show_seats.status` to `held` and stamps `hold_expires_at` at
`now + HOLD_TTL_SECONDS`. Held seats appear as unavailable to everyone else, and
only the holder is told when the hold expires.

Expiry is evaluated in three places, so a lapsed hold is never treated as
current:

1. **On read.** The seat map reports a hold whose expiry has passed as
   available, even before any cleanup has run.
2. **On write.** The `UPDATE` that grants a hold matches a seat that is either
   available *or* held with a lapsed expiry, so the next customer takes it
   directly. Checkout re-checks `hold_expires_at > now` as it writes, so a hold
   that lapses mid-request cannot produce a ticket.
3. **On a timer.** A sweep every `SWEEP_INTERVAL_SECONDS` rewrites lapsed rows
   back to available and pushes the change to watching browsers.

Correctness comes from the first two. The timer exists to notify browsers and
keep the stored rows tidy, so a missed tick cannot cause a wrong booking.

Concurrency is handled by writing conditionally rather than by checking first.
Every hold and every checkout runs inside a `BEGIN IMMEDIATE` transaction and
takes the seat with a single `UPDATE ... WHERE id = ? AND status = 'available'`.
The number of rows changed is the answer: one means the seat is yours, zero
means someone else got there first, and the caller receives `409`. A stale read
cannot win a seat, because the condition is re-evaluated at write time. Holding
several seats is all-or-nothing: one conflict rolls the whole selection back
rather than leaving a partial hold.

## How the waitlist works

Once every seat in a category is taken, customers can queue for it. Joining is
refused while any seat is still gettable, and a lapsed hold counts as gettable,
so a stale hold cannot fake a sold-out house. One live entry is allowed per
customer per category.

When a seat comes free, it is offered to the longest-waiting customer for that
category instead of returning to open sale. The seat is held for them with
`hold_kind = 'offer'`, the queue entry is marked `offered` with an
`offer_expires_at` of `now + OFFER_TTL_SECONDS`, and they are emailed a link
containing a single-use random token. Opening it also requires being signed in
as the customer the offer was made to, so a forwarded link is useless.

Claiming converts the offer into a booking with its own QR ticket. If the window
closes first, the sweep marks the entry `expired` and passes the same seat to the
next person, repeating until someone claims it or the queue empties, at which
point the seat returns to general sale. Leaving the queue while holding an offer
hands the seat straight on rather than dropping it.

Both freed-seat paths go through the same code, so an abandoned checkout hold is
offered to the queue exactly like a cancellation. Without that, a queue could be
bypassed by whoever refreshed the seat map fastest.

## Deployment

The API can serve the built frontend, so this deploys as one service:

```
cd web && npm install && npm run build
cd ../server && npm install && npm run seed && npm start
```

`server/src/app.js` serves `web/dist` when it exists and falls back to
`index.html` so client-side routes work on refresh. Set `JWT_SECRET` and
`PUBLIC_URL` (to the deployed origin, so emailed claim links point at the right
place), and `DATABASE_FILE` to a path on a persistent disk. On a host with
ephemeral storage the SQLite file resets when the instance restarts, which is
fine for a demo because `npm run seed` reloads the catalogue.

## Layout

```
server/
  src/
    app.js            Express app and route mounting
    index.js          Starts the server and the expiry sweep
    config.js         Environment settings with defaults
    db/
      schema.sql      Tables, constraints and indexes
      index.js        Connection, pragmas, BEGIN IMMEDIATE helper
      seed.js         Demo catalogue
    lib/              Auth, password hashing, HTTP error helpers
    routes/           Request handling and validation
    services/         Seats, bookings, waitlist, reports, mail, QR, sweeper
  test/               Integration tests over the real HTTP API
web/
  src/
    api.ts            Fetch wrapper
    auth.tsx          Session context
    hooks.ts          Countdown and seat-stream subscription
    components/       Seat map and notices
    pages/            Browse, showing, checkout, tickets, offer, dashboards
```
