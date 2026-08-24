-- SeatWise schema. Applied on every boot; all statements are idempotent.

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  email      TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  password   TEXT    NOT NULL,               -- scrypt, stored as "salt:derivedKey"
  role       TEXT    NOT NULL CHECK (role IN ('customer', 'organiser', 'admin')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venues (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  city       TEXT    NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Seat categories belong to a venue: the same venue always prices by the same tiers.
CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  UNIQUE (venue_id, name)
);

CREATE TABLE IF NOT EXISTS seats (
  id          INTEGER PRIMARY KEY,
  venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  row_label   TEXT    NOT NULL,
  seat_number INTEGER NOT NULL,
  UNIQUE (venue_id, row_label, seat_number)
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY,
  organiser_id INTEGER NOT NULL REFERENCES users(id),
  title        TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('movie', 'concert')),
  description  TEXT    NOT NULL DEFAULT '',
  language     TEXT    NOT NULL DEFAULT '',
  runtime_min  INTEGER,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shows (
  id        INTEGER PRIMARY KEY,
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  venue_id  INTEGER NOT NULL REFERENCES venues(id),
  starts_at TEXT    NOT NULL,                -- ISO-8601, UTC
  UNIQUE (venue_id, starts_at)               -- a venue cannot run two shows at once
);

CREATE TABLE IF NOT EXISTS show_prices (
  show_id     INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  price       REAL    NOT NULL CHECK (price >= 0),
  PRIMARY KEY (show_id, category_id)
);

-- One row per seat per show: this is the table every booking races on.
CREATE TABLE IF NOT EXISTS show_seats (
  id              INTEGER PRIMARY KEY,
  show_id         INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  seat_id         INTEGER NOT NULL REFERENCES seats(id),
  category_id     INTEGER NOT NULL REFERENCES categories(id),
  price           REAL    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'held', 'booked')),
  held_by         INTEGER REFERENCES users(id),
  hold_expires_at INTEGER,                   -- epoch ms
  hold_kind       TEXT    CHECK (hold_kind IN ('checkout', 'offer')),

  UNIQUE (show_id, seat_id),

  -- A hold always has an expiry, and nothing else ever does. Without this a stale
  -- timestamp could survive on a booked seat and let the sweeper free a paid seat.
  CHECK ((status = 'held') = (hold_expires_at IS NOT NULL)),
  CHECK ((status = 'held') = (held_by IS NOT NULL)),
  CHECK ((status = 'held') = (hold_kind IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_show_seats_show   ON show_seats (show_id, status);
CREATE INDEX IF NOT EXISTS idx_show_seats_expiry ON show_seats (status, hold_expires_at);

CREATE TABLE IF NOT EXISTS bookings (
  id              INTEGER PRIMARY KEY,
  reference       TEXT    NOT NULL UNIQUE,   -- the value the QR code carries
  show_id         INTEGER NOT NULL REFERENCES shows(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  amount          REAL    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'confirmed'
                    CHECK (status IN ('confirmed', 'cancelled')),
  source          TEXT    NOT NULL DEFAULT 'checkout'
                    CHECK (source IN ('checkout', 'waitlist_offer')),
  idempotency_key TEXT    UNIQUE,            -- lets a retried checkout return the same booking
  guest_name      TEXT,
  guest_mobile    TEXT,
  guest_email     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  cancelled_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id, id DESC);

-- One booking can cover several seats, so the seats hang off it as line items.
CREATE TABLE IF NOT EXISTS booking_seats (
  booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  show_seat_id INTEGER NOT NULL REFERENCES show_seats(id),
  price        REAL    NOT NULL,
  released_at  TEXT,                          -- filled in when the booking is cancelled
  PRIMARY KEY (booking_id, show_seat_id)
);

-- The double-booking backstop. A seat can sit in only one live booking at a
-- time; released rows stay behind so cancelled tickets remain in history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_seat_one_live_booking
  ON booking_seats (show_seat_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS waitlist (
  id               INTEGER PRIMARY KEY,
  show_id          INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  category_id      INTEGER NOT NULL REFERENCES categories(id),
  user_id          INTEGER NOT NULL REFERENCES users(id),
  status           TEXT    NOT NULL DEFAULT 'waiting'
                     CHECK (status IN ('waiting', 'offered', 'converted', 'expired', 'cancelled')),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  offer_seat_id    INTEGER REFERENCES show_seats(id),
  offer_token      TEXT    UNIQUE,           -- the secret in the emailed claim link
  offer_expires_at INTEGER,

  CHECK ((status = 'offered') = (offer_token IS NOT NULL))
);

-- Stops a customer queuing twice for the same category while still live.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_live_waitlist_entry
  ON waitlist (show_id, category_id, user_id) WHERE status IN ('waiting', 'offered');

-- Serves the "next in line" lookup: oldest waiting row wins.
CREATE INDEX IF NOT EXISTS idx_waitlist_queue ON waitlist (show_id, category_id, status, id);
