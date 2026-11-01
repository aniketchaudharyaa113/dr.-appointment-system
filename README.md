# MediBook — Enterprise Doctor Appointment & Clinic Management Platform

A distributed, production-grade platform for doctor appointments and clinic management built with **Node.js, Express, TypeScript, PostgreSQL 16, Redis 7, Socket.IO, React 18, Vite, Nginx, and Docker Compose**.

Engineered with comprehensive **System Design (HLD & LLD)**, **Zero Double-Booking Guarantees**, **Transactional Outbox Messaging**, **BullMQ Workers**, **Redis Cache Hardening & Mutex Locks**, **Horizontal Scaling across API Replicas**, and **Full Observability (Prometheus & Grafana)**.

---

## Table of Contents

- [Features](#features)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start with Docker Compose](#quick-start-with-docker-compose)
- [Running Observability (Prometheus & Grafana)](#running-observability-prometheus--grafana)
- [Manual Local Setup](#manual-local-setup)
- [API Overview](#api-overview)
- [Core Invariants & Design Guarantees](#core-invariants--design-guarantees)
- [Testing & Quality Assurance](#testing--quality-assurance)

---

## Features

### 🧑‍⚕️ Patient
- **Symptom-Based Search**: Natural language & trigram similarity (`pg_trgm`) matching plain-language symptoms to specialist doctors with score rankings.
- **Next Available Slot Badge**: Real-time display of each doctor's earliest bookable slot, cached with version-stamped keys.
- **5-Minute Slot Hold with Live Countdown**: Locks a slot for 5 minutes (`POST /appointments/hold`) while filling details, preventing cart-jacking and broadcasting real-time hold states to other users.
- **Idempotency Protection**: Client-provided `Idempotency-Key` headers guarantee no accidental duplicate bookings or charges.
- **Automated Waitlist**: When all slots are full, patients can join a FIFO waitlist. If an appointment is cancelled, a 10-minute claim window with an automatic hold is granted to the next patient in line.
- **Atomic Reschedule**: Atomically cancel and rebook appointments (`PATCH /appointments/:id/reschedule`) in a single database transaction.
- **Digital Prescriptions**: View complete prescription history with full version tracking (`prescription_versions`) for auditability.
- **Verified Reviews**: One review per completed appointment verified by foreign key constraint (`appointment_id UNIQUE`).

### 🩺 Doctor
- **Day-View Schedule**: View hourly appointments with patient details and quick status actions.
- **Mark No-Show**: Mark absent patients as `NO_SHOW` to free clinic resources and update audit histories.
- **Revenue Analytics**: Aggregated weekly and monthly earnings dashboard computed directly from completed consultations.
- **Schedule Reduction with Cascade Cancellation**: Reducing hours or taking emergency leaves safely identifies affected confirmed bookings, dry-runs impact via `?dryRun=true`, and cascades cancellations with patient notifications in a single transaction.
- **Digital Rx Generator**: Issue digital prescriptions restricted to `COMPLETED` visits, storing version snapshots on every edit.

### 🛡️ Admin
- **Doctor Verification & Credentials Review**: Verify medical licenses with real-time approved/rejected notifications.
- **Platform Analytics**: Total bookings, verified doctors, patient volume, and cancellation metrics cached via versioned Redis keys.
- **Queue Dashboard (Bull-Board)**: Web-based queue management interface mounted at `/admin/queues` for monitoring job states, retries, and dead-letter queues.
- **Prescription Read Auditing**: Real-time audit log tracking every user who views or downloads a patient prescription.

---

## System Architecture

> For in-depth architectural specifications, sequence diagrams, and capacity estimations, see [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md).

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

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Ingress & Reverse Proxy** | Nginx 1.25 Alpine | SSL termination, upstream `ip_hash` balancing across 2 API replicas, strict auth rate limits, static SPA delivery |
| **Frontend** | React 18 + Vite + Tailwind CSS | Component architecture, slot hold timer, waitlist modal, earnings charts, Lucide icons |
| **API Backend** | Node.js + Express + TypeScript | Zod validation middleware, rotating refresh tokens, wall-clock datetime math, Pino structured logging |
| **Worker Process** | Node.js + BullMQ | Dedicated worker consuming transactional outbox events: in-app notifications, emails, 24h/1h delayed reminders, audit trails |
| **Real-time Hub** | Socket.IO + Redis Adapter | Room-scoped real-time events (`user:<id>`, `doctor:<id>`), cross-replica event synchronization |
| **Database** | PostgreSQL 16 Alpine | Strict ACID transactions, partial unique index, row-level locks, `pg_trgm` fuzzy similarity search, `node-pg-migrate` migrations |
| **Caching & Mutex** | Redis 7 Alpine | Version-stamped cache keys, single-flight stampede protection, 5-minute slot holds, 24-hour idempotency store |
| **Email Server** | Nodemailer + Mailpit | HTML responsive email templates, local SMTP server (port 1025) and inspection UI (port 8025) |
| **Observability** | Prometheus + Grafana | HTTP latency histograms, booking counters, queue metrics, cache hit/miss ratio, health probes (`/health/live`, `/health/ready`) |

---

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── cache/             # Versioned Redis client, stampede lock, normalization
│   │   ├── queue/             # BullMQ queue definitions and outbox relay
│   │   ├── worker.ts          # Dedicated background worker entrypoint
│   │   ├── controllers/       # Auth, appointments, doctors, prescriptions, waitlist, admin
│   │   ├── routes/            # Express routes and bull-board queue dashboard
│   │   ├── middleware/        # Zod validation, JWT auth, rate limiters, request ID
│   │   ├── db/                # Pool, migrations (node-pg-migrate 001 to 008), seed script
│   │   ├── sockets/           # Socket.IO setup, Redis adapter, room join/leave handlers
│   │   ├── utils/             # Naive wall-clock datetime math, logger (Pino), metrics
│   │   └── index.ts           # API entrypoint
│   ├── tests/                 # Vitest integration test suites (concurrency, outbox, etc.)
│   ├── Dockerfile
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/        # Hold countdown, waitlist modal, prescription viewer, earnings
│   │   ├── pages/             # Doctor day-view, search, booking, admin verification
│   │   ├── context/           # AuthContext with token rotation
│   │   └── lib/               # API client with Idempotency-Key generation, sockets
│   ├── Dockerfile             # Multi-stage production build
│   └── package.json
│
├── nginx/
│   ├── nginx.conf             # Production Nginx configuration
│   └── conf.d/default.conf    # Upstream load balancer, strict rate limits, security headers
│
├── monitoring/
│   ├── prometheus/            # Prometheus scrape configuration
│   └── grafana/               # Pre-provisioned Grafana dashboards and datasource configs
│
├── load/
│   └── booking.js             # k6 concurrency and booking load test script
│
├── docs/
│   ├── SYSTEM_DESIGN.md       # Complete HLD & LLD design document
│   └── LOAD_TEST.md           # k6 benchmark results and latency metrics
│
├── docker-compose.yml         # Main orchestration (Nginx, Frontend, 2x Backend, Worker, DB, Redis, Mailpit)
└── docker-compose.observability.yml # Monitoring add-on (Prometheus + Grafana)
```

---

## Quick Start with Docker Compose

Start the entire platform (Nginx, Frontend, 2 API Replicas, Worker, PostgreSQL, Redis, Mailpit) with a single command:

```bash
docker compose up --build -d
```

- **Web Application**: [http://localhost](http://localhost)
- **Mailpit Web UI (Email Inbox)**: [http://localhost:8025](http://localhost:8025)
- **Bull-Board Queue Dashboard**: [http://localhost/admin/queues](http://localhost/admin/queues) *(Admin account required)*
- **API Health Probes**:
  - Liveness: [http://localhost/health/live](http://localhost/health/live)
  - Readiness: [http://localhost/health/ready](http://localhost/health/ready)

### Pre-Seeded Accounts:
- **Admin**: `admin@medibook.com` / `admin123`
- **Patient**: `patient@medibook.com` / `patient123`
- **Doctor**: `ananya.roy@medibook.com` / `doctor123`

---

## Running Observability (Prometheus & Grafana)

To launch the Prometheus metrics scraper and pre-provisioned Grafana dashboard alongside the application:

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
```

- **Grafana Dashboard**: [http://localhost:3001](http://localhost:3001) *(Credentials: `admin` / `admin`)*
- **Prometheus UI**: [http://localhost:9090](http://localhost:9090)

---

## Manual Local Setup

### Prerequisites
- Node.js (v18+)
- PostgreSQL 16+
- Redis 7+

### 1. Install Dependencies
```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### 3. Run Migrations & Seed Database
```bash
cd backend
npm run migrate:up
npm run seed
```

### 4. Start Services
```bash
# Terminal 1: Backend API
cd backend && npm run dev

# Terminal 2: Background Worker
cd backend && npm run worker

# Terminal 3: Frontend SPA
cd frontend && npm run dev
```

---

## API Overview

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/signup`, `/login` | Public | Account authentication with rotating refresh token cookies |
| `POST` | `/api/auth/refresh` | Public | Rotates refresh token and returns new 15-minute access token |
| `POST` | `/api/auth/logout` | Auth | Revokes active refresh token from database and clears cookie |
| `GET` | `/api/doctors` | Public | Paginated doctor search (supports specialty, fee, rating, distance, sort) |
| `GET` | `/api/doctors/:id` | Public | Doctor profile, reviews, and computed next available slot |
| `GET` | `/api/doctors/:id/booked-slots` | Public | Active booked slots (cached in Redis with version stamps) |
| `PATCH`| `/api/doctors/me/availability` | Doctor | Update weekly hours with optional `?dryRun=true` to preview affected bookings |
| `POST` | `/api/doctors/me/leaves` | Doctor | Block emergency leave with optional `?dryRun=true` preview |
| `GET` | `/api/search/symptom` | Public | Intelligent symptom search using `pg_trgm` similarity ranking |
| `POST` | `/api/appointments/hold` | Patient | Lock a slot for 5 minutes (`hold:{doc}:{slot}` in Redis) |
| `POST` | `/api/appointments` | Patient | Race-safe booking with `Idempotency-Key` and hold validation |
| `PATCH`| `/api/appointments/:id/reschedule`| Patient | Atomic cancel and rebook in a single transaction |
| `PATCH`| `/api/appointments/:id/cancel` | Auth | Cancel appointment, free slot, cascade to waitlist |
| `POST` | `/api/appointments/waitlist` | Patient | Join FIFO waitlist for fully booked dates |
| `GET` | `/api/appointments/doctor/day-view`| Doctor | Doctor day-view schedule with patient summaries |
| `PATCH`| `/api/appointments/:id/no-show`| Doctor | Mark absent patient as `NO_SHOW` |
| `GET` | `/api/appointments/doctor/earnings`| Doctor | Weekly and monthly earnings aggregation |
| `POST` | `/api/prescriptions` | Doctor | Issue digital Rx (restricted to `COMPLETED` visits) |
| `GET` | `/api/prescriptions/:id/versions`| Auth | View prescription version audit history |
| `GET` | `/api/admin/queues` | Admin | Bull-Board queue administration dashboard |
| `GET` | `/metrics` | Internal | Prometheus metrics (HTTP latency histogram, counters) |
| `GET` | `/health/live`, `/health/ready` | Public | Kubernetes/Docker health and readiness probes |

---

## Core Invariants & Design Guarantees

1. **Zero Double-Booking Guarantee**:
   Enforced at the PostgreSQL engine level via a partial unique index:
   ```sql
   CREATE UNIQUE INDEX idx_appointments_active_slot
   ON appointments (doctor_id, slot_time)
   WHERE status IN ('PENDING', 'CONFIRMED');
   ```
   Cancelled appointments transition to `CANCELLED`, freeing the slot for rebooking immediately while preserving complete audit logs.
2. **Race-Safe Daily Booking Tokens**:
   Daily sequence numbers (`MB-YYYYMMDD-001`) are generated atomically using:
   ```sql
   INSERT INTO doctor_daily_counters (doctor_id, booking_date, last_seq)
   VALUES ($1, $2, 1)
   ON CONFLICT (doctor_id, booking_date)
   DO UPDATE SET last_seq = doctor_daily_counters.last_seq + 1
   RETURNING last_seq;
   ```
3. **Zero Message Loss (Transactional Outbox Pattern)**:
   All business mutations and outbox events are inserted into the same ACID transaction. An asynchronous relay polls using `SELECT ... FOR UPDATE SKIP LOCKED` and publishes to BullMQ with idempotent job IDs. If the message broker is temporarily offline, events are safely retained in PostgreSQL.
4. **No Timezone Distortion**:
   Naive wall-clock IST timestamp strings (`YYYY-MM-DDTHH:MM:SS`) are preserved end-to-end without UTC offset corruption.
5. **Cache Stampede Protection**:
   Single-flight mutex locks (`SET lock:<key> 1 EX 5 NX`) and $\pm 10\%$ TTL jitter ensure that high traffic spikes never overwhelm the PostgreSQL database.

---

## Testing & Quality Assurance

### Vitest Test Suite
The codebase includes 27 test files covering 62+ integration and unit tests:
- **Concurrency Test**: 50 parallel requests attempting to book the same slot simultaneously — asserts exactly 1 returns 201, 49 return 409, and booking references are unique.
- **Cancel-then-Rebook Test**: Confirms cancelled slots can be rebooked without constraint violations.
- **Socket Isolation Test**: Proves user B cannot eavesdrop on user A's notifications.
- **Outbox Durability Test**: Proves outbox events survive temporary Redis downtime without loss.
- **Worker Retry & DLQ Test**: Simulates worker failure with exponential backoff and validates poison jobs land in the dead-letter queue.
- **Cross-Instance Socket Delivery**: Validates `@socket.io/redis-adapter` delivers live events across independent backend replicas.
- **Idempotency Replay Test**: Proves identical `Idempotency-Key` headers return the cached response without creating second appointments.

To execute tests:
```bash
cd backend && npm test
```

### k6 Concurrency Benchmark
Run the end-to-end load test simulating 200 virtual users across search, slot hold, and booking:
```bash
k6 run load/booking.js
```
See [`docs/LOAD_TEST.md`](docs/LOAD_TEST.md) for detailed performance results.
