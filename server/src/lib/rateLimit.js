import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { config } from '../config.js';
import { getRedisClient } from './redis.js';

export const createLimiter = (options = {}) => {
  const { prefix, ...rateLimitOptions } = options;
  const redisClient = getRedisClient();
  const store = redisClient
    ? new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
        prefix: prefix ? `rl:${prefix}:` : 'rl:',
      })
    : undefined;

  return rateLimit({
    windowMs: rateLimitOptions.windowMs ?? 60 * 1000,
    limit: rateLimitOptions.limit ?? 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: rateLimitOptions.message || { error: 'rate_limited', message: 'Too many requests. Please try again later.' },
    handler: (req, res, next, opts) => {
      res.status(429).json(opts.message);
    },
    ...(store ? { store } : {}),
    ...rateLimitOptions,
  });
};

export const authLimiter = createLimiter({
  prefix: 'auth',
  windowMs: config.rateLimit.authWindowMs,
  limit: () => config.rateLimit.authMax,
  message: { error: 'rate_limited', message: 'Too many authentication attempts. Please try again later.' },
});

export const holdLimiter = createLimiter({
  prefix: 'hold',
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
