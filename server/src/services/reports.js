import { db } from '../db/index.js';
import { notFound } from '../lib/http.js';

/**
 * Revenue and occupancy for one organiser's event, broken down by show.
 * Cancelled bookings are excluded from revenue but reported separately so the
 * organiser can see churn rather than just a net figure.
 */
export const eventSummary = (eventId, organiserId) => {
  const event = db
    .prepare('SELECT id, title, kind, organiser_id AS organiserId FROM events WHERE id = ?')
    .get(eventId);

  if (!event || event.organiserId !== organiserId) throw notFound('Event not found.');

  const shows = db
    .prepare(`SELECT sh.id, sh.starts_at AS startsAt, v.name AS venueName, v.city AS venueCity,
                     (SELECT COUNT(*) FROM show_seats ss WHERE ss.show_id = sh.id) AS seats,
                     (SELECT COUNT(*) FROM show_seats ss WHERE ss.show_id = sh.id AND ss.status = 'booked') AS booked
                FROM shows sh
                JOIN venues v ON v.id = sh.venue_id
               WHERE sh.event_id = ?
               ORDER BY sh.starts_at`)
    .all(eventId);

  const totals = db
    .prepare(`SELECT
                COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.amount END), 0) AS revenue,
                COUNT(CASE WHEN b.status = 'confirmed' THEN 1 END) AS confirmedBookings,
                COUNT(CASE WHEN b.status = 'cancelled' THEN 1 END) AS cancelledBookings,
                COALESCE(SUM(CASE WHEN b.status = 'cancelled' THEN b.amount END), 0) AS refunded
              FROM bookings b
              JOIN shows sh ON sh.id = b.show_id
             WHERE sh.event_id = ?`)
    .get(eventId);

  const perShow = db
    .prepare(`SELECT b.show_id AS showId,
                     COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.amount END), 0) AS revenue,
                     COUNT(CASE WHEN b.status = 'confirmed' THEN 1 END) AS bookings
                FROM bookings b
                JOIN shows sh ON sh.id = b.show_id
               WHERE sh.event_id = ?
               GROUP BY b.show_id`)
    .all(eventId);

  const revenueByShow = new Map(perShow.map((r) => [r.showId, r]));

  const byCategory = db
    .prepare(`SELECT c.name AS category,
                     COUNT(*) AS seats,
                     SUM(CASE WHEN ss.status = 'booked' THEN 1 ELSE 0 END) AS booked,
                     COALESCE(SUM(CASE WHEN ss.status = 'booked' THEN ss.price END), 0) AS revenue
                FROM show_seats ss
                JOIN categories c ON c.id = ss.category_id
                JOIN shows sh     ON sh.id = ss.show_id
               WHERE sh.event_id = ?
               GROUP BY c.id
               ORDER BY revenue DESC`)
    .all(eventId);

  const waiting = db
    .prepare(`SELECT COUNT(*) AS n FROM waitlist w
                JOIN shows sh ON sh.id = w.show_id
               WHERE sh.event_id = ? AND w.status IN ('waiting', 'offered')`)
    .get(eventId).n;

  const seats = shows.reduce((sum, s) => sum + s.seats, 0);
  const booked = shows.reduce((sum, s) => sum + s.booked, 0);

  return {
    event: { id: event.id, title: event.title, kind: event.kind },
    revenue: Number(totals.revenue.toFixed(2)),
    refunded: Number(totals.refunded.toFixed(2)),
    confirmedBookings: totals.confirmedBookings,
    cancelledBookings: totals.cancelledBookings,
    seats,
    booked,
    occupancy: seats ? Number(((booked / seats) * 100).toFixed(1)) : 0,
    waiting,
    byCategory,
    shows: shows.map((show) => ({
      ...show,
      revenue: Number((revenueByShow.get(show.id)?.revenue ?? 0).toFixed(2)),
      bookings: revenueByShow.get(show.id)?.bookings ?? 0,
      occupancy: show.seats ? Number(((show.booked / show.seats) * 100).toFixed(1)) : 0,
    })),
  };
};

export const organiserEvents = (organiserId) =>
  db
    .prepare(`SELECT e.id, e.title, e.kind, e.language, e.runtime_min AS runtimeMin,
                     (SELECT COUNT(*) FROM shows sh WHERE sh.event_id = e.id) AS showCount,
                     (SELECT COALESCE(SUM(b.amount), 0) FROM bookings b
                       JOIN shows sh ON sh.id = b.show_id
                      WHERE sh.event_id = e.id AND b.status = 'confirmed') AS revenue
                FROM events e
               WHERE e.organiser_id = ?
               ORDER BY e.id DESC`)
    .all(organiserId);
