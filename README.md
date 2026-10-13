# SeatWise

[![CI](https://github.com/devrajsinghal35/SeatWise/actions/workflows/ci.yml/badge.svg)](https://github.com/devrajsinghal35/SeatWise/actions/workflows/ci.yml)
[![OpenAPI 3.0](https://img.shields.io/badge/OpenAPI-3.0-blue.svg)](http://localhost:4000/api/docs)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

SeatWise is a distributed, high-concurrency ticket booking engine and seat reservation platform built for live events, movies, and concerts. Customers select seats from a real-time interactive auditorium map, hold selections under a strict time-to-live (TTL) guarantee, receive live state updates over Server-Sent Events (SSE), and seamlessly join automatic FIFO waitlists when showings sell out. Powered by PostgreSQL 15 row-level locks, compare-and-swap (CAS) transitions, and Redis Pub/Sub, SeatWise guarantees zero double-bookings under extreme concurrent contention across multiple horizontally-scaled instances.

---

## Key Engineering Decisions

1. **Atomic Compare-And-Swap (CAS) Holds**:
   Instead of checking seat availability and subsequently writing (which creates a race window), holds are claimed atomically in a single conditional SQL operation:
   ```sql
   UPDATE show_seats
      SET status = 'held', held_by = $1, hold_expires_at = $2, hold_kind = 'checkout'
    WHERE id = $3 AND show_id = $4
      AND (status = 'available'
           OR (status = 'held' AND hold_kind = 'checkout' AND hold_expires_at <= $5));
   ```
   If `rowCount === 1`, the caller claims the seat. If `0`, another concurrent request won the seat, and the transaction rolls back cleanly with `409 Conflict`. Multi-seat requests sort seat IDs in strictly ascending order (`ORDER BY id FOR UPDATE`) to prevent database deadlocks.

2. **Derived Expiry (Not Scheduled)**:
   Seat hold expiry is derived from the clock on every read and write, rather than relying on scheduled callbacks or timers. If an instance restarts or a worker dies, a lapsed hold is instantly treated as available by the next customer without waiting for an asynchronous sweeper. Correctness is strictly preserved on write; the sweeper exists only to notify browsers and tidy stale rows.

3. **Database-Level Invariants & Partial Unique Indexes**:
   Invariants are enforced by PostgreSQL at the storage engine level, preventing bugs in application code from violating business rules:
   - `idx_seat_one_live_booking`: `ON booking_seats(show_seat_id) WHERE released_at IS NULL` guarantees that no seat can ever have more than one active booking.
   - `idx_one_live_waitlist_entry`: `ON waitlist(show_id, category_id, user_id) WHERE status IN ('waiting', 'offered')` prevents duplicate active queue positions.
   - `CHECK` constraints on `show_seats` bind `hold_expires_at`, `held_by`, and `hold_kind` strictly to `status = 'held'`.

4. **FIFO Waitlist Auto-Assignment**:
   When a category sells out, customers queue in a strictly ordered first-in, first-out (FIFO) waitlist. When a booking is cancelled, the transaction locks the queue head (`FOR UPDATE`), grants a time-limited exclusive offer token, and emails a claim link. If the offer window elapses unclaimed, the seat automatically cascades to the next queued customer.

5. **PostgreSQL Advisory-Lock Distributed Sweeper**:
   Background cleanup tasks across multi-instance deployments coordinate using PostgreSQL session advisory locks:
   ```sql
   SELECT pg_try_advisory_lock(847291038) AS locked;
   ```
   If another instance is currently sweeping lapsed holds and expired offers, the lock attempt fails fast and the instance skips the tick. Only one sweeper runs cluster-wide, eliminating redundant sweeps and duplicate notification emails without requiring an external distributed coordinator.

6. **Redis Pub/Sub Real-time Fan-out**:
   Seat holds remain in PostgreSQL as the single transactional source of truth. Redis is used for inter-instance broadcast (`seatwise:show:${showId}`) and distributed IP rate-limiting (`rate-limit-redis`). State transitions published on one instance are immediately broadcast across all connected server instances to active Server-Sent Events (SSE) browser subscribers. If Redis is absent, the system falls back to in-memory local dispatch.

---

## Concurrency & Load Test Benchmarks

Contention benchmarks executed via k6 ramp to **200 concurrent virtual users (VUs)** aggressively competing for a 20-seat auditorium alongside continuous browsing and checkout traffic:

| Architecture | Throughput | Total Requests | p50 Latency | p95 Latency | Double Bookings | Contention Safety |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SQLite (WAL + `BEGIN IMMEDIATE`)** | **4,259.6 req/s** | 106,656 | 1.23 ms | 3.16 ms | **0** | PASS (0 `SQLITE_BUSY`) |
| **PostgreSQL 15 (Single Instance)** | **4,083.3 req/s** | 102,532 | 2.67 ms | 8.17 ms | **0** | PASS (Zero deadlocks) |
| **Two API Replicas + Redis + Nginx** | **4,171.8 req/s** | 104,563 | 1.62 ms | 6.60 ms | **0** | PASS (0 race conditions) |

*Full load-test reports and k6 metrics are available in [`loadtest/results/`](loadtest/results/).*

---

## Quick-Start with Docker Compose

Run the entire distributed stack (PostgreSQL, Redis, Express API, and Nginx Web) with one command:

```bash
# Clone the repository
git clone https://github.com/devrajsinghal35/SeatWise.git
cd SeatWise

# Start all services
docker compose up --build
```

- **Web Frontend**: <http://localhost:5173> or <http://localhost:80>
- **Backend API**: <http://localhost:4000>
- **Interactive OpenAPI 3 / Swagger Docs**: <http://localhost:4000/api/docs>

### Multi-Instance Load Balanced Profile

To test two independent API instances running behind a round-robin Nginx reverse proxy with Redis pub/sub synchronization:

```bash
docker compose --profile loadbalanced up --build
```

---

## Local Development Setup

### Prerequisites
- Node.js 20 or newer (`node -v`)
- PostgreSQL 15 (`createdb seatwise && createdb seatwise_test`)
- Redis 7 (optional for single-instance, required for multi-instance pub/sub)

### 1. Server Setup
```bash
cd server
cp .env.example .env
npm install
npm run seed     # Migrates schema and seeds venues, events, showings, and demo accounts
npm run dev      # Starts API on http://localhost:4000
```

### 2. Frontend Setup
```bash
cd web
cp .env.example .env
npm install
npm run dev      # Starts Vite dev server on http://localhost:5173
```

---

## Demo Accounts

All pre-seeded demo accounts use the password `Password123`:

| Email | Role | Permissions |
| :--- | :--- | :--- |
| `admin@seatwise.test` | Admin | Create physical venues, configure rows, and seat categories |
| `organiser@seatwise.test` | Organiser | Schedule events, assign showings, inspect revenue & occupancy |
| `priya@example.com` | Customer | Reserve seat holds, complete checkouts, join waitlists |
| `rahul@example.com` | Customer | Pre-seeded holder of sold-out showings for waitlist testing |

---

## Testing

```bash
# Run server test suite (Postgres + Redis integration, concurrency, CAS locks, waitlist cascades)
cd server && npm test

# Run frontend test suite (Vitest + React Testing Library + axe-core a11y audit)
cd web && npm test

# Run frontend Playwright end-to-end test (Browse -> Hold -> Checkout)
cd web && npm run test:e2e

# Run frontend ESLint and production build
cd web && npm run lint && npm run build
```

---

## Interactive API Documentation

Interactive Swagger UI documentation is served live at:
```
http://localhost:4000/api/docs
```
Raw OpenAPI 3.0 JSON specification is available at `/api/docs.json`. Every endpoint includes request validation schemas (Zod-derived), authentication parameters, idempotency headers, and error models.

---

## Production Deployment

### Render Deployment
This repository carries a [`render.yaml`](render.yaml) Blueprint configured with managed PostgreSQL (`seatwise-db`), managed Redis KeyStore (`seatwise-redis`), and automated web builds:
- **API URL**: `https://seatwise-api.onrender.com` *(placeholder for production)*
- **Web URL**: `https://seatwise-web.onrender.com` *(placeholder for production)*

---

## Limitations & Not Implemented

1. **Payment Gateway Integration**:
   Payment processing (Stripe / Razorpay / Adyen) is intentionally simulated. Checkouts generate confirmed tickets and QR passes immediately upon guest detail verification, rather than collecting live payment tokens.
2. **Real-world Payment Refunds**:
   Booking cancellations release reserved seats and cascade offers to the waitlist immediately, but do not issue automated merchant credit card refunds.
3. **Email Delivery Provider**:
   Unless `BREVO_API_KEY` or SMTP environment variables are configured, outgoing tickets and waitlist offers are written to `server/outbox/` as standard RFC 822 `.eml` files.
