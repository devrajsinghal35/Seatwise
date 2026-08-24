// Server-sent events keep the seat map live. SSE is one-way and built into both
// Node and the browser, so it needs no WebSocket library and no message broker.

const rooms = new Map(); // showId -> Set<res>

export const subscribe = (showId, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stops proxies from buffering the stream
  });
  res.write(': connected\n\n');

  const room = rooms.get(showId) ?? new Set();
  room.add(res);
  rooms.set(showId, room);

  // Proxies drop idle connections, so send a comment line as a keep-alive.
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  res.on('close', () => {
    clearInterval(ping);
    room.delete(res);
    if (room.size === 0) rooms.delete(showId);
  });
};

/** Pushes a batch of seat changes to everyone watching one show. */
export const publishSeatChanges = (showId, seats) => {
  if (!seats?.length) return;

  const room = rooms.get(Number(showId));
  if (!room?.size) return;

  const frame = `event: seats\ndata: ${JSON.stringify({ seats })}\n\n`;
  for (const res of room) {
    try {
      res.write(frame);
    } catch {
      room.delete(res); // client vanished mid-write
    }
  }
};
