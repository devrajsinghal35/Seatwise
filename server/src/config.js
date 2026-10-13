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

export const DEV_JWT_SECRET = 'seatwise-dev-secret-change-me';

const isProduction = process.env.NODE_ENV === 'production';
const isDevSecret =
  !process.env.JWT_SECRET ||
  process.env.JWT_SECRET === DEV_JWT_SECRET ||
  process.env.JWT_SECRET === 'change-this-to-a-long-random-string';

if (isProduction && isDevSecret) {
  throw new Error('JWT_SECRET must be set to a secure secret in production.');
}

export const config = {
  port: num(process.env.PORT, 4000),
  get corsOrigins() {
    return (process.env.CORS_ORIGINS || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  jwtSecret: process.env.JWT_SECRET || DEV_JWT_SECRET,
  tokenTtl: process.env.TOKEN_TTL || '12h',

  get databaseUrl() {
    return process.env.DATABASE_URL || 'postgres://localhost:5432/seatwise';
  },
  get testDatabaseUrl() {
    return process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/seatwise_test';
  },

  // How long a checkout hold survives before the sweeper reclaims the seat.
  get holdTtlSeconds() {
    return num(process.env.HOLD_TTL_SECONDS, 600);
  },
  // How long a waitlisted customer has to claim a seat that was freed for them.
  get offerTtlSeconds() {
    return num(process.env.OFFER_TTL_SECONDS, 300);
  },
  get sweepIntervalSeconds() {
    return num(process.env.SWEEP_INTERVAL_SECONDS, 5);
  },

  rateLimit: {
    get authMax() {
      return num(process.env.RATE_LIMIT_AUTH_MAX, 10);
    },
    get authWindowMs() {
      return num(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 60 * 1000);
    },
    get holdMax() {
      return num(process.env.RATE_LIMIT_HOLD_MAX, 30);
    },
    get holdWindowMs() {
      return num(process.env.RATE_LIMIT_HOLD_WINDOW_MS, 60 * 1000);
    },
  },

  // Used to build the claim link that goes in the waitlist offer email.
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),

  mail: {
    from: process.env.MAIL_FROM || 'SeatWise <noreply@seatwise.example>',
    apiKey: process.env.BREVO_API_KEY || '',
    outbox: process.env.MAIL_OUTBOX ? resolve(process.env.MAIL_OUTBOX) : resolve(serverRoot, 'outbox'),
  },
};

// With no Brevo API Key configured the mailer writes .eml files instead of sending,
// so the whole booking flow stays testable without an account anywhere.
export const brevoConfigured = Boolean(config.mail.apiKey);
