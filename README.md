# MediBook — Next-Gen Telehealth & Priority Emergency Dispatch Platform

A production-grade, distributed telehealth platform and regional Emergency Medical Service (EMS) dispatch system rebuilt as a high-performance monorepo: **NestJS Fastify modular monolith**, **Next.js 15 App Router** frontend, standalone **NestJS BullMQ worker**, and an extracted **Python FastAPI AI clinical service**.

---

## High-Level Architecture

```
                               ┌────────────────────────────────────────────────────────┐
                               │                    WEB BROWSER                         │
                               │  - Next.js 15 App Router (React 19, Tailwind, shadcn)  │
                               │  - i18n (EN, HI, BN) • LiveKit Web Client • Sockets    │
                               └───────────────────────────┬────────────────────────────┘
                                                           │ HTTP / WebSockets
                                                           ▼
                              ┌─────────────────────────────────────────────────────────┐
                              │                    NGINX REVERSE PROXY                  │
                              │  - Rate Limiting (30 r/s API, 5 r/s Auth, 50 conn/IP)   │
                              │  - Strict Location Precedence (^~ /api/auth/)           │
                              │  - Security Headers: Strict CSP, X-Frame, X-Content-Type│
                              │  - WebSocket Upgrade: /socket.io/ & /consultation       │
                              └─────────────┬─────────────────────────────┬─────────────┘
                                            │                             │
                     Static & SSR (/)       │                             │ /api/v1/ & /socket.io/
                                            ▼                             ▼
                              ┌───────────────────────────┐ ┌───────────────────────────┐
                              │     NEXT.JS WEB POD       │ │     NESTJS MONOLITH       │
                              │     (apps/web:3000)       │ │     (apps/api:4000)       │
                              └───────────────────────────┘ └─────────────┬─────────────┘
                                                                          │
         ┌────────────────────────────────┬───────────────────────────────┼───────────────────────────────┐
         │                                │                               │                               │
         ▼                                ▼                               ▼                               ▼
┌──────────────────┐            ┌──────────────────┐            ┌──────────────────┐            ┌──────────────────┐
│  POSTGRESQL 16   │            │     REDIS 7      │            │  BULLMQ WORKER   │            │ PYTHON AI SERVICE│
│ - pgvector       │            │ - 10-Min Hold    │            │ (apps/worker)    │            │ (services/ai)    │
│ - pg_trgm        │            │ - Redis GEO      │            │ - Outbox Relay   │            │ - Safety Triage  │
│ - Partial Index  │            │ - Socket Adapter │            │ - Webhook Worker │            │ - Hybrid RAG     │
│ - Double-Entry   │            │ - Cache Locks    │            │ - Reminders      │            │ - Copilot SOAP   │
└──────────────────┘            └──────────────────┘            └──────────────────┘            └──────────────────┘
```

---

## Core Capabilities & Features

### 🧑‍⚕️ Patient Experience
- **Symptom-First Search:** Intelligent symptom matching using PostgreSQL `pg_trgm` similarity ranking.
- **10-Minute Hold Lease with Live Countdown:** Redis-backed reservation lease (`NX PX 600000`) preventing cart races and broadcasting hold locks over WebSockets.
- **Razorpay & Double-Entry Ledger Checkout:** All fees represented as integer **paise** (1 INR = 100 paise) maintaining double-entry balance (`debits === credits`).
- **Encrypted HD Video Consultation:** Self-hosted LiveKit SFU; backend mints join tokens strictly inside `[slotTime - 10m, slotTime + 30m]` windows with informed consent timestamping.
- **Encrypted Consultation Chat:** Real-time Socket.IO chat with typing indicators, delivery receipts, MinIO signed attachments, and 7-day follow-up messaging.
- **Digital Prescriptions:** Immutable versioned digital Rx issued upon consultation completion.
- **Priority Emergency Ambulance Dispatch:** 1-tap SOS alert triggering automated 20-second offer cascades across Kolkata ambulance drivers, click-to-call 112/108, and live GPS tracking.

