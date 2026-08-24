import { Router } from 'express';
import { authenticate, requireRole } from '../lib/auth.js';
import { requireFields } from '../lib/http.js';
import { claimWaitlistOffer } from '../services/bookings.js';
import { joinWaitlist, leaveWaitlist, listWaitlistForUser, readOffer } from '../services/waitlist.js';

export const waitlistRoutes = Router();

waitlistRoutes.post('/shows/:id/waitlist', authenticate, requireRole('customer'), (req, res) => {
  const { categoryId } = requireFields(req.body, ['categoryId']);
  const entry = joinWaitlist(Number(req.params.id), Number(categoryId), req.user.id);
  res.status(entry.alreadyQueued ? 200 : 201).json({ entry });
});

waitlistRoutes.get('/waitlist', authenticate, (req, res) =>
  res.json({ entries: listWaitlistForUser(req.user.id) })
);

waitlistRoutes.delete('/waitlist/:id', authenticate, async (req, res) =>
  res.json(await leaveWaitlist(Number(req.params.id), req.user.id))
);

// --- Time-limited offers --------------------------------------------------

// Opened from the link in the waitlist email. Requires the signed-in customer
// the offer was made to, so a forwarded link cannot be used by someone else.
waitlistRoutes.get('/offers/:token', authenticate, (req, res) => {
  const offer = readOffer(req.params.token);
  if (offer.userId !== req.user.id) {
    return res.status(404).json({ error: 'offer_not_found', message: 'That offer link is not valid.' });
  }
  return res.json({ offer });
});

waitlistRoutes.post('/offers/:token/claim', authenticate, requireRole('customer'), async (req, res) => {
  const booking = await claimWaitlistOffer(req.params.token, req.user.id);
  res.status(201).json({ booking });
});
