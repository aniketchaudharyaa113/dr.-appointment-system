# MediBook — High-Level Design (HLD) & Low-Level Design (LLD)

## 1. Executive Summary

**MediBook** is an enterprise-grade, distributed doctor appointment and clinic management platform engineered for high concurrency, zero double-booking guarantees, sub-50ms slot reads, resilient transactional messaging, and seamless multi-instance horizontal scalability.

The system incorporates:
- **Nginx Reverse Proxy & Load Balancer** with strict rate limiting, security headers, and WebSocket load balancing across multiple API replicas.
- **Node.js + Express + TypeScript API Cluster** running multiple stateless replicas with Zod schema validation, rotating refresh tokens, and Pino structured logging.
- **PostgreSQL 16 Engine** with ACID transactions, partial unique indexes for rebookable slots, `pg_trgm` fuzzy symptom search, and automated schema migrations via `node-pg-migrate`.
- **Redis 7 Caching & Coordination Tier** with version-stamped keys, query normalization, stampede single-flight locks, 5-minute slot holds, 24-hour idempotency keys, and Socket.IO cluster pub/sub adapter.
- **Transactional Outbox & BullMQ Worker Architecture** ensuring zero message loss across appointment bookings, cancellations, rescheduling, patient notifications, scheduled reminder jobs, and SMTP emails via Mailpit.
- **Enterprise Observability** featuring Prometheus metrics collection (`/metrics`), Grafana dashboard provisioning, and Kubernetes/Docker health probes (`/health/live`, `/health/ready`).

---

## 2. High-Level Architecture (HLD)

### 2.1 Multi-Tier Architecture Diagram

```
                               ┌─────────────────────────┐
                               │   Patients & Doctors    │
                               │     (Web Clients)       │
                               └────────────┬────────────┘
                                            │ HTTP/S & WebSockets
                                            ▼
                    ┌──────────────────────────────────────────────┐
                    │               NGINX REVERSE PROXY            │
                    │  - Rate Limiting (20r/s API, 5r/s Auth)      │
                    │  - Strict Location Precedence (^~ /api/auth/)│
                    │  - Security Headers (CSP, HSTS, X-Frame)     │
                    │  - WebSocket Upgrade & Connection Pooling    │
                    │  - Upstream Load Balancing (ip_hash)         │
                    └───────┬──────────────────────────────┬───────┘
                            │                              │
        Static Assets (/)   │                              │ /api/ & /socket.io/
                            ▼                              ▼
                 ┌────────────────────┐      ┌─────────────────────────────┐
                 │ Multi-Stage SPA    │      │ Upstream: backend_cluster   │
                 │ Frontend (Vite)    │      │ ├── Backend Replica 1 (5000)│
                 │ (Nginx static)     │      │ └── Backend Replica 2 (5000)│
                 └────────────────────┘      └──────────────┬──────────────┘
                                                            │
                 ┌──────────────────────────────────────────┼──────────────────────────────────────────┐
                 │                                          │                                          │
                 ▼                                          ▼                                          ▼
    ┌─────────────────────────┐                ┌─────────────────────────┐                ┌─────────────────────────┐
    │      REDIS 7 TIER       │                │    TRANSACTIONAL OUTBOX │                │  POSTGRESQL 16 (ACID)   │
    │  - Versioned Caching    │                │    RELAY (SKIP LOCKED)  │                │  - Users / Doctors      │
    │  - Slot Hold Locks (5m) │                │            │            │                │  - Appointments (Status)│
    │  - Idempotency Store    │                │            ▼            │                │  - Prescriptions + Vers │
    │  - Socket.IO Pub/Sub    │                │    BULLMQ JOB QUEUES    │                │  - Outbox Events Table  │
    │  - Stampede Mutex Lock  │                │    (Separate Worker)    │                │  - Waitlist Entries     │
    └────────────▲────────────┘                │  - Notifications Queue  │                │  - Refresh Tokens       │
                 │                             │  - Email Queue (SMTP)   │                │  - Partial Unique Index │
                 │ Socket Adapter Pub/Sub      │  - Reminders (Delayed)  │                │  - Audit Logs           │
                 │                             │  - Audit Trail Queue    │                └─────────────────────────┘
                 │                             └────────────┬────────────┘
                 │                                          │
                 └──────────────────────────────────────────┘
                                                            │
                                                            ▼
                                               ┌─────────────────────────┐
                                               │ MAILPIT SMTP DEV SERVER │
                                               │ (Port 1025 SMTP / 8025) │
                                               └─────────────────────────┘
                                                            │
                    ┌───────────────────────────────────────┴───────────────────────────────────────┐
                    │                                                                               │
                    ▼                                                                               ▼
      ┌───────────────────────────┐                                                   ┌───────────────────────────┐
      │     PROMETHEUS ENGINE     │ ◄─── Scrapes /metrics (backend-1, backend-2) ──── │      GRAFANA DASHBOARDS   │
      │ (docker-compose.observ)   │                                                   │ (Pre-provisioned Metrics) │
      └───────────────────────────┘                                                   └───────────────────────────┘
```

