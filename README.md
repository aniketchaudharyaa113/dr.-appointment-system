# MediBook — Enterprise Telehealth & Emergency EMS Platform

A distributed, production-grade telehealth and emergency medical response platform built as a high-throughput TypeScript monorepo alongside an honest Python AI clinical service. 

MediBook pairs board-certified specialist doctor consultations (real-time slot locking, double-entry payment ledger, WebRTC video, and immutable digital prescriptions) with priority Emergency Medical Services (EMS) ambulance dispatch (Redis GEO driver matching, 20-second timeout cascade, and live Leaflet GPS tracking).

Engineered with **NestJS + Fastify**, **Next.js 15 App Router**, **Prisma ORM**, **PostgreSQL (pgvector)**, **Redis 7**, **BullMQ Transactional Outbox**, **Nginx Load Balancing**, **LiveKit WebRTC**, and **Playwright E2E**.

---

## Table of Contents

- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Monorepo Workspace Map](#monorepo-workspace-map)
- [Tech Stack](#tech-stack)
- [Quick Start with Docker Compose](#quick-start-with-docker-compose)
- [Local Development Setup](#local-development-setup)
- [Core Invariants & Engineering Guarantees](#core-invariants--engineering-guarantees)
- [AI Clinical Service & Evals](#ai-clinical-service--evals)
- [Quality Assurance & Test Verification](#quality-assurance--test-verification)
- [Security & Compliance](#security--compliance)

---

## Key Features

### 🧑‍⚕️ Telehealth & Patient Care
- **Intelligent Doctor Discovery**: Search verified physicians by specialty, symptoms, consultation mode (`VIDEO`, `IN_CLINIC`), fee, and patient ratings.
- **10-Minute Redis Slot Hold**: Race-safe, unguessable 48-hex-char hold token (`hold:{doctor}:{slot}`) with live visual countdown timer preventing double-booking and cart-jacking.
- **Double-Entry Financial Ledger**: Zero-sum double-entry ledger tracking `ESCROW`, `DOCTOR_PAYABLE`, and `PLATFORM_REVENUE` accounts with atomic provider webhooks and 100%/50% refund policies.
- **Razorpay Checkout & Webhooks**: Production-grade payment gateway integration with raw-body HMAC-SHA256 verification and replay attack deduplication.
- **HD WebRTC Video Consultations**: LiveKit-powered consultations with pre-slot 10-minute countdown windows, patient informed consent (India Telemedicine Guidelines 2020), and persistent socket chat.
- **Immutable Digital Prescriptions**: Versioned clinical prescriptions (`prescription_versions`) with PDF export and audit logging.
- **Health Passport**: Chronological clinical history of vitals, lab orders, prescriptions, and past doctor encounters.

### 🚑 Priority Emergency Medical Service (EMS)
- **One-Tap SOS Dispatch**: Instant ambulance dispatch with automatic reverse geocoding and manual coordinate fallback.
- **Redis GEO Proximity Matching**: Dispatches trip offers to the nearest active ambulance within 15 km in Kolkata.
- **20-Second Cascade Timeout**: If the primary driver does not accept within 20 seconds, the dispatch automatically cascades to the next nearest driver without duplicate alerts.
- **Live Interactive Leaflet Tracking**: Real-time vehicle location streaming over WebSockets, trauma center markers, and dynamic ETA calculation.
- **Driver Simulator**: Built-in script simulating driver heartbeats, acceptances, and trip progressions (`ACCEPTED -> EN_ROUTE -> ARRIVED -> COMPLETED`).

### 🤖 AI Clinical Copilot & Triage
- **Hybrid RAG (Dense + Sparse)**: Combines 384-dimensional `SentenceTransformer('all-MiniLM-L6-v2')` embeddings with PostgreSQL `tsvector` full-text search via Reciprocal Rank Fusion (RRF), yielding grounded citations and out-of-domain abstention.
- **Triage ML Classifier**: Trained `LogisticRegression` model on clinical emergency/urgent/routine symptoms achieving 100% held-out emergency recall, backed by a hardcoded 112/108 safety net.
- **Conversational Booking Agent**: Autonomous clinical assistant querying real doctor availability and executing slot holds using authenticated patient JWTs.

### 🩺 Doctor Workspace & Administration
- **Clinical Dashboard**: Real-time patient queue, day-view schedule, earnings analytics, and verified patient reviews.
- **Cascade Leave Cancellation**: Emergency leave scheduler featuring a dry-run impact preview (`?dryRun=true`), automatic appointment cancellation, and 100% patient refunds.
- **Admin Operations**: Medical license verification, stuck payment reconciliation, and HIPAA-style prescription read audit trails.

---

## System Architecture

```
                               ┌────────────────────────────────────────────────────────┐
                               │       Next.js 15 Web Application (React 19)            │
                               │  - Doctor Discovery, Slot Holds, Razorpay Checkout     │
                               │  - LiveKit WebRTC Video, Socket.IO Chat & Leaflet Maps  │
                               └───────────────────────────┬────────────────────────────┘
                                                           │ HTTP / HTTPS & WebSockets
                                                           ▼
                     ┌──────────────────────────────────────────────────────────────────┐
                     │                     NGINX REVERSE PROXY                          │
                     │  - Rate Limiting (30r/s API, 5r/s Auth)                          │
                     │  - Anti-Spoofing: Strict X-Forwarded-For $remote_addr             │
                     │  - Load Balancer: Least-Conn (api-1, api-2)                      │
                     │  - WebSocket IP-Hash Affinity (/socket.io/)                      │
                     │  - Security: CSP, HSTS, X-Frame, /metrics blocked from public    │
                     └───────────────────┬──────────────────────────────┬───────────────┘
                                         │                              │
                                         ▼                              ▼
                       ┌───────────────────────────────────┐  ┌─────────────────────────┐
                       │   NestJS / Fastify API Node 1     │  │ NestJS / Fastify Node 2 │
                       │           (Port 4000)             │  │       (Port 4000)       │
                       └─────────────────┬─────────────────┘  └────────────┬────────────┘
                                         │                                 │
           ┌─────────────────────────────┼─────────────────────────────────┼─────────────────────────────┐
           │                             │                                 │                             │
           ▼                             ▼                                 ▼                             ▼
┌──────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐      ┌──────────────────────┐
│  POSTGRESQL 16 ACID  │      │     REDIS 7 CLUSTER    │      │  TRANSACTIONAL OUTBOX  │      │   FASTAPI AI AGENT   │
│ - pgvector (384-d)   │      │ - Slot Hold Mutex (10m)│      │  BullMQ Worker Relay   │      │ - Hybrid Dense/Sparse│
│ - Row-level Locks    │      │ - GEO Driver Matching  │      │  (FOR UPDATE SKIP LOCK)│      │ - Triage Classifier  │
│ - Double-Entry Ledger│      │ - Socket.IO Pub/Sub    │      │ - Mailpit Emailer      │      │ - JWT Booking Agent  │
│ - Partial Uniq Index │      │ - 24h Idempotency Keys │      │ - Delayed Reminders    │      │ - Ollama / Mock LLM  │
│ - Prescription Vers  │      │ - Auth Token Cache     │      │ - Poison Job DLQ       │      └──────────────────────┘
└──────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

---

## Monorepo Workspace Map

```
.
├── apps/
│   ├── api/                   # NestJS 10 + Fastify modular monolith
│   │   ├── prisma/            # Schema, migrations (0_init to 4_patient_vitals), seed data
│   │   ├── src/modules/       # Auth, Scheduling, Payments, Consultation, Ambulance, Admin
│   │   └── test/              # Real Testcontainers specs (Postgres + Redis + MinIO + LiveKit)
│   ├── web/                   # Next.js 15 (App Router, React 19, Tailwind CSS 3)
│   │   ├── src/app/           # Routes: /doctors, /checkout, /consultation, /emergency, /passport
│   │   ├── src/components/    # Responsive navbar, Toast provider, Role guard, ClientTime
│   │   └── test/              # Vitest & Node test runner test suites
│   └── worker/                # BullMQ Transactional Outbox Worker
│       ├── src/               # Outbox relay (SKIP LOCKED), Mailer, Reminder engine, DLQ
│       └── test/              # Real Testcontainers worker integration tests
├── packages/
│   └── shared/                # Zod schemas, constants, DTO contracts shared by API & Web
├── services/
│   └── ai/                    # Python FastAPI AI microservice
│       ├── dataset.py         # 190-item clinical triage dataset (multilingual)
│       ├── triage_model.py    # LogisticRegression classifier on sentence embeddings
│       ├── rag.py             # Hybrid dense (SentenceTransformer) + sparse tsvector search
│       └── evals/             # Pytest AI test suite against pgvector Testcontainer
├── infra/
│   └── nginx/                 # Production Nginx Dockerfile and configuration
├── e2e/                       # Playwright E2E browser tests (Patient flow, Emergency SOS, A11y)
├── load/                      # k6 load testing scripts (concurrency benchmarks)
├── docs/                      # Architectural specs (SYSTEM_DESIGN.md, REMEDIATION.md, AUDIT.md)
├── docker-compose.yml         # Production multi-container orchestration
└── pnpm-workspace.yaml        # Workspace package definitions
```

---

## Tech Stack

| Component | Technology | Description |
|---|---|---|
| **API Framework** | NestJS 10 + Fastify | High-throughput asynchronous HTTP engine with raw-body capture |
| **Frontend Framework** | Next.js 15 + React 19 | App Router, Server/Client components, zero hydration mismatch |
| **Styling & Icons** | Tailwind CSS 3 + Lucide | Clinical design system, WCAG AA touch targets (≥44px), dark mode |
| **State & Data Fetching**| TanStack Query 5 | Single-flight request deduplication, cache invalidation |
| **Database & ORM** | PostgreSQL 16 + Prisma | Strict ACID transactions, row-level locks (`FOR UPDATE`), pgvector |
| **Cache & Real-time** | Redis 7 + Socket.IO | Geospatial driver indexing, Redis IO adapter, mutex locks |
| **Background Jobs** | BullMQ | Transactional outbox relay with `SKIP LOCKED`, poison job DLQ |
| **Video Telehealth** | LiveKit | WebRTC SFU engine, selective audio track detachment, room tokens |
| **Object Storage** | MinIO | S3-compatible presigned upload/download for medical records |
| **AI & NLP** | Python 3.12 + FastAPI | `SentenceTransformers`, `scikit-learn`, hybrid dense/sparse search |
| **Reverse Proxy** | Nginx Alpine | Least-conn load balancing, rate limiting, IP spoofing prevention |
| **Testing** | Testcontainers + Playwright | Zero-mock PostgreSQL/Redis integration tests, cross-browser E2E |

---

## Quick Start with Docker Compose

Run the entire production stack (Nginx, Web, 2x API Replicas, Worker, AI Service, PostgreSQL, Redis, MinIO, Mailpit, LiveKit) with a single command:

```bash
docker compose up --build -d
```

### Service Access Points:
- **Web Application**: [http://localhost](http://localhost) (or [http://localhost:3000](http://localhost:3000))
- **API Health Check**: [http://localhost/api/health/ready](http://localhost/api/health/ready)
- **Mailpit Email Inspector**: [http://localhost:8025](http://localhost:8025)
- **MinIO Object Console**: [http://localhost:9001](http://localhost:9001)

### Pre-Seeded Accounts:
| Role | Email | Password | Access Details |
|---|---|---|---|
| **Patient** | `patient@medibook.com` | `patient123` | Appointment booking, live video, health passport |
| **Doctor** | `ananya.roy@medibook.com` | `doctor123` | Clinical dashboard, prescriptions, leave schedule |
| **Admin** | `admin@medibook.com` | `admin123` | Doctor verification, payment reconciliation, audit logs |
| **Ambulance Driver**| `driver.somnath@medibook.com` | `driver123` | Mobile dispatch acceptance, live GPS streaming |

---

## Local Development Setup

### Prerequisites
- **Node.js**: v22+
- **pnpm**: v12+
- **Python**: 3.12+ (for AI service)
- **Docker**: For running local Postgres (pgvector) and Redis

### 1. Install Workspace Dependencies
```bash
pnpm install
```

### 2. Configure Environment Files
Copy the example environment configurations:
```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

### 3. Generate Prisma Client & Run Migrations
```bash
pnpm --filter @medibook/api exec prisma generate
pnpm --filter @medibook/api exec prisma migrate deploy
pnpm --filter @medibook/api run seed
pnpm --filter @medibook/shared build
```

### 4. Start Services in Development
```bash
# Terminal 1: API Backend (NestJS + Fastify)
pnpm --filter @medibook/api dev

# Terminal 2: Web Application (Next.js 15)
pnpm --filter @medibook/web dev

# Terminal 3: Background Worker (BullMQ)
pnpm --filter @medibook/worker dev

# Terminal 4: Python AI Service
cd services/ai && uvicorn main:app --reload --port 8000
```

---

## Core Invariants & Engineering Guarantees

1. **Zero Double-Booking Guarantee**:
   Enforced at the PostgreSQL storage engine level via a partial unique index:
   ```sql
   CREATE UNIQUE INDEX idx_appointments_active_slot
   ON appointments (doctor_id, slot_time)
   WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED', 'HELD');
   ```
2. **Double-Entry Financial Integrity**:
   Every payment mutation creates balanced zero-sum journal entries in the `ledgers` table. Reconciliations and refunds reverse the exact debits and credits inside a single ACID transaction.
3. **Guaranteed Delivery (Transactional Outbox)**:
   Domain mutations and outbox events write to the same PostgreSQL transaction. The outbox relay uses `SELECT ... FOR UPDATE SKIP LOCKED` to publish events to BullMQ, guaranteeing zero message loss even during message broker downtime.
4. **Idempotent Webhooks & Operations**:
   Razorpay webhook events are tracked in a dedicated `payment_events` table with unique constraint `UNIQUE(provider_event_id)`. Replayed webhooks trigger a graceful duplicate no-op.
5. **Accurate IST Wall-Clock Datetime**:
   All clinic hours, blackout dates, and midnight booking counter rollovers operate strictly in Asia/Kolkata (`UTC+05:30`) without UTC date shifting.

---

## AI Clinical Service & Evals

The AI service in `services/ai/` provides clinical decision support grounded in medical literature:
- **Zero Hallucination / Hybrid Search**: Combines 384-dimensional sentence vectors with BM25/tsvector full-text search. Queries scoring below threshold cleanly abstain rather than hallucinating medical advice.
- **Triage Performance**:
  - Emergency Recall: `1.0000` (zero missed life-threatening emergencies)
  - Evaluated on a 190-sample stratified clinical dataset including romanized Bengali and Hinglish queries.
- **Run AI Evaluations**:
  ```bash
  pytest services/ai/evals/test_evals.py -v
  ```

---

## Quality Assurance & Test Verification

The repository enforces strict verification with zero mocks on critical components:

```bash
# 1. Monorepo linting & TypeScript type checking
pnpm lint
pnpm typecheck

# 2. Web unit and i18n tests
pnpm --filter @medibook/web test

# 3. Backend Testcontainers integration tests (real Postgres + Redis + MinIO)
pnpm --filter @medibook/api test

# 4. Worker integration tests (real Postgres + BullMQ + Mailpit)
pnpm --filter @medibook/worker test

# 5. Playwright End-to-End browser tests
npx playwright test
```

---

## Security & Compliance

- **Telemedicine Practice Guidelines (2020)**: Built-in patient informed consent logging, registered medical practitioner (RMP) qualification display, and prescription digital records.
- **Fail-Fast Secrets**: Application boots fail immediately if secrets (`JWT_SECRET`, `COOKIE_SECRET`, `PAYMENT_WEBHOOK_SECRET`) use default or insecure values in production.
- **Defense in Depth**:
  - IP spoofing prevented via Nginx `$remote_addr` upstream proxy headers.
  - Multi-tier rate limiting on `/api/auth/*` (5 req/sec) and general APIs (30 req/sec).
  - Internal metrics endpoint (`/metrics`) blocked from external ingress.
  - Role-based route guards and in-memory JWT storage with httpOnly cookie bootstrap.
