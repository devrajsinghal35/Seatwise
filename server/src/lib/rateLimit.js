import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

export const createLimiter = (options = {}) =>
  rateLimit({
    windowMs: options.windowMs ?? 60 * 1000,
    limit: options.limit ?? 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: options.message || { error: 'rate_limited', message: 'Too many requests. Please try again later.' },
    handler: (req, res, next, opts) => {
      res.status(429).json(opts.message);
    },
    ...options,
  });

export const authLimiter = createLimiter({
  windowMs: config.rateLimit.authWindowMs,
  limit: () => config.rateLimit.authMax,
  message: { error: 'rate_limited', message: 'Too many authentication attempts. Please try again later.' },
});

export const holdLimiter = createLimiter({
  windowMs: config.rateLimit.holdWindowMs,
  limit: () => config.rateLimit.holdMax,
  message: { error: 'rate_limited', message: 'Too many hold attempts. Please try again later.' },
});

export const resetLimiters = async (ip = '127.0.0.1') => {
  await Promise.allSettled([
    authLimiter.resetKey(ip),
    holdLimiter.resetKey(ip),
  ]);
};