### 2.2 System Components & Responsibilities

| Tier | Component | Technology | Primary Responsibility |
|---|---|---|---|
| **Edge / Proxy** | Reverse Proxy & Ingress | Nginx 1.25 Alpine | SSL termination, DDoS protection, rate limiting (`limit_req`), strict location routing, WebSocket tunneling, multi-stage static SPA serving |
| **Presentation** | Web Application | React 18 + Vite + Tailwind CSS | Responsive patient booking portal, slot hold countdown timer, waitlist modal, doctor dashboard, earnings charts, admin verification center |
| **API Replicas** | API Gateway & Cluster | Node.js + Express + TypeScript | Zod validation, rotating refresh tokens, rate limiting, wall-clock datetime math, Socket.IO real-time hub with Redis adapter |
| **Worker Process**| Background Job Processing | BullMQ + Node.js | Independent worker process consuming outbox events: in-app notifications, HTML emails via Nodemailer/Mailpit, delayed reminders, audit logging |
| **Outbox Relay** | Transactional Publisher | Node.js Worker Service | Polls PostgreSQL `outbox_events` via `SELECT ... FOR UPDATE SKIP LOCKED`, dispatches to BullMQ with idempotent job IDs, marks processed |
| **Coordination** | Redis Caching & Locks | Redis 7 Alpine | Version-stamped cache, 5-minute slot holds, 24-hour idempotency keys, single-flight stampede protection, Socket.IO adapter pub/sub |
| **Persistence** | Relational Database | PostgreSQL 16 Alpine | ACID transactions, partial unique indexes, row-level locks (`FOR UPDATE`), schema migrations via `node-pg-migrate`, `pg_trgm` symptom matching |
| **Observability** | Metrics & Logging | Prometheus + Grafana + Pino | Request ID tracking (`X-Request-Id`), JSON structured logging, HTTP latency histograms, booking counters, queue depth gauges |

---

## 3. Low-Level Design (LLD)

### 3.1 Concurrency & Zero Double-Booking Sequence

A foundational invariant of MediBook is that **no two concurrent requests can ever book the same doctor slot**, while **cancelled slots can be immediately rebooked**, and **booking reference tokens (`MB-YYYYMMDD-XXX`) never collide**.

