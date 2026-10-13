import { Router } from 'express';
import { authenticate, optionalAuth, requireRole } from '../lib/auth.js';
import { cancelBooking, checkout, getBooking, listBookings } from '../services/bookings.js';
import { subscribe } from '../services/realtime.js';
import { activeHold, categorySummary, holdSeats, readSeatMap, releaseHeldSeats } from '../services/seats.js';
import { qrDataUrl } from '../services/qr.js';

import { holdLimiter } from '../lib/rateLimit.js';
import { bookingSchema, holdSchema, validateBody } from '../lib/validation.js';

export const bookingRoutes = Router();

// --- Seat map -------------------------------------------------------------

bookingRoutes.get('/shows/:id/seats', optionalAuth, async (req, res, next) => {
  try {
    const showId = Number(req.params.id);
    const [seats, categories, hold] = await Promise.all([
      readSeatMap(showId, req.user?.id ?? null),
      categorySummary(showId),
      req.user ? activeHold(showId, req.user.id) : Promise.resolve(null),
    ]);
    res.json({ seats, categories, hold });
  } catch (err) {
    next(err);
  }
});

// Live seat status. The browser reads this with EventSource.
bookingRoutes.get('/shows/:id/stream', (req, res) => subscribe(Number(req.params.id), res));

// --- Holds ----------------------------------------------------------------

bookingRoutes.post(
  '/shows/:id/hold',
  holdLimiter,
  authenticate,
  requireRole('customer'),
  validateBody(holdSchema),
  async (req, res, next) => {
    try {
      const { seatIds } = req.body;
      const hold = await holdSeats(Number(req.params.id), req.user.id, seatIds);
      res.json({ hold });
    } catch (err) {
      next(err);
    }
  }
);

bookingRoutes.delete('/shows/:id/hold', authenticate, requireRole('customer'), async (req, res, next) => {
  try {
    const result = await releaseHeldSeats(Number(req.params.id), req.user.id, req.body?.seatIds ?? []);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- Bookings -------------------------------------------------------------

bookingRoutes.post(
  '/bookings',
  authenticate,
  requireRole('customer'),
  validateBody(bookingSchema),
  async (req, res, next) => {
    try {
      const { showId, guestName, guestMobile, guestEmail } = req.body;
      // A retried submit reuses this key and gets the original booking back.
      const idempotencyKey = req.get('idempotency-key') || req.body.idempotencyKey || null;
      const booking = await checkout(Number(showId), req.user.id, idempotencyKey, guestName, guestMobile, guestEmail);
      res.status(201).json({ booking });
    } catch (err) {
      next(err);
    }
  }
);

bookingRoutes.get('/bookings', authenticate, async (req, res, next) => {
  try {
    res.json({ bookings: await listBookings(req.user.id) });
  } catch (err) {
    next(err);
  }
});

bookingRoutes.get('/bookings/:id', authenticate, async (req, res, next) => {
  try {
    res.json({ booking: await getBooking(Number(req.params.id), req.user.id) });
  } catch (err) {
    next(err);
  }
});

// The ticket QR, rendered on demand so no image files need storing.
bookingRoutes.get('/bookings/:id/qr', authenticate, async (req, res, next) => {
  try {
    const booking = await getBooking(Number(req.params.id), req.user.id);
    res.json({ reference: booking.reference, dataUrl: await qrDataUrl(booking.reference) });
  } catch (err) {
    next(err);
  }
});

bookingRoutes.post('/bookings/:id/cancel', authenticate, async (req, res, next) => {
  try {
    res.json(await cancelBooking(Number(req.params.id), req.user.id));
  } catch (err) {
    next(err);
  }
});
