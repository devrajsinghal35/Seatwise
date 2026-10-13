/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      email      TEXT        NOT NULL UNIQUE,
      name       TEXT        NOT NULL,
      password   TEXT        NOT NULL,
      role       TEXT        NOT NULL CHECK (role IN ('customer', 'organiser', 'admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS venues (
      id         SERIAL PRIMARY KEY,
      name       TEXT        NOT NULL,
      city       TEXT        NOT NULL,
      created_by INTEGER     NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS categories (
      id       SERIAL PRIMARY KEY,
      venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      name     TEXT    NOT NULL,
      UNIQUE (venue_id, name)
    );

    CREATE TABLE IF NOT EXISTS seats (
      id          SERIAL PRIMARY KEY,
      venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      row_label   TEXT    NOT NULL,
      seat_number INTEGER NOT NULL,
      UNIQUE (venue_id, row_label, seat_number)
    );

    CREATE TABLE IF NOT EXISTS events (
      id           SERIAL PRIMARY KEY,
      organiser_id INTEGER     NOT NULL REFERENCES users(id),
      title        TEXT        NOT NULL,
      kind         TEXT        NOT NULL CHECK (kind IN ('movie', 'concert')),
      description  TEXT        NOT NULL DEFAULT '',
      language     TEXT        NOT NULL DEFAULT '',
      runtime_min  INTEGER,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shows (
      id       SERIAL PRIMARY KEY,
      event_id INTEGER     NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      venue_id INTEGER     NOT NULL REFERENCES venues(id),
      starts_at TIMESTAMPTZ NOT NULL,
      UNIQUE (venue_id, starts_at)
    );

    CREATE TABLE IF NOT EXISTS show_prices (
      show_id     INTEGER        NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      category_id INTEGER        NOT NULL REFERENCES categories(id),
      price       NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
      PRIMARY KEY (show_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS show_seats (
      id              SERIAL PRIMARY KEY,
      show_id         INTEGER        NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      seat_id         INTEGER        NOT NULL REFERENCES seats(id),
      category_id     INTEGER        NOT NULL REFERENCES categories(id),
      price           NUMERIC(10, 2) NOT NULL,
      status          TEXT           NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'held', 'booked')),
      held_by         INTEGER REFERENCES users(id),
      hold_expires_at BIGINT,
      hold_kind       TEXT CHECK (hold_kind IN ('checkout', 'offer')),

      UNIQUE (show_id, seat_id),

      CHECK ((status = 'held') = (hold_expires_at IS NOT NULL)),
      CHECK ((status = 'held') = (held_by IS NOT NULL)),
      CHECK ((status = 'held') = (hold_kind IS NOT NULL))
    );

    CREATE INDEX IF NOT EXISTS idx_show_seats_show   ON show_seats (show_id, status);
    CREATE INDEX IF NOT EXISTS idx_show_seats_expiry ON show_seats (status, hold_expires_at);

    CREATE TABLE IF NOT EXISTS bookings (
      id              SERIAL PRIMARY KEY,
      reference       TEXT           NOT NULL UNIQUE,
      show_id         INTEGER        NOT NULL REFERENCES shows(id),
      user_id         INTEGER        NOT NULL REFERENCES users(id),
      amount          NUMERIC(10, 2) NOT NULL,
      status          TEXT           NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('confirmed', 'cancelled')),
      source          TEXT           NOT NULL DEFAULT 'checkout'
                        CHECK (source IN ('checkout', 'waitlist_offer')),
      idempotency_key TEXT           UNIQUE,
      guest_name      TEXT,
      guest_mobile    TEXT,
      guest_email     TEXT,
      created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
      cancelled_at    TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id, id DESC);

    CREATE TABLE IF NOT EXISTS booking_seats (
      booking_id   INTEGER        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      show_seat_id INTEGER        NOT NULL REFERENCES show_seats(id),
      price        NUMERIC(10, 2) NOT NULL,
      released_at  TIMESTAMPTZ,
      PRIMARY KEY (booking_id, show_seat_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_seat_one_live_booking
      ON booking_seats (show_seat_id) WHERE released_at IS NULL;

    CREATE TABLE IF NOT EXISTS waitlist (
      id               SERIAL PRIMARY KEY,
      show_id          INTEGER     NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      category_id      INTEGER     NOT NULL REFERENCES categories(id),
      user_id          INTEGER     NOT NULL REFERENCES users(id),
      status           TEXT        NOT NULL DEFAULT 'waiting'
                         CHECK (status IN ('waiting', 'offered', 'converted', 'expired', 'cancelled')),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      offer_seat_id    INTEGER REFERENCES show_seats(id),
      offer_token      TEXT        UNIQUE,
      offer_expires_at BIGINT,

      CHECK ((status = 'offered') = (offer_token IS NOT NULL))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_live_waitlist_entry
      ON waitlist (show_id, category_id, user_id) WHERE status IN ('waiting', 'offered');

    CREATE INDEX IF NOT EXISTS idx_waitlist_queue ON waitlist (show_id, category_id, status, id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS waitlist CASCADE;
    DROP TABLE IF EXISTS booking_seats CASCADE;
    DROP TABLE IF EXISTS bookings CASCADE;
    DROP TABLE IF EXISTS show_seats CASCADE;
    DROP TABLE IF EXISTS show_prices CASCADE;
    DROP TABLE IF EXISTS shows CASCADE;
    DROP TABLE IF EXISTS events CASCADE;
    DROP TABLE IF EXISTS seats CASCADE;
    DROP TABLE IF EXISTS categories CASCADE;
    DROP TABLE IF EXISTS venues CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
  `);
};