```
Client 1 (Patient A)        Client 2 (Patient B)           Backend API            PostgreSQL (ACID)            Redis / WebSockets
       │                            │                            │                         │                           │
       │─── POST /appointments ────>│                            │                         │                           │
       │    (Dr. Roy, 10:00 AM)     │                            │                         │                           │
       │                            │─── POST /appointments ────>│                         │                           │
       │                            │    (Dr. Roy, 10:00 AM)     │                         │                           │
       │                            │                            │                         │                           │
       │                            │                            │─── BEGIN TRANSACTION ──>│                           │
       │                            │                            │─── Verify Slot Hold ───>│ [Redis hold matches user] │
       │                            │                            │─── Validate Grid Bounds>│ [15-min grid check]       │
       │                            │                            │─── ROW LOCK Counter ───>│ (ON CONFLICT DO UPDATE)   │
       │                            │                            │    Token seq: 001       │                           │
       │                            │                            │─── INSERT Appointment ─>│ [Acquires (doc, time) lock]│
       │                            │                            │─── INSERT Outbox Event ─│ (Status = PENDING)        │
       │                            │                            │─── COMMIT ─────────────>│                           │
       │                            │                            │                         │                           │
       │                            │                            │─── Invalidate Version ─────────────────────────────>│ INCR doctors:list:version
       │                            │                            │─── Broadcast Slot Booked ──────────────────────────>│ emit("slot-booked")
       │                            │                            │─── Release Slot Hold ──────────────────────────────>│ DEL hold:doc1:time
       │<── 201 Created (MB-..-001) ─│                           │                                                     │
       │                            │                            │                                                     │
       │                            │                            │─── BEGIN TRANSACTION ──>│                           │
       │                            │                            │─── INSERT Appointment ─>│ 💥 Partial Unique Viol    │
       │                            │                            │    (doc1, 10:00 exists  │    ON (doc, time) WHERE   │
       │                            │                            │     as CONFIRMED)       │    status IN ('PENDING',  │
       │                            │                            │                         │               'CONFIRMED')│
       │                            │                            │─── ROLLBACK ───────────>│                           │
       │                            │<── 409 Conflict ───────────│                         │                           │
       │                            │    ("Slot already booked") │                         │                           │
```

### 3.2 Partial Unique Index & Slot Rebooking
The database schema drops unconditional unique constraints and establishes a partial index:
```sql
CREATE UNIQUE INDEX idx_appointments_active_slot
ON appointments (doctor_id, slot_time)
WHERE status IN ('PENDING', 'CONFIRMED');
```
When an appointment is cancelled, its status transitions to `CANCELLED`, automatically freeing the `(doctor_id, slot_time)` tuple for immediate rebooking without deleting audit history.

### 3.3 Slot Hold Engine (5-Minute Mutex with Real-Time Countdown)
To prevent checkout races:
1. Patient triggers `POST /appointments/hold` with `{ doctorId, slotTime }`.
2. Backend runs atomic Redis lock:
   ```typescript
   const acquired = await redis.set(`hold:${doctorId}:${slotTime}`, userId, "EX", 300, "NX");
   ```
3. If acquired, WebSocket room `doctor:<doctorId>` receives `slot-held` event, rendering a visual lock and active countdown timer on all connected browsers.
4. If booking completes or is cancelled, the hold is released immediately. If abandoned, the 300-second Redis TTL expires and emits `slot-hold-released`.

### 3.4 Idempotency Engine
1. All appointment mutation requests (`POST /appointments`) provide an `Idempotency-Key` header (e.g. UUID v4 generated by the client).
2. Backend checks `idempotency:<key>` in Redis:
   - **Found**: Returns the cached status code and payload directly without hitting the database.
   - **Not Found**: Executes the business transaction, caches the response with 24-hour TTL, and returns to client.

### 3.5 Transactional Outbox Pattern & Resilient Messaging
Direct message enqueuing during HTTP handlers risks phantom jobs if database commits fail, or lost events if the message broker drops connections. MediBook solves this using the **Transactional Outbox Pattern**:
1. Business handlers insert the domain entity (`appointments`, `prescriptions`, `doctor_leaves`) and an `outbox_events` row within the **same PostgreSQL transaction**:
   ```sql
   INSERT INTO outbox_events (id, event_type, payload, status)
   VALUES ($1, 'APPOINTMENT_BOOKED', $2, 'PENDING');
   ```
