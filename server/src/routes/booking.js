import { Router } from 'express';
import { authenticate, optionalAuth, requireRole } from '../lib/auth.js';
import { requireFields } from '../lib/http.js';
import { cancelBooking, checkout, getBooking, listBookings } from '../services/bookings.js';
import { subscribe } from '../services/realtime.js';
import { activeHold, categorySummary, holdSeats, readSeatMap, releaseHeldSeats } from '../services/seats.js';
import { qrDataUrl } from '../services/qr.js';

export const bookingRoutes = Router();

// --- Seat map -------------------------------------------------------------

bookingRoutes.get('/shows/:id/seats', optionalAuth, (req, res) => {
  const showId = Number(req.params.id);
  res.json({
    seats: readSeatMap(showId, req.user?.id ?? null),
    categories: categorySummary(showId),
    hold: req.user ? activeHold(showId, req.user.id) : null,
  });
});

// Live seat status. The browser reads this with EventSource.
bookingRoutes.get('/shows/:id/stream', (req, res) => subscribe(Number(req.params.id), res));

// --- Holds ----------------------------------------------------------------

bookingRoutes.post('/shows/:id/hold', authenticate, requireRole('customer'), (req, res) => {
  const { seatIds } = requireFields(req.body, ['seatIds']);
  res.json({ hold: holdSeats(Number(req.params.id), req.user.id, seatIds) });
});

bookingRoutes.delete('/shows/:id/hold', authenticate, requireRole('customer'), async (req, res) => {
  const result = await releaseHeldSeats(Number(req.params.id), req.user.id, req.body?.seatIds ?? []);
  res.json(result);
});

// --- Bookings -------------------------------------------------------------

bookingRoutes.post('/bookings', authenticate, requireRole('customer'), async (req, res) => {
  const { showId, guestName, guestMobile, guestEmail } = requireFields(req.body, ['showId', 'guestName', 'guestMobile', 'guestEmail']);
  // A retried submit reuses this key and gets the original booking back.
  const idempotencyKey = req.get('idempotency-key') || req.body.idempotencyKey || null;
  const booking = await checkout(Number(showId), req.user.id, idempotencyKey, guestName, guestMobile, guestEmail);
  res.status(201).json({ booking });
});

bookingRoutes.get('/bookings', authenticate, (req, res) => res.json({ bookings: listBookings(req.user.id) }));

bookingRoutes.get('/bookings/:id', authenticate, (req, res) =>
  res.json({ booking: getBooking(Number(req.params.id), req.user.id) })
);

// The ticket QR, rendered on demand so no image files need storing.
bookingRoutes.get('/bookings/:id/qr', authenticate, async (req, res) => {
  const booking = getBooking(Number(req.params.id), req.user.id);
  res.json({ reference: booking.reference, dataUrl: await qrDataUrl(booking.reference) });
});

bookingRoutes.post('/bookings/:id/cancel', authenticate, async (req, res) => {
  res.json(await cancelBooking(Number(req.params.id), req.user.id));
});
