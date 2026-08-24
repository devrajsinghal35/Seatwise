import { db, writeTxn } from '../db/index.js';
import { badRequest, notFound } from '../lib/http.js';

// --- Venues ---------------------------------------------------------------

/**
 * Creates a venue together with its seat categories and full seat layout.
 *
 * The layout arrives as a list of rows, each naming how many seats it holds and
 * which category they belong to, which is what a grid builder produces.
 */
export const createVenue = writeTxn(({ name, city, categories, rows }, adminId) => {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw badRequest('Give the venue at least one seat category.');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw badRequest('Give the venue at least one row of seats.');
  }

  const venueId = Number(
    db.prepare('INSERT INTO venues (name, city, created_by) VALUES (?, ?, ?)').run(name, city, adminId).lastInsertRowid
  );

  const categoryIds = new Map();
  const addCategory = db.prepare('INSERT INTO categories (venue_id, name) VALUES (?, ?)');
  for (const raw of categories) {
    const categoryName = String(typeof raw === 'string' ? raw : raw?.name || '').trim();
    if (!categoryName) throw badRequest('Every seat category needs a name.');
    if (categoryIds.has(categoryName)) throw badRequest(`Duplicate seat category "${categoryName}".`);
    categoryIds.set(categoryName, Number(addCategory.run(venueId, categoryName).lastInsertRowid));
  }

  const addSeat = db.prepare('INSERT INTO seats (venue_id, category_id, row_label, seat_number) VALUES (?, ?, ?, ?)');
  let seatCount = 0;

  for (const row of rows) {
    const label = String(row?.label || '').trim().toUpperCase();
    const count = Number(row?.seats);
    const categoryId = categoryIds.get(String(row?.category || '').trim());

    if (!label) throw badRequest('Every row needs a label.');
    if (!Number.isInteger(count) || count < 1 || count > 40) {
      throw badRequest(`Row ${label} must hold between 1 and 40 seats.`);
    }
    if (!categoryId) throw badRequest(`Row ${label} refers to a category this venue does not have.`);

    for (let seatNumber = 1; seatNumber <= count; seatNumber += 1) {
      addSeat.run(venueId, categoryId, label, seatNumber);
      seatCount += 1;
    }
  }

  return { id: venueId, name, city, seatCount, categories: [...categoryIds.keys()] };
});

export const listVenues = () =>
  db
    .prepare(`SELECT v.id, v.name, v.city,
                     (SELECT COUNT(*) FROM seats s WHERE s.venue_id = v.id) AS seatCount
                FROM venues v ORDER BY v.name`)
    .all()
    .map((venue) => ({
      ...venue,
      categories: db.prepare('SELECT id, name FROM categories WHERE venue_id = ? ORDER BY id').all(venue.id),
    }));

export const getVenue = (venueId) => {
  const venue = db.prepare('SELECT id, name, city FROM venues WHERE id = ?').get(venueId);
  if (!venue) throw notFound('Venue not found.');

  return {
    ...venue,
    categories: db.prepare('SELECT id, name FROM categories WHERE venue_id = ? ORDER BY id').all(venueId),
    rows: db
      .prepare(`SELECT s.row_label AS label, c.name AS category, COUNT(*) AS seats
                  FROM seats s JOIN categories c ON c.id = s.category_id
                 WHERE s.venue_id = ?
                 GROUP BY s.row_label, c.name
                 ORDER BY s.row_label`)
      .all(venueId),
  };
};

// --- Events ---------------------------------------------------------------

export const createEvent = ({ title, kind, description, language, runtimeMin }, organiserId) => {
  if (!['movie', 'concert'].includes(kind)) throw badRequest('Kind must be "movie" or "concert".');

  const id = Number(
    db
      .prepare('INSERT INTO events (organiser_id, title, kind, description, language, runtime_min) VALUES (?, ?, ?, ?, ?, ?)')
      .run(organiserId, title, kind, description || '', language || '', runtimeMin ? Number(runtimeMin) : null)
      .lastInsertRowid
  );
  return getEvent(id);
};