2. The Outbox Relay continuously polls unhandled events:
   ```sql
   SELECT id, event_type, payload FROM outbox_events
   WHERE status = 'PENDING'
   ORDER BY created_at ASC
   LIMIT 50
   FOR UPDATE SKIP LOCKED;
   ```
3. Events are published to their designated BullMQ queue (`notifications`, `email`, `reminders`, `audit`) using `event.id` as the BullMQ `jobId`. This guarantees **strict idempotency** across retries.
4. Upon successful enqueue, the relay updates status to `PROCESSED`. If the message queue is temporarily unreachable, events remain safely stored in PostgreSQL and retry automatically when connectivity restores.

```
[ HTTP Transaction ] ──► BEGIN ──► INSERT appointment ──► INSERT outbox_events ──► COMMIT
                                                                 │
                                                                 ▼
[ Outbox Relay ] ◄── SELECT FOR UPDATE SKIP LOCKED (status = 'PENDING')
       │
       ├──► BullMQ (jobId = outbox.id) ──► UPDATE outbox_events SET status = 'PROCESSED'
       │
       ▼
[ Dedicated Worker Process ]
       ├──► Notifications Queue ──► Inserts in-app notification & emits to user room
       ├──► Email Queue         ──► Renders HTML template & sends via Nodemailer/Mailpit
       ├──► Reminders Queue     ──► Schedules delayed jobs for 24h and 1h before slot
       └──► Audit Queue         ──► Logs to audit_logs table
```

### 3.6 Cache Hardening & Stampede Protection
1. **Version-Stamped Keys**:
   - Cache keys incorporate a global entity version: `doctors:list:v{n}:{canonicalFilters}`.
   - Mutations increment the version via Redis `INCR doctors:list:version`, instantaneously invalidating all downstream queries in $O(1)$ without slow `KEYS` traversals.
2. **Query Normalization**:
   - Search parameters are trimmed, lowercased, and sorted alphabetically.
   - Geographic coordinates are rounded to 2 decimal places (~1.1 km precision) to prevent unbounded key explosion.
3. **Stampede Mutex Lock & Jitter**:
   - On a cache miss, the backend acquires a single-flight mutex (`SET lock:<key> 1 EX 5 NX`).
   - The lock winner fetches from PostgreSQL and repopulates Redis with randomized TTL jitter ($\pm 10\%$).
   - Concurrent readers wait 50ms and retry, preventing database thundering herds.

### 3.7 Patient Waitlist & Cascading Claim Windows
1. When a doctor's schedule is fully booked, patients can join a waitlist (`POST /appointments/waitlist`).
2. When an existing appointment is cancelled or invalidated:
   - System checks `appointment_waitlist` for the earliest pending entry.
   - An automated 5-minute Redis hold is placed on behalf of the waitlisted patient.
   - A priority notification and email are dispatched granting a 10-minute claim window.
   - If unclaimed upon expiry, the slot cascades to the next patient in line.

---

## 4. Database Schema Design (ERD)

