import { Router } from 'express';
import { authenticate, requireRole } from '../lib/auth.js';
import { claimWaitlistOffer } from '../services/bookings.js';
import { joinWaitlist, leaveWaitlist, listWaitlistForUser, readOffer } from '../services/waitlist.js';

import { validateBody, waitlistSchema } from '../lib/validation.js';

export const waitlistRoutes = Router();

waitlistRoutes.post(
  '/shows/:id/waitlist',
  authenticate,
  requireRole('customer'),
  validateBody(waitlistSchema),
  async (req, res, next) => {
    try {
      const { categoryId } = req.body;
      const entry = await joinWaitlist(Number(req.params.id), Number(categoryId), req.user.id);
      res.status(entry.alreadyQueued ? 200 : 201).json({ entry });
    } catch (err) {
      next(err);
    }
  }
);

waitlistRoutes.get('/waitlist', authenticate, async (req, res, next) => {
  try {
    res.json({ entries: await listWaitlistForUser(req.user.id) });
  } catch (err) {
    next(err);
  }
});

waitlistRoutes.delete('/waitlist/:id', authenticate, async (req, res, next) => {
  try {
    res.json(await leaveWaitlist(Number(req.params.id), req.user.id));
  } catch (err) {
    next(err);
  }
});

// --- Time-limited offers --------------------------------------------------

// Opened from the link in the waitlist email. Requires the signed-in customer
// the offer was made to, so a forwarded link cannot be used by someone else.
waitlistRoutes.get('/offers/:token', authenticate, async (req, res, next) => {
  try {
    const offer = await readOffer(req.params.token);
    if (offer.userId !== req.user.id) {
      return res.status(404).json({ error: 'offer_not_found', message: 'That offer link is not valid.' });
    }
    return res.json({ offer });
  } catch (err) {
    next(err);
  }
});

waitlistRoutes.post('/offers/:token/claim', authenticate, requireRole('customer'), async (req, res, next) => {
  try {
    const booking = await claimWaitlistOffer(req.params.token, req.user.id);
    res.status(201).json({ booking });
  } catch (err) {
    next(err);
  }
});
