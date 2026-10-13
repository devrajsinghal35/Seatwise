// Server-sent events keep the seat map live.
// When REDIS_URL is configured, events are published to Redis channels per show
// so that all server instances receive and forward them to their local SSE clients.
// When REDIS_URL is absent, it falls back seamlessly to in-memory local broadcasting.

import { config } from '../config.js';
import { getRedisPublisher, getRedisSubscriber } from '../lib/redis.js';

const rooms = new Map(); // showId -> Set<res>
const subscribedShows = new Set(); // showIds currently subscribed in Redis

const channelFor = (showId) => `seatwise:show:${showId}`;

let subscriberInitialized = false;

const initSubscriber = () => {
  if (subscriberInitialized) return;
  const subscriber = getRedisSubscriber();
  if (!subscriber) return;

  subscriberInitialized = true;
  subscriber.on('message', (channel, message) => {
    const prefix = 'seatwise:show:';
    if (!channel.startsWith(prefix)) return;
    const showId = Number(channel.slice(prefix.length));
    try {
      const payload = JSON.parse(message);
      if (Array.isArray(payload?.seats)) {
        broadcastLocal(showId, payload.seats);
      }
    } catch (err) {
      console.error('[realtime] failed to parse message:', err.message);
    }
  });
};

const broadcastLocal = (showId, seats) => {
  if (!seats?.length) return;
  const room = rooms.get(Number(showId));
  if (!room?.size) return;

  const frame = `event: seats\ndata: ${JSON.stringify({ seats })}\n\n`;
  for (const res of room) {
    try {
      res.write(frame);
    } catch {
      room.delete(res);
    }
  }
};

export const subscribe = (showId, res) => {
  const numericShowId = Number(showId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stops proxies from buffering the stream
  });
  res.write(': connected\n\n');

  const room = rooms.get(numericShowId) ?? new Set();
  room.add(res);
  rooms.set(numericShowId, room);

  // Subscribe to Redis channel for this show if not already subscribed
  const subscriber = getRedisSubscriber();
  if (subscriber) {
    initSubscriber();
    if (!subscribedShows.has(numericShowId)) {
      subscribedShows.add(numericShowId);
      subscriber.subscribe(channelFor(numericShowId)).catch((err) => {
        console.error(`[realtime] failed to subscribe to channel for show ${numericShowId}:`, err.message);
      });
    }
  }

  // Proxies drop idle connections, so send a comment line as a keep-alive.
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(ping);
      room.delete(res);
    }
  }, 25_000);

  res.on('close', () => {
    clearInterval(ping);
    room.delete(res);
    if (room.size === 0) {
      rooms.delete(numericShowId);
      if (subscriber && subscribedShows.has(numericShowId)) {
        subscribedShows.delete(numericShowId);
        subscriber.unsubscribe(channelFor(numericShowId)).catch(() => {});
      }
    }
  });
};

/** Pushes a batch of seat changes to everyone watching one show. */
export const publishSeatChanges = (showId, seats) => {
  if (!seats?.length) return;
  const numericShowId = Number(showId);

  const publisher = getRedisPublisher();
  if (publisher) {
    initSubscriber();
    publisher
      .publish(channelFor(numericShowId), JSON.stringify({ seats }))
      .catch((err) => {
        console.error('[realtime] redis publish failed, falling back to local:', err.message);
        broadcastLocal(numericShowId, seats);
      });
  } else {
    // In-memory single-node fallback
    broadcastLocal(numericShowId, seats);
  }
};

export const resetRealtime = () => {
  rooms.clear();
  subscribedShows.clear();
};
