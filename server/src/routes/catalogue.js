import { Router } from 'express';
import { authenticate, requireRole } from '../lib/auth.js';
import { requireFields } from '../lib/http.js';
import {
  createEvent, createShow, createVenue, getEvent, getShow, getVenue, listCities, listEvents, listVenues,
} from '../services/catalogue.js';
import { eventSummary, organiserEvents } from '../services/reports.js';

export const catalogueRoutes = Router();

// --- Venues (admin) -------------------------------------------------------

catalogueRoutes.get('/venues', (req, res) => res.json({ venues: listVenues() }));
catalogueRoutes.get('/venues/:id', (req, res) => res.json({ venue: getVenue(Number(req.params.id)) }));

catalogueRoutes.post('/venues', authenticate, requireRole('admin'), (req, res) => {
  const { name, city } = requireFields(req.body, ['name', 'city']);
  const venue = createVenue({ name, city, categories: req.body.categories, rows: req.body.rows }, req.user.id);
  res.status(201).json({ venue });
});

// --- Events ---------------------------------------------------------------

catalogueRoutes.get('/events', (req, res) => {
  const { q, kind, city, date } = req.query;
  res.json({ events: listEvents({ q, kind, city, date }) });
});

catalogueRoutes.get('/events/:id', (req, res) => res.json({ event: getEvent(Number(req.params.id)) }));

catalogueRoutes.post('/events', authenticate, requireRole('organiser'), (req, res) => {
  const { title, kind } = requireFields(req.body, ['title', 'kind']);
  const event = createEvent({ ...req.body, title, kind }, req.user.id);
  res.status(201).json({ event });
});

catalogueRoutes.get('/cities', (req, res) => res.json({ cities: listCities() }));

// --- Shows ----------------------------------------------------------------

catalogueRoutes.get('/shows/:id', (req, res) => res.json({ show: getShow(Number(req.params.id)) }));

catalogueRoutes.post('/shows', authenticate, requireRole('organiser'), (req, res) => {
  const { eventId, venueId, startsAt } = requireFields(req.body, ['eventId', 'venueId', 'startsAt']);
  const show = createShow({ eventId: Number(eventId), venueId: Number(venueId), startsAt, prices: req.body.prices }, req.user.id);
  res.status(201).json({ show });
});

// --- Organiser reporting --------------------------------------------------

catalogueRoutes.get('/organiser/events', authenticate, requireRole('organiser'), (req, res) =>
  res.json({ events: organiserEvents(req.user.id) })
);

catalogueRoutes.get('/organiser/events/:id/summary', authenticate, requireRole('organiser'), (req, res) =>
  res.json({ summary: eventSummary(Number(req.params.id), req.user.id) })
);
