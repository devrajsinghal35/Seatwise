import Redis from 'ioredis';
import { config } from '../config.js';

let redisClient = null;
let redisPublisher = null;
let redisSubscriber = null;

export const createRedisClient = (url = config.redisUrl) => {
  if (!url) return null;
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 10) return null;
      return Math.min(times * 100, 2000);
    },
  });
  client.on('error', (err) => {
    // Only log if not in silent tests
    if (process.env.NODE_ENV !== 'test') {
      console.error('[redis] error:', err.message);
    }
  });
  return client;
};

export const getRedisClient = () => {
  if (!config.redisUrl) return null;
  if (!redisClient) {
    redisClient = createRedisClient();
    redisClient.connect().catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[redis] connect error:', err.message);
      }
    });
  }
  return redisClient;
};

export const getRedisPublisher = () => {
  if (!config.redisUrl) return null;
  if (!redisPublisher) {
    redisPublisher = createRedisClient();
    redisPublisher.connect().catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[redis] publisher connect error:', err.message);
      }
    });
  }
  return redisPublisher;
};

export const getRedisSubscriber = () => {
  if (!config.redisUrl) return null;
  if (!redisSubscriber) {
    redisSubscriber = createRedisClient();
    redisSubscriber.connect().catch((err) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[redis] subscriber connect error:', err.message);
      }
    });
  }
  return redisSubscriber;
};

export const closeRedis = async () => {
  const clients = [redisClient, redisPublisher, redisSubscriber].filter(Boolean);
  redisClient = null;
  redisPublisher = null;
  redisSubscriber = null;
  await Promise.allSettled(clients.map((c) => c.quit().catch(() => c.disconnect())));
};
