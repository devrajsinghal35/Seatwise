import { db, writeTxn } from '../db/index.js';
import { badRequest, notFound } from '../lib/http.js';

// --- Venues ---------------------------------------------------------------

/**
 * Creates a venue together with its seat categories and full seat layout.
 *
 * The layout arrives as a list of rows, each naming how many seats it holds and
 * which category they belong to, which is what a grid builder produces.
 */
export const createVenue = writeTxn(async (client, { name, city, categories, rows }, adminId) => {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw badRequest('Give the venue at least one seat category.');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw badRequest('Give the venue at least one row of seats.');
  }

  const venueRes = await client.query(
    'INSERT INTO venues (name, city, created_by) VALUES ($1, $2, $3) RETURNING id',
    [name, city, adminId]
  );
  const venueId = venueRes.rows[0].id;

  const categoryIds = new Map();
  for (const raw of categories) {
    const categoryName = String(typeof raw === 'string' ? raw : raw?.name || '').trim();
    if (!categoryName) throw badRequest('Every seat category needs a name.');
    if (categoryIds.has(categoryName)) throw badRequest(`Duplicate seat category "${categoryName}".`);
    const catRes = await client.query(
      'INSERT INTO categories (venue_id, name) VALUES ($1, $2) RETURNING id',
      [venueId, categoryName]
    );
    categoryIds.set(categoryName, catRes.rows[0].id);
  }

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
      await client.query(
        'INSERT INTO seats (venue_id, category_id, row_label, seat_number) VALUES ($1, $2, $3, $4)',
        [venueId, categoryId, label, seatNumber]
      );
      seatCount += 1;
    }
  }

  return { id: venueId, name, city, seatCount, categories: [...categoryIds.keys()] };
});

export const listVenues = async () => {
  const venuesRes = await db.query(
    `SELECT v.id, v.name, v.city,
            (SELECT COUNT(*) FROM seats s WHERE s.venue_id = v.id) AS "seatCount"
       FROM venues v ORDER BY v.name`
  );
  const venues = venuesRes.rows;

  for (const venue of venues) {
    const catRes = await db.query('SELECT id, name FROM categories WHERE venue_id = $1 ORDER BY id', [venue.id]);
    venue.categories = catRes.rows;
  }
  return venues;
};

export const getVenue = async (venueId) => {
  const venueRes = await db.query('SELECT id, name, city FROM venues WHERE id = $1', [venueId]);
  const venue = venueRes.rows[0];
  if (!venue) throw notFound('Venue not found.');

  const categoriesRes = await db.query('SELECT id, name FROM categories WHERE venue_id = $1 ORDER BY id', [venueId]);
  const rowsRes = await db.query(
    `SELECT s.row_label AS label, c.name AS category, COUNT(*) AS seats
       FROM seats s JOIN categories c ON c.id = s.category_id
      WHERE s.venue_id = $1
      GROUP BY s.row_label, c.name
      ORDER BY s.row_label`,
    [venueId]
  );

  return {
    ...venue,
    categories: categoriesRes.rows,
    rows: rowsRes.rows,
  };
};

// --- Events ---------------------------------------------------------------

