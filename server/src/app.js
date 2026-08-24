import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, serverRoot, brevoConfigured } from './config.js';
import { errorHandler } from './lib/http.js';
import { authRoutes } from './routes/auth.js';
import { bookingRoutes } from './routes/booking.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { waitlistRoutes } from './routes/waitlist.js';

export const createApp = () => {
  const app = express();

  // Enable CORS for Vercel/cross-origin frontend deployments
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (req, res) =>
    res.json({
      status: 'ok',
      holdTtlSeconds: config.holdTtlSeconds,
      offerTtlSeconds: config.offerTtlSeconds,
      mail: brevoConfigured ? 'brevo' : 'outbox',
    })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api', catalogueRoutes);
  app.use('/api', bookingRoutes);
  app.use('/api', waitlistRoutes);

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'No such endpoint.' }));

  // In development Vite serves the frontend and proxies /api here. Once the
  // frontend is built, this process serves it too so a deployment is one service.
  const clientDir = resolve(serverRoot, '../web/dist');
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get('*splat', (req, res) => res.sendFile(resolve(clientDir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
};
