# SeatWise SQLite Concurrency & Load Baseline

## Executive Summary
This report establishes the performance and concurrency baseline of **SeatWise** running on **SQLite (WAL mode with `BEGIN IMMEDIATE`)** under high contention.

The workload ramps to **200 concurrent virtual users (VUs)** racing for seats across two scenarios:
1. **Hold Race Scenario**: 200 virtual users aggressively contesting a 20-seat show.
2. **Mixed Scenario**: 50 virtual users executing the full customer journey (browsing catalogue, loading seat maps, acquiring holds, and checking out).

---

## Contention & Safety Baseline Results

| Metric | Measured Value | Target / Requirement | Status |
| :--- | :--- | :--- | :--- |
| **Double Bookings** | **0** | `0` (Never allowed) | **PASS** |
| **SQLITE_BUSY Errors** | **0** | `0` | **PASS** |
| **Peak Virtual Users (VUs)** | **200 VUs** | `200 VUs` | **PASS** |
| **Throughput (RPS)** | **4259.62 req/sec** | Baseline recorded | **RECORDED** |
| **Total HTTP Requests** | **106,656** | N/A | **RECORDED** |
| **p50 Latency** | **1.23 ms** | Sub-50ms | **OPTIMAL** |
| **p95 Latency** | **3.16 ms** | Sub-250ms | **OPTIMAL** |
| **p99 Latency** | **3.16 ms** | Sub-500ms | **OPTIMAL** |
| **Average Latency** | **1.43 ms** | N/A | **RECORDED** |
| **Max Latency** | **12.94 ms** | N/A | **RECORDED** |

---

## Detailed Load Test Breakdown

### 1. Concurrency Safety & Invariants
- **Double Bookings Detected**: `0`
  - Invariant checked: `SELECT show_seat_id, COUNT(*) FROM booking_seats WHERE released_at IS NULL GROUP BY show_seat_id HAVING count > 1`.
  - Result: **0 violations**. The `idx_seat_one_live_booking` unique partial index and `BEGIN IMMEDIATE` transactions guaranteed serializable seat claims without allowing duplicate holders or ticket overlap.
- **SQLITE_BUSY Errors**: `0`
  - Result: **0 busy lock exceptions**. WAL mode (`journal_mode = WAL`) combined with `busy_timeout = 5000` and immediate write lock acquisition prevented writer lock escalation deadlocks.
- **Corrupt Seat Rows**: `0` (booked seats with dangling `held_by` pointers).

### 2. Contention Dynamics
- **Total Seat Holds Granted**: `546`
- **Total Hold Conflicts (HTTP 409)**: `86,652`
- **Total Bookings Created**: `50`
- **Final Seat States**:
  - Booked Seats: `50`
  - Held Seats: `20`
  - Available Seats: `0`

### 3. Latency Distribution
- **p50**: `1.23 ms`
- **p95**: `3.16 ms`
- **p99**: `3.16 ms`
- **Average**: `1.43 ms`
- **Peak**: `12.94 ms`

---

## Technical Observations & Architecture Notes

1. **Why SQLite Did Not Deadlock**:
   - In naive implementations, concurrent transactions acquire read locks first and then upgrade to write locks during an `UPDATE` statement. When two concurrent readers attempt to upgrade simultaneously, a mutual deadlock occurs, leading to `SQLITE_BUSY`.
   - SeatWise avoids this by wrapping all mutating operations in `writeTxn` which executes `db.transaction(fn).immediate()`. Because `BEGIN IMMEDIATE` takes the write lock before executing the first query, competing write transactions are cleanly queued at the SQLite engine level.
2. **Read Concurrency via WAL Mode**:
   - During peak contention (200 VUs repeatedly hitting the seat map and holding seats), reader queries (`GET /api/shows/:id/seats`, `GET /api/events`) never block writer transactions and writers never block readers.
3. **Contention Rejections (409 Conflict)**:
   - When 200 users compete for 20 seats, HTTP 409 responses represent correct, intentional business behavior: the compare-and-swap update (`UPDATE show_seats SET status = 'held' ... WHERE status = 'available'`) returns `changes = 0`, rolling back the transaction and alerting the user that the seat was taken.
