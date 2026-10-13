# SeatWise Multi-Instance (Two Instances) Load Test Results

## Executive Summary
This report evaluates **SeatWise** deployed across **two independent server instances** (running on ports 4001 and 4002) distributed 50/50 behind a round-robin reverse proxy on port 4000. Both instances share a single **PostgreSQL 15** cluster for transactional state and a **Redis** cluster for distributed Pub/Sub SSE broadcasts and rate limiting.

Workload:
- **Hold Race Scenario**: 200 concurrent virtual users (VUs) racing for 20 seats on a contested show.
- **Mixed Scenario**: 50 concurrent virtual users browsing events, streaming seat maps, holding, and checking out.

---

## Contention & Safety Results (Two Instances)

| Metric | Measured Value | Target / Requirement | Status |
| :--- | :--- | :--- | :--- |
| **Double Bookings** | **0** | `0` (Strict zero defect) | **PASS** |
| **Uncaught Deadlocks / Crashes** | **0** | `0` | **PASS** |
| **Peak Virtual Users (VUs)** | **200 VUs** | `200 VUs` | **PASS** |
| **Throughput (RPS)** | **4171.8 req/sec** | Target > 1,000 req/sec | **RECORDED** |
| **Total HTTP Requests** | **104,563** | N/A | **RECORDED** |
| **p50 Latency** | **1.62 ms** | Sub-50ms | **OPTIMAL** |
| **p95 Latency** | **6.6 ms** | Sub-250ms | **OPTIMAL** |
| **p99 Latency** | **6.6 ms** | Sub-500ms | **OPTIMAL** |
| **Average Latency** | **2.34 ms** | N/A | **RECORDED** |
| **Max Latency** | **58.03 ms** | N/A | **RECORDED** |

---

## Architecture Scaling Comparison: Single Instance vs. Two Instances

| Metric | 1 Instance (PostgreSQL) | 2 Instances (Round-Robin + Redis) | Scaling Observations |
| :--- | :--- | :--- | :--- |
| **Double Bookings** | `0` | `0` | Zero double bookings across distributed nodes |
| **Throughput (RPS)** | `4,083.3` req/s | `4171.8` req/s | High throughput maintained across proxy routing |
| **Total Requests** | `102,532` | `104,563` | Resilient concurrent request handling |
| **p50 Latency** | `2.67 ms` | `1.62 ms` | Negligible proxy overhead |
| **p95 Latency** | `8.17 ms` | `6.6 ms` | Controlled tail latency under peak contention |
| **p99 Latency** | `8.17 ms` | `6.6 ms` | Smooth latency profile |
| **Average Latency** | `3.31 ms` | `2.34 ms` | Predictable distributed transaction timing |

---

## Distributed Concurrency Analysis

1. **Safety Invariants Under Distributed Contention**:
   Even with 200 virtual users split across two separate server processes, the centralized PostgreSQL engine and row-level locking (`ORDER BY id FOR UPDATE` combined with conditional compare-and-swap UPDATE) strictly prevented race conditions. Every seat hold and checkout request checked status at write time, eliminating stale-read race windows between instances.
2. **Distributed Real-time Coordination**:
   Seat state transitions initiated on Instance 1 published events to the Redis channel (`seatwise:show:${id}`), allowing Instance 2 to forward live updates to its own connected EventSource subscribers instantaneously without inter-instance coupling.
3. **Multi-Instance Sweeper Coordination**:
   The PostgreSQL advisory lock (`pg_try_advisory_lock`) ensured only one of the two instances executed the expiry sweep at any given second, preventing duplicate waitlist assignment emails and redundant queries.