export const createEvent = async ({ title, kind, description, language, runtimeMin }, organiserId) => {
  if (!['movie', 'concert'].includes(kind)) throw badRequest('Kind must be "movie" or "concert".');

  const res = await db.query(
    `INSERT INTO events (organiser_id, title, kind, description, language, runtime_min)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [organiserId, title, kind, description || '', language || '', runtimeMin ? Number(runtimeMin) : null]
  );
  return getEvent(res.rows[0].id);
};

/** Browse and filter the catalogue. Only events with at least one show appear. */
export const listEvents = async ({ q, kind, city, date } = {}) => {
  const where = ['EXISTS (SELECT 1 FROM shows sh WHERE sh.event_id = e.id)'];
  const params = [];

  if (q) {
    params.push(`%${q}%`, `%${q}%`);
    where.push(`(e.title ILIKE $${params.length - 1} OR e.description ILIKE $${params.length})`);
  }
  if (kind) {
    params.push(kind);
    where.push(`e.kind = $${params.length}`);
  }
  if (city) {
    params.push(city);
    where.push(`EXISTS (SELECT 1 FROM shows sh JOIN venues v ON v.id = sh.venue_id WHERE sh.event_id = e.id AND v.city = $${params.length})`);
  }
  if (date) {
    params.push(date);
    where.push(`EXISTS (SELECT 1 FROM shows sh WHERE sh.event_id = e.id AND date(sh.starts_at) = date($${params.length}))`);
  }

  const res = await db.query(
    `SELECT e.id, e.title, e.kind, e.description, e.language, e.runtime_min AS "runtimeMin",
            u.name AS organiser,
            (SELECT COUNT(*) FROM shows sh WHERE sh.event_id = e.id) AS "showCount",
            (SELECT MIN(sh.starts_at) FROM shows sh WHERE sh.event_id = e.id) AS "nextShowAt"
       FROM events e
       JOIN users u ON u.id = e.organiser_id
      WHERE ${where.join(' AND ')}
      ORDER BY "nextShowAt"`,
    params
  );

  return res.rows.map((r) => ({
    ...r,
    nextShowAt: r.nextShowAt instanceof Date ? r.nextShowAt.toISOString() : r.nextShowAt,
  }));
};

export const getEvent = async (eventId) => {
  const res = await db.query(
    `SELECT e.id, e.title, e.kind, e.description, e.language, e.runtime_min AS "runtimeMin",
            e.organiser_id AS "organiserId", u.name AS organiser
       FROM events e JOIN users u ON u.id = e.organiser_id
      WHERE e.id = $1`,
    [eventId]
  );
  const event = res.rows[0];
  if (!event) throw notFound('Event not found.');

  return { ...event, shows: await listShowsForEvent(eventId) };
};

export const listCities = async () => {
  const res = await db.query('SELECT DISTINCT city FROM venues ORDER BY city');
  return res.rows.map((r) => r.city);
};

// --- Shows ----------------------------------------------------------------

const showSummary = `
  SELECT sh.id, sh.starts_at AS "startsAt", sh.event_id AS "eventId",
         v.id AS "venueId", v.name AS "venueName", v.city AS "venueCity",
         (SELECT COUNT(*) FROM show_seats ss WHERE ss.show_id = sh.id) AS seats,
         (SELECT COUNT(*) FROM show_seats ss
           WHERE ss.show_id = sh.id
             AND (ss.status = 'available' OR (ss.status = 'held' AND ss.hold_expires_at <= $1))) AS available,
         (SELECT MIN(price) FROM show_prices sp WHERE sp.show_id = sh.id) AS "fromPrice"
    FROM shows sh JOIN venues v ON v.id = sh.venue_id
`;

export const listShowsForEvent = async (eventId) => {
  const res = await db.query(`${showSummary} WHERE sh.event_id = $2 ORDER BY sh.starts_at`, [Date.now(), eventId]);
  return res.rows.map((r) => ({
    ...r,
    startsAt: r.startsAt instanceof Date ? r.startsAt.toISOString() : r.startsAt,
  }));
};

export const getShow = async (showId, runner = db) => {
  const res = await runner.query(`${showSummary} WHERE sh.id = $2`, [Date.now(), showId]);
  const show = res.rows[0];
  if (!show) throw notFound('Show not found.');

  const eventRes = await runner.query(
    'SELECT id, title, kind, description, language, runtime_min AS "runtimeMin" FROM events WHERE id = $1',
    [show.eventId]
  );

  return {
    ...show,
    startsAt: show.startsAt instanceof Date ? show.startsAt.toISOString() : show.startsAt,
    event: eventRes.rows[0],
  };
};

/**
 * Schedules a show and materialises one seat row per venue seat.
 *
 * Prices are copied onto each show_seat at creation time so a later price
 * change cannot alter what an existing booking was charged.
 */
export const createShow = writeTxn(async (client, { eventId, venueId, startsAt, prices }, organiserId) => {
  const eventRes = await client.query('SELECT id, organiser_id AS "organiserId" FROM events WHERE id = $1', [eventId]);
  const event = eventRes.rows[0];
  if (!event) throw notFound('Event not found.');
  if (event.organiserId !== organiserId) throw notFound('Event not found.');

  const venueRes = await client.query('SELECT id FROM venues WHERE id = $1', [venueId]);
  const venue = venueRes.rows[0];
  if (!venue) throw notFound('Venue not found.');

  const when = new Date(startsAt);
  if (Number.isNaN(when.getTime())) throw badRequest('startsAt must be a valid date and time.');

  const catRes = await client.query('SELECT id, name FROM categories WHERE venue_id = $1', [venueId]);
  const categories = catRes.rows;
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

  const showInsert = await client.query(
    'INSERT INTO shows (event_id, venue_id, starts_at) VALUES ($1, $2, $3) RETURNING id',
    [eventId, venueId, when.toISOString()]
  );
  const showId = showInsert.rows[0].id;

  for (const [categoryId, price] of priceFor) {
    await client.query('INSERT INTO show_prices (show_id, category_id, price) VALUES ($1, $2, $3)', [showId, categoryId, price]);
  }

  const seatsRes = await client.query('SELECT id, category_id AS "categoryId" FROM seats WHERE venue_id = $1', [venueId]);
  const seats = seatsRes.rows;
  if (seats.length === 0) throw badRequest('That venue has no seats yet.');

  for (const seat of seats) {
    await client.query('INSERT INTO show_seats (show_id, seat_id, category_id, price) VALUES ($1, $2, $3, $4)', [
      showId,
      seat.id,
      seat.categoryId,
      priceFor.get(seat.categoryId),
    ]);
  }

  return getShow(showId, client);
});