/** Browse and filter the catalogue. Only events with at least one show appear. */
export const listEvents = ({ q, kind, city, date } = {}) => {
  const where = ['EXISTS (SELECT 1 FROM shows sh WHERE sh.event_id = e.id)'];
  const params = [];

  if (q) {
    where.push('(e.title LIKE ? OR e.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (kind) {
    where.push('e.kind = ?');
    params.push(kind);
  }
  if (city) {
    where.push('EXISTS (SELECT 1 FROM shows sh JOIN venues v ON v.id = sh.venue_id WHERE sh.event_id = e.id AND v.city = ?)');
    params.push(city);
  }
  if (date) {
    where.push("EXISTS (SELECT 1 FROM shows sh WHERE sh.event_id = e.id AND date(sh.starts_at) = date(?))");
    params.push(date);
  }

  return db
    .prepare(`SELECT e.id, e.title, e.kind, e.description, e.language, e.runtime_min AS runtimeMin,
                     u.name AS organiser,
                     (SELECT COUNT(*) FROM shows sh WHERE sh.event_id = e.id) AS showCount,
                     (SELECT MIN(sh.starts_at) FROM shows sh WHERE sh.event_id = e.id) AS nextShowAt
                FROM events e
                JOIN users u ON u.id = e.organiser_id
               WHERE ${where.join(' AND ')}
               ORDER BY nextShowAt`)
    .all(...params);
};

export const getEvent = (eventId) => {
  const event = db
    .prepare(`SELECT e.id, e.title, e.kind, e.description, e.language, e.runtime_min AS runtimeMin,
                     e.organiser_id AS organiserId, u.name AS organiser
                FROM events e JOIN users u ON u.id = e.organiser_id
               WHERE e.id = ?`)
    .get(eventId);
  if (!event) throw notFound('Event not found.');

  return { ...event, shows: listShowsForEvent(eventId) };
};

export const listCities = () => db.prepare('SELECT DISTINCT city FROM venues ORDER BY city').all().map((r) => r.city);

// --- Shows ----------------------------------------------------------------

const showSummary = `
  SELECT sh.id, sh.starts_at AS startsAt, sh.event_id AS eventId,
         v.id AS venueId, v.name AS venueName, v.city AS venueCity,
         (SELECT COUNT(*) FROM show_seats ss WHERE ss.show_id = sh.id) AS seats,
         (SELECT COUNT(*) FROM show_seats ss
           WHERE ss.show_id = sh.id
             AND (ss.status = 'available' OR (ss.status = 'held' AND ss.hold_expires_at <= ?))) AS available,
         (SELECT MIN(price) FROM show_prices sp WHERE sp.show_id = sh.id) AS fromPrice
    FROM shows sh JOIN venues v ON v.id = sh.venue_id
`;

export const listShowsForEvent = (eventId) =>
  db.prepare(`${showSummary} WHERE sh.event_id = ? ORDER BY sh.starts_at`).all(Date.now(), eventId);

export const getShow = (showId) => {
  const show = db.prepare(`${showSummary} WHERE sh.id = ?`).get(Date.now(), showId);
  if (!show) throw notFound('Show not found.');

  const event = db
    .prepare('SELECT id, title, kind, description, language, runtime_min AS runtimeMin FROM events WHERE id = ?')
    .get(show.eventId);

  return { ...show, event };
};

/**
 * Schedules a show and materialises one seat row per venue seat.
 *
 * Prices are copied onto each show_seat at creation time so a later price
 * change cannot alter what an existing booking was charged.
 */
export const createShow = writeTxn(({ eventId, venueId, startsAt, prices }, organiserId) => {
  const event = db.prepare('SELECT id, organiser_id AS organiserId FROM events WHERE id = ?').get(eventId);
  if (!event) throw notFound('Event not found.');
  if (event.organiserId !== organiserId) throw notFound('Event not found.');

  const venue = db.prepare('SELECT id FROM venues WHERE id = ?').get(venueId);
  if (!venue) throw notFound('Venue not found.');

  const when = new Date(startsAt);
  if (Number.isNaN(when.getTime())) throw badRequest('startsAt must be a valid date and time.');

  const categories = db.prepare('SELECT id, name FROM categories WHERE venue_id = ?').all(venueId);
  const priceFor = new Map();

  for (const category of categories) {
    // Accept either the category id or its name as the key, since the admin UI
    // knows ids while a hand-written request is easier to read with names.
    const raw = prices?.[category.id] ?? prices?.[category.name];
    const price = Number(raw);
    if (!Number.isFinite(price) || price < 0) {
      throw badRequest(`Set a price for the "${category.name}" category.`);
    }
    priceFor.set(category.id, price);
  }

  const showId = Number(
    db.prepare('INSERT INTO shows (event_id, venue_id, starts_at) VALUES (?, ?, ?)')
      .run(eventId, venueId, when.toISOString()).lastInsertRowid
  );

  const addPrice = db.prepare('INSERT INTO show_prices (show_id, category_id, price) VALUES (?, ?, ?)');
  for (const [categoryId, price] of priceFor) addPrice.run(showId, categoryId, price);

  const addShowSeat = db.prepare('INSERT INTO show_seats (show_id, seat_id, category_id, price) VALUES (?, ?, ?, ?)');
  const seats = db.prepare('SELECT id, category_id AS categoryId FROM seats WHERE venue_id = ?').all(venueId);
  if (seats.length === 0) throw badRequest('That venue has no seats yet.');

  for (const seat of seats) addShowSeat.run(showId, seat.id, seat.categoryId, priceFor.get(seat.categoryId));

  return getShow(showId);
});
