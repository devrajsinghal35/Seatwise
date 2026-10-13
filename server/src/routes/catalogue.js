import { Router } from 'express';
import { authenticate, requireRole } from '../lib/auth.js';
import {
  createEvent, createShow, createVenue, getEvent, getShow, getVenue, listCities, listEvents, listVenues,
} from '../services/catalogue.js';
import { eventSummary, organiserEvents } from '../services/reports.js';

import { eventSchema, showSchema, validateBody, venueSchema } from '../lib/validation.js';

export const catalogueRoutes = Router();

// --- Venues (admin) -------------------------------------------------------

catalogueRoutes.get('/venues', async (req, res, next) => {
  try {
    res.json({ venues: await listVenues() });
  } catch (err) {
    next(err);
  }
});

catalogueRoutes.get('/venues/:id', async (req, res, next) => {
  try {
    res.json({ venue: await getVenue(Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

catalogueRoutes.post('/venues', authenticate, requireRole('admin'), validateBody(venueSchema), async (req, res, next) => {
  try {
    const venue = await createVenue(req.body, req.user.id);
    res.status(201).json({ venue });
  } catch (err) {
    next(err);
  }
});

// --- Events ---------------------------------------------------------------

catalogueRoutes.get('/events', async (req, res, next) => {
  try {
    const { q, kind, city, date } = req.query;
    res.json({ events: await listEvents({ q, kind, city, date }) });
  } catch (err) {
    next(err);
  }
});

catalogueRoutes.get('/events/:id', async (req, res, next) => {
  try {
    res.json({ event: await getEvent(Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

catalogueRoutes.post('/events', authenticate, requireRole('organiser'), validateBody(eventSchema), async (req, res, next) => {
  try {
    const event = await createEvent(req.body, req.user.id);
    res.status(201).json({ event });
  } catch (err) {
    next(err);
  }
});

catalogueRoutes.get('/cities', async (req, res, next) => {
  try {
    res.json({ cities: await listCities() });
  } catch (err) {
    next(err);
  }
});

// --- Shows ----------------------------------------------------------------

catalogueRoutes.get('/shows/:id', async (req, res, next) => {
  try {
    res.json({ show: await getShow(Number(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

catalogueRoutes.post('/shows', authenticate, requireRole('organiser'), validateBody(showSchema), async (req, res, next) => {
  try {
    const show = await createShow(req.body, req.user.id);
    res.status(201).json({ show });
  } catch (err) {
    next(err);
  }
});

// --- Organiser reporting --------------------------------------------------

catalogueRoutes.get('/organiser/events', authenticate, requireRole('organiser'), async (req, res, next) => {
  try {
    res.json({ events: await organiserEvents(req.user.id) });
  } catch (err) {
    next(err);
  }
});

catalogueRoutes.get('/organiser/events/:id/summary', authenticate, requireRole('organiser'), async (req, res, next) => {
  try {
    res.json({ summary: await eventSummary(Number(req.params.id), req.user.id) });
  } catch (err) {
    next(err);
  }
});