### 🩺 Doctor Clinical Workspace
- **Today's Patient Queue:** Real-time day view with one-click consultation launch.
- **Availability & Leave Manager:** Dry-run conflict simulation previewing affected appointments before cascading cancellations and 100% automated refunds.
- **AI Clinical Note Copilot:** Generates SOAP notes (Subjective, Objective, Assessment, Plan) from consultation transcripts with mandatory doctor review before EHR commit.
- **Revenue Analytics:** Double-entry settlement charts rendered via Recharts.

### 🛡️ Admin Operations & Compliance
- **Doctor Verification Queue:** Review medical registration credentials (NMC/WBMC) with audit logging.
- **Ledger Integrity Explorer:** Audits all financial transactions confirming zero-sum ledger balance.
- **Reconciliation Engine:** Background recovery for stuck payment webhooks.
- **Immutable PHI Read Audit Trail:** HIPAA/DISHA compliant logs recording every view of medical records.

### 🚑 Emergency Ambulance Drivers
- **Live Telemetry Stream:** Location streaming to Redis GEO at 1.0 Hz with 30s heartbeat TTL eviction.
- **Atomic Single-Winner Claim:** Atomic conditional updates prevent double-assignment races.

---

## How to Demo (In ≤ 7 Commands)

```bash
# 1. Clone repository and switch to branch
git checkout rebuild/nest-next

# 2. Start full Docker Compose stack (PostgreSQL, Redis, MinIO, Mailpit, LiveKit, APIx2, Worker, Web, Nginx, AI)
docker compose up --build -d

# 3. Verify health probes
curl http://localhost/health/ready

# 4. Open Web Application
xdg-open http://localhost/ || open http://localhost/

# 5. Open Mailpit (Email Inspector)
xdg-open http://localhost:8025/ || open http://localhost:8025/

# 6. Run automated monorepo unit & integration test suites
pnpm test

# 7. Run Playwright E2E test suite (Patient flow, Emergency dispatch, WCAG 2.2 AA audit)
pnpm test:e2e
```

### Seeded Demo Accounts (1-Click Login Available)

| Role | Email | Password | Primary Workspace |
| :--- | :--- | :--- | :--- |
| **Patient** | `patient@medibook.test` | `Password123!` | [http://localhost/doctors](http://localhost/doctors) |
| **Doctor** | `doctor@medibook.test` | `Password123!` | [http://localhost/doctor/dashboard](http://localhost/doctor/dashboard) |
| **Admin** | `admin@medibook.test` | `Password123!` | [http://localhost/admin](http://localhost/admin) |
| **Driver** | `driver@medibook.test` | `Password123!` | [http://localhost/emergency](http://localhost/emergency) |

---

## Tech Stack Overview

- **Monorepo:** pnpm workspaces + Turborepo
- **Backend API (`apps/api`):** NestJS v11 (Fastify adapter), strict TypeScript, Pino structured logger, OpenAPI Swagger (`/api/docs`).
- **Worker (`apps/worker`):** NestJS standalone app, BullMQ queue processor, transactional outbox relay.
- **Frontend (`apps/web`):** Next.js 15 App Router, React 19, Tailwind CSS, shadcn/ui tokens, next-intl (English, Hindi, Bengali), Framer Motion, Leaflet OSM, Recharts.
- **AI Service (`services/ai`):** Python 3.11, FastAPI, Pydantic, rule-based emergency triage classifier (<2ms), RAG clinical pipeline with pgvector hybrid search.
- **Databases & Cache:** PostgreSQL 16 + pgvector + pg_trgm, Redis 7 (Hold leases, Redis GEO, Pub/Sub, BullMQ).
- **Video & Storage:** LiveKit (self-hosted SFU container), MinIO (S3-compatible presigned object storage).
- **Observability:** Prometheus `/metrics` exposition, Grafana dashboards (`infra/grafana/dashboards/medibook.json`).

---

## Testing & Quality Assurance

- **Unit & Concurrency Tests:** 53 unit tests in `apps/api`, 4 in `apps/web`, 7 pytest suites in `services/ai` (100% emergency recall).
- **Concurrency Invariant:** 50-parallel booking race verified: exactly 1 winner, 49 rejected with 409 Conflict.
- **Idempotency Replay Flood:** 200 concurrent duplicate webhooks verified: exactly 1 ledger posting, 199 deduplicated no-ops.
- **Playwright E2E:** Full patient booking, payment capture, consultation room, ambulance dispatch, and Axe WCAG 2.2 AA audit.
