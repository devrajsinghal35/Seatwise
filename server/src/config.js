import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Node loads .env natively, so no dotenv dependency is needed.
const envFile = resolve(serverRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: num(process.env.PORT, 4000),
  jwtSecret: process.env.JWT_SECRET || 'seatwise-dev-secret-change-me',
  tokenTtl: process.env.TOKEN_TTL || '12h',

  databaseFile: process.env.DATABASE_FILE || resolve(serverRoot, 'data/seatwise.db'),

  // How long a checkout hold survives before the sweeper reclaims the seat.
  holdTtlSeconds: num(process.env.HOLD_TTL_SECONDS, 600),
  // How long a waitlisted customer has to claim a seat that was freed for them.
  offerTtlSeconds: num(process.env.OFFER_TTL_SECONDS, 300),
  sweepIntervalSeconds: num(process.env.SWEEP_INTERVAL_SECONDS, 5),

  // Used to build the claim link that goes in the waitlist offer email.
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),

  mail: {
    from: process.env.MAIL_FROM || 'SeatWise <devrajsinghal61@gmail.com>',
    apiKey: process.env.BREVO_API_KEY || '',
    outbox: process.env.MAIL_OUTBOX ? resolve(process.env.MAIL_OUTBOX) : resolve(serverRoot, 'outbox'),
  },
};

// With no Brevo API Key configured the mailer writes .eml files instead of sending,
// so the whole booking flow stays testable without an account anywhere.
export const brevoConfigured = Boolean(config.mail.apiKey);
