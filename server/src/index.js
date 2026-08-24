import { config, brevoConfigured } from './config.js';
import { createApp } from './app.js';
import { startSweeper } from './services/sweeper.js';

createApp().listen(config.port, () => {
  console.log(`SeatWise API on http://localhost:${config.port}`);
  console.log(`hold TTL ${config.holdTtlSeconds}s, waitlist offer TTL ${config.offerTtlSeconds}s`);
  console.log(brevoConfigured ? 'email: Brevo API' : `email: writing .eml files to ${config.mail.outbox}`);
  startSweeper();
});
