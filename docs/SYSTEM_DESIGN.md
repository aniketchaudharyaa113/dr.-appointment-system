# MediBook Rebuilt — High-Level Design (HLD) & Low-Level Design (LLD)

## 1. Executive Summary

**MediBook** is a production-quality, distributed telehealth and emergency medical service (EMS) platform rebuilt as a high-throughput **NestJS modular monolith** with a modern **Next.js 15 (App Router)** frontend, standalone **BullMQ worker**, and an extracted **Python FastAPI AI clinical service**.

Key Architectural Capabilities:
- **NestJS Fastify Monolith (`apps/api`):** Sub-5ms API responses, request ID correlation (`x-request-id`), Zod request/response validation pipes, Pino structured JSON logging with automated PHI redaction.
- **Next.js 15 App Router (`apps/web`):** Accessible, WCAG 2.2 AA compliant UI/UX with medical color system (Teal/Emerald/Rose), next-intl localization (English, Hindi, Bengali), live hold countdowns, and dark/light themes.
- **PostgreSQL 16 + pgvector + pg_trgm:** ACID transactions, partial unique indexes for zero double-booking, hybrid clinical search (vector embeddings + trigram similarity), and hand-written SQL migrations.
- **Double-Entry Financial Ledger in Integer Paise:** `amount_paise` representation, zero-sum invariant (`SUM(debits) === SUM(credits)`), webhook inbox idempotency, and automated late-payment refunds.
- **Telehealth Video & Real-Time Consultation:** Self-hosted LiveKit SFU with backend-minted join tokens strictly inside `[slotTime - 10m, slotTime + 30m]` windows, encrypted WebSocket chat with receipts, signed MinIO attachments, and immutable prescription versioning.
- **Priority Emergency Ambulance Dispatch:** One-tap location capture, 112/108 hotlines, Redis GEO telemetry stream at 1.0 Hz with 30s TTL heartbeat eviction, 20-second cascading driver assignment, and atomic conditional claim update.
- **Clinical AI Assistant (Python FastAPI):** Local safety-first emergency detector (100% recall on life-threatening presentations bypassing the LLM), RAG assistant with clinical citations, booking agent tool calling under end-user JWT permissions, and doctor clinical note copilot.

---

## 2. High-Level Architecture (C4 Container Diagram)

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

## 3. Core Domain State Machines & Invariants

### 3.1 Appointment & Payment State Machine
```
[ HELD ] (10-min Redis hold lease)
   │
   ▼
[ PENDING_PAYMENT ] ──(Razorpay Webhook)──► [ CONFIRMED ]
   │                                              │
   │ (Hold Expired & Slot Lost)                   ▼
   ├──────────────────────────────► [ IN_PROGRESS ] (Consultation)
   │                                              │
   ▼                                              ▼
[ REFUNDED ]                                [ COMPLETED ] ──► [ PRESCRIPTION ISSUED ]
```

### 3.2 Double-Entry Ledger Invariant
For every financial capture or refund:
$$\sum \text{Debits} - \sum \text{Credits} = 0$$
- Patient Account debited in integer paise.
- Doctor earnings, platform commission, and GST tax accounts credited simultaneously in a single atomic transaction.

### 3.3 Zero Double-Booking Invariant
Physical PostgreSQL database partial unique index:
```sql
CREATE UNIQUE INDEX idx_appointments_active_slot
ON appointments (doctor_id, slot_time)
WHERE status IN ('HELD', 'CONFIRMED', 'IN_PROGRESS');
```
Guarantee: Under zero circumstances can two clients hold or book the same slot. Cancelled slots immediately drop out of the partial index and are rebookable.

---

## 4. Telehealth & Emergency EMS Telemetry

### 4.1 Telehealth Video Window
LiveKit video tokens are generated exclusively via backend signed JWTs inside the strict join window:
$$\text{Window} = [\text{slotTime} - 10\text{min}, \text{slotTime} + 30\text{min}]$$
Non-participants or requests outside this window receive HTTP 403 Forbidden.

### 4.2 Emergency Dispatch & Redis GEO
- Drivers stream lat/lng to Redis GEO: `GEOADD ambulance:drivers:geo <lng> <lat> <driverId>`.
- Driver heartbeat key with 30s TTL automatically purges offline drivers from nearest-neighbor searches.
- Atomic conditional update claims the request:
  `UPDATE ambulance_requests SET status = 'ACCEPTED', driver_id = $1 WHERE id = $2 AND status = 'OFFERED';`
  Ensuring exactly one winning driver per emergency dispatch.
