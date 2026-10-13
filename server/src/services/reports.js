import { db } from '../db/index.js';
import { notFound } from '../lib/http.js';

/**
 * Revenue and occupancy for one organiser's event, broken down by show.
 * Cancelled bookings are excluded from revenue but reported separately so the
 * organiser can see churn rather than just a net figure.
 */
export const eventSummary = async (eventId, organiserId) => {
  const eventRes = await db.query(
    'SELECT id, title, kind, organiser_id AS "organiserId" FROM events WHERE id = $1',
    [eventId]
  );
  const event = eventRes.rows[0];

  if (!event || event.organiserId !== organiserId) throw notFound('Event not found.');

  const showsRes = await db.query(
    `SELECT sh.id, sh.starts_at AS "startsAt", v.name AS "venueName", v.city AS "venueCity",
            (SELECT COUNT(*) FROM show_seats ss WHERE ss.show_id = sh.id) AS seats,
            (SELECT COUNT(*) FROM show_seats ss WHERE ss.show_id = sh.id AND ss.status = 'booked') AS booked
       FROM shows sh
       JOIN venues v ON v.id = sh.venue_id
      WHERE sh.event_id = $1
      ORDER BY sh.starts_at`,
    [eventId]
  );
  const shows = showsRes.rows.map((s) => ({
    ...s,
    startsAt: s.startsAt instanceof Date ? s.startsAt.toISOString() : s.startsAt,
    seats: Number(s.seats),
    booked: Number(s.booked),
  }));

  const totalsRes = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.amount END), 0) AS revenue,
       COUNT(CASE WHEN b.status = 'confirmed' THEN 1 END) AS "confirmedBookings",
       COUNT(CASE WHEN b.status = 'cancelled' THEN 1 END) AS "cancelledBookings",
       COALESCE(SUM(CASE WHEN b.status = 'cancelled' THEN b.amount END), 0) AS refunded
     FROM bookings b
     JOIN shows sh ON sh.id = b.show_id
    WHERE sh.event_id = $1`,
    [eventId]
  );
  const totals = totalsRes.rows[0];

  const perShowRes = await db.query(
    `SELECT b.show_id AS "showId",
            COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.amount END), 0) AS revenue,
            COUNT(CASE WHEN b.status = 'confirmed' THEN 1 END) AS bookings
       FROM bookings b
       JOIN shows sh ON sh.id = b.show_id
      WHERE sh.event_id = $1
      GROUP BY b.show_id`,
    [eventId]
  );

  const revenueByShow = new Map(
    perShowRes.rows.map((r) => [
      r.showId,
      { revenue: Number(r.revenue), bookings: Number(r.bookings) },
    ])
  );

  const byCatRes = await db.query(
    `SELECT c.name AS category,
            COUNT(*) AS seats,
            SUM(CASE WHEN ss.status = 'booked' THEN 1 ELSE 0 END) AS booked,
            COALESCE(SUM(CASE WHEN ss.status = 'booked' THEN ss.price END), 0) AS revenue
       FROM show_seats ss
       JOIN categories c ON c.id = ss.category_id
       JOIN shows sh     ON sh.id = ss.show_id
      WHERE sh.event_id = $1
      GROUP BY c.id, c.name
      ORDER BY revenue DESC`,
    [eventId]
  );
  const byCategory = byCatRes.rows.map((r) => ({
    category: r.category,
    seats: Number(r.seats),
    booked: Number(r.booked),
    revenue: Number(Number(r.revenue).toFixed(2)),
  }));

  const waitRes = await db.query(
    `SELECT COUNT(*) AS n FROM waitlist w
       JOIN shows sh ON sh.id = w.show_id
      WHERE sh.event_id = $1 AND w.status IN ('waiting', 'offered')`,
    [eventId]
  );
  const waiting = Number(waitRes.rows[0]?.n ?? 0);

  const seats = shows.reduce((sum, s) => sum + s.seats, 0);
  const booked = shows.reduce((sum, s) => sum + s.booked, 0);
  const totalRevenue = Number(totals?.revenue ?? 0);
  const totalRefunded = Number(totals?.refunded ?? 0);

  return {
    event: { id: event.id, title: event.title, kind: event.kind },
    revenue: Number(totalRevenue.toFixed(2)),
    refunded: Number(totalRefunded.toFixed(2)),
    confirmedBookings: Number(totals?.confirmedBookings ?? 0),
    cancelledBookings: Number(totals?.cancelledBookings ?? 0),
    seats,
    booked,
    occupancy: seats ? Number(((booked / seats) * 100).toFixed(1)) : 0,
    waiting,
    byCategory,
    shows: shows.map((show) => {
      const showRev = revenueByShow.get(show.id)?.revenue ?? 0;
      const showBookings = revenueByShow.get(show.id)?.bookings ?? 0;
      return {
        ...show,
        revenue: Number(showRev.toFixed(2)),
        bookings: showBookings,
        occupancy: show.seats ? Number(((show.booked / show.seats) * 100).toFixed(1)) : 0,
      };
    }),
  };
};

export const organiserEvents = async (organiserId) => {
  const res = await db.query(
    `SELECT e.id, e.title, e.kind, e.language, e.runtime_min AS "runtimeMin",
            (SELECT COUNT(*) FROM shows sh WHERE sh.event_id = e.id) AS "showCount",
            (SELECT COALESCE(SUM(b.amount), 0) FROM bookings b
              JOIN shows sh ON sh.id = b.show_id
             WHERE sh.event_id = e.id AND b.status = 'confirmed') AS revenue
       FROM events e
      WHERE e.organiser_id = $1
      ORDER BY e.id DESC`,
    [organiserId]
  );

  return res.rows.map((r) => ({
    ...r,
    showCount: Number(r.showCount),
    revenue: Number(Number(r.revenue).toFixed(2)),
  }));
};