```
users (id UUID PK, email UNIQUE, password, name, phone, role, created_at)
  │
  ├── 1:N ── refresh_tokens (id UUID, user_id FK, token_hash, expires_at, revoked_at)
  │
  ├── 1:1 ── doctors (id UUID PK, user_id FK, specialty, qualifications, experience_years,
  │                   clinic_name, clinic_address, clinic_lat, clinic_lng,
  │                   consultation_fee, slot_duration_minutes, license_number, is_verified)
  │             │
  │             ├── 1:N ── availability (id, doctor_id, day_of_week, start_time, end_time, slot_duration)
  │             ├── 1:N ── doctor_leaves (id, doctor_id, leave_date, reason)
  │             ├── 1:N ── doctor_daily_counters (doctor_id, booking_date, last_seq)
  │             │
  │             └── 1:N ── appointments (id UUID PK, patient_id FK, doctor_id FK, slot_time, status, booking_ref)
  │                           │   [PARTIAL UNIQUE INDEX on (doctor_id, slot_time) WHERE status IN ('PENDING', 'CONFIRMED')]
  │                           │
  │                           ├── 1:1 ── prescriptions (id UUID, appointment_id FK, doctor_id, patient_id, diagnosis, medicines JSONB, notes)
  │                           │             │
  │                           │             └── 1:N ── prescription_versions (id, prescription_id FK, version_number, snapshot JSONB)
  │                           │
  │                           ├── 1:1 ── reviews (id UUID, appointment_id UNIQUE FK, doctor_id FK, patient_id FK, rating, comment)
  │                           │
  │                           └── 1:N ── appointment_waitlist (id UUID, doctor_id FK, patient_id FK, slot_date, slot_time, status, claim_expires_at)
  │
  ├── 1:N ── notifications (id UUID, user_id FK, type, title, message, link, is_read, created_at)
  ├── 1:N ── audit_logs (id UUID, actor_id, actor_role, action, target_id, details JSONB, created_at)
  └── 1:N ── outbox_events (id UUID PK, event_type, payload JSONB, status, retry_count, created_at, processed_at)
```

---

## 5. Security & Ingress Design

### 5.1 Nginx Ingress Security
- **Strict Location Precedence**: `location ^~ /api/auth/` ensures strict rate limiting (5 req/sec with burst 10) takes priority over regular API rules.
- **Security Headers**: Content Security Policy (CSP), HTTP Strict Transport Security (HSTS), X-Frame-Options (`DENY`), X-Content-Type-Options (`nosniff`).
- **Connection Limiting**: `limit_conn addr 20` prevents connection starvation attacks.
- **Internal Route Protection**: `/metrics` is blocked from public internet access and accessible only to Prometheus on the internal Docker network.

### 5.2 Token Rotation & Authentication
- **Access Tokens**: Short-lived JWTs (15-minute expiration) containing user ID and role.
- **Refresh Tokens**: Long-lived (7-day expiration), stored in `httpOnly`, `secure`, `sameSite=strict` cookies.
- **Database Revocation**: Stored as SHA-256 hashes in PostgreSQL; refreshed tokens automatically rotate, and logout immediately revokes the active session.

### 5.3 Socket.IO Security & Room Scoping
- Handshake middleware verifies the Bearer JWT token before admitting WebSocket connections.
- Connections automatically join isolated rooms:
  - `user:<userId>` for private notifications and prescription alerts.
  - `role:<role>` for administrative platform broadcasts.
  - `doctor:<doctorId>` joined explicitly via `watch-doctor` and left via `unwatch-doctor` for live slot availability feeds.
- All legacy global `io.emit()` calls are eliminated; messages target specific rooms exclusively.

---

## 6. Observability & Operations

### 6.1 Prometheus Metrics Catalog
Exported at `/metrics` using `prom-client`:
- `http_request_duration_seconds`: Histogram measuring HTTP request duration across route, method, and status codes.
- `medibook_booking_total`: Counter tracking booking attempts labelled by outcome (`success`, `conflict`, `invalid_slot`, `error`).
- `medibook_cache_hits_total` / `medibook_cache_misses_total`: Counters monitoring cache efficiency.
- `medibook_socket_connections_active`: Gauge tracking real-time connected WebSocket clients.
- `medibook_queue_depth` / `medibook_queue_failed_jobs`: Gauges monitoring BullMQ queue health.

### 6.2 Health Probes
- `/health/live`: Lightweight liveness probe returning HTTP 200 indicating server event loop responsiveness.
- `/health/ready`: Deep readiness probe validating active connections to PostgreSQL, Redis, and BullMQ queues, returning HTTP 503 if any dependency degrades.
