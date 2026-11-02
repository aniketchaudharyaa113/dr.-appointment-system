# Architecture Decision Records (ADRs)

## Index of Decisions
- [ADR-001: Modular Monolith vs Microservices](#adr-001-modular-monolith-vs-microservices)
- [ADR-002: Next.js App Router for Web Application](#adr-002-nextjs-app-router-for-web-application)
- [ADR-003: Prisma ORM with Hand-Written SQL Migrations](#adr-003-prisma-orm-with-hand-written-sql-migrations)
- [ADR-004: Transactional Outbox Pattern with BullMQ Relay](#adr-004-transactional-outbox-pattern-with-bullmq-relay)
- [ADR-005: Strict Payment State Machine and Double-Entry Ledger](#adr-005-strict-payment-state-machine-and-double-entry-ledger)
- [ADR-006: Retrieval-Augmented Generation (RAG) vs Full Fine-Tuning](#adr-006-retrieval-augmented-generation-rag-vs-full-fine-tuning)
- [ADR-007: LiveKit WebRTC SFU for Telehealth Video Consultations](#adr-007-livekit-webrtc-sfu-for-telehealth-video-consultations)
- [ADR-008: Redis GEO & Distributed Locks for Ambulance Dispatch](#adr-008-redis-geo--distributed-locks-for-ambulance-dispatch)

---

## ADR-001: Modular Monolith vs Microservices

### Context
MediBook handles multi-domain operations: identity, appointments, payments, video consultations, ambulance dispatch, and notifications. Microservices introduce distributed transaction overhead, network latency, complex network partitions, and dual-write failures (e.g., booking an appointment while initiating payments).

### Options Considered
1. **Full Microservices Architecture**: Separate services for Identity, Bookings, Payments, Ambulance, etc., communicating over gRPC/Kafka.
2. **Traditional Monolith**: Tightly coupled layered codebase with shared database models and cross-table direct queries.
3. **Modular Monolith (Chosen)**: A single deployable NestJS Fastify codebase structured into strictly isolated domain modules (`src/modules/*`), enforced boundary linting, domain event outbox, and separate schemas/prefixes.

### Decision
Adopt the **Modular Monolith** architecture for `apps/api`. Modules communicate only via exported service contracts or transactional domain events. No module may perform direct SQL queries or joins on tables owned by another module.

### Consequences
- **Positive**: Single codebase, low cognitive load, zero network hops for internal workflows, trivial atomic database transactions when required, straightforward local development.
- **Negative**: Requires strict static analysis enforcement (`eslint-plugin-boundaries` or dependency-cruiser) to avoid accidental coupling.

---

## ADR-002: Next.js App Router for Web Application

### Context
A modern telehealth platform demands high initial page load speed for patients searching for doctors, SEO for public doctor profiles and clinic directories, dynamic internationalization (English, Hindi, Bengali), and low latency for authenticated dashboards.

### Options Considered
1. **Single Page Application (Vite + React)**: Client-side only. Poor initial load time on mobile devices in low-bandwidth regions, poor SEO for doctor discovery.
2. **Next.js Pages Router**: Legacy routing model; lacks nested layouts, streaming server components, and native server action abstractions.
3. **Next.js App Router (Chosen)**: React Server Components (RSC), built-in streaming SSR, file-system routing, first-class metadata API for SEO, and deep integration with `next-intl`.

### Decision
Use **Next.js 15+ (App Router)** with TypeScript, Tailwind CSS, shadcn/ui components, TanStack Query for client-side queries, and `next-intl` for multilingual accessibility.

### Consequences
- **Positive**: Optimal Core Web Vitals (LCP, INP, CLS), pre-rendered doctor search profiles, server-side data fetching without client waterfall requests, accessible design tokens.
- **Negative**: Requires understanding of React Server Component boundaries and hydration semantics.

---

## ADR-003: Prisma ORM with Hand-Written SQL Migrations

### Context
Type safety between database entities and application business logic is paramount. However, MediBook has stringent relational and concurrency constraints that high-level ORMs cannot express natively, such as:
- Partial unique indexes (`UNIQUE (doctor_id, slot_time) WHERE status IN ('PENDING', 'CONFIRMED')`).
- Concurrency locks (`SELECT ... FOR UPDATE SKIP LOCKED`).
- Specialized extensions (`pg_trgm`, `vector`, `pgcrypto`).
- Double-entry balance integrity check constraints.

### Options Considered
1. **Pure Raw SQL / Kysely**: Maximum control, but requires maintaining types manually or running custom generators.
2. **Standard Prisma Schema without raw SQL**: Cannot declare partial indexes, custom check constraints, or pgvector indexes natively.
3. **Prisma ORM with Hybrid Hand-Written SQL Migrations (Chosen)**: Prisma schema acts as the single source of truth for TypeScript types and standard CRUD operations, combined with manual SQL migration scripts (`prisma migrate diff` or custom migration files) for partial indexes and extensions.

### Decision
Use **Prisma** for schema management, client generation, and standard queries, augmented with hand-written SQL migrations to define database constraints, partial indexes, and trigram/vector indexes.

### Consequences
- **Positive**: Complete compile-time type safety for NestJS services; bulletproof Postgres-level concurrency guarantees.
- **Negative**: Engineers must verify that partial indexes and custom constraints are preserved across migration baselines.

---

## ADR-004: Transactional Outbox Pattern with BullMQ Relay

### Context
In distributed telehealth workflows, an operation often requires both updating the database and emitting side effects (e.g., booking an appointment must schedule an email, notify via WebSocket, and enqueue calendar synchronization). Dual-writes to PostgreSQL and external queues (Redis/RabbitMQ) fail when the network dies between the two operations.

### Options Considered
1. **Direct Message Queue Publishing**: Write to PostgreSQL, then immediately call `queue.add()`. If Redis or the network is down, the DB commit succeeded but the side effect is permanently lost.
2. **Change Data Capture (Debezium / Logical Replication)**: High operational complexity requiring Kafka and replication slot management.
3. **Transactional Outbox Table with Background Polling / BullMQ Relay (Chosen)**: The domain state change and an `outbox_events` record are saved in the **exact same ACID database transaction**. A dedicated background worker relays pending outbox events to BullMQ with retries and at-least-once delivery guarantees.

### Decision
Implement the **Transactional Outbox Pattern** via an `outbox_events` table in PostgreSQL, drained by `apps/worker` via a BullMQ processor with exponential backoff and dead-letter queues.

### Consequences
- **Positive**: Guaranteed zero event loss; atomic consistency between domain writes and message dispatching; simple auditing of all emitted system events.
- **Negative**: Slight asynchronous relay latency (sub-second); consumer processors must be strictly idempotent using idempotency keys.

---

## ADR-005: Strict Payment State Machine and Double-Entry Ledger

### Context
Online payments in India via gateways like Razorpay are subject to network drops, late webhook delivery, customer browser closes, and duplicate webhook replays. Never should a customer be charged without an appointment being confirmed, nor should a late webhook confirm a slot that was already surrendered to another patient.

### Options Considered
1. **Single status column on Appointments table**: Tightly couples appointment workflow with payment settlement. Vulnerable to race conditions.
2. **Client-trusted Payment Success Callback**: Browser calls `/confirm-payment` after gateway modal closes. Highly vulnerable to forged requests and tampered amounts.
3. **Dedicated Payment State Machine with Double-Entry Ledger (Chosen)**:
   - Separate `payments`, `payment_events`, `refunds`, and `ledger_entries` tables.
   - Money stored strictly as integer **paise** (1 INR = 100 paise).
   - Inbound webhook raw HMAC verified; written to `payment_events` with `UNIQUE(provider_event_id)` for replay immunity.
   - All state transitions guarded by `SELECT ... FOR UPDATE`.
   - Every monetary movement recorded as balanced debit/credit ledger lines.

### Decision
Implement the payment domain around a formal state machine (`HELD -> PENDING_PAYMENT -> CAPTURED -> SETTLED | REFUNDED`), integer paise, raw-body HMAC verification, and balanced double-entry accounting. If payment arrives after hold expiry, the worker automatically initiates a full refund.

### Consequences
- **Positive**: Mathematical auditability (sum of debits = sum of credits = 0); absolute immunity against webhook replay and duplicate charges; automated refund for late settlements.
- **Negative**: Requires thorough automated testing of race conditions and out-of-order webhook delivery.

---

## ADR-006: Retrieval-Augmented Generation (RAG) vs Full Fine-Tuning

### Context
MediBook provides an AI Assistant to help patients navigate platform services, search clinical specialties, understand preparations for consultations, and review their past medical summaries. Telehealth requires zero hallucinations, strict clinical grounding, instant updates to doctor directories/policies, and absolute compliance with patient privacy (HIPAA/DISHA).

### Options Considered
1. **Full LLM Fine-Tuning for Generative Advice**:
   - High cost, catastrophic forgetting, training lag.
   - Cannot dynamically update doctor schedules or fees without retraining.
   - Critical risk of medical hallucination.
   - PII leakage risk if patient records are baked into model weights.
2. **Pure Prompt Engineering without Retrieval**: Limited context window, lacks knowledge of specific platform guidelines or patient history.
3. **Retrieval-Augmented Generation (RAG) with Small Specialized Triage Classifier (Chosen)**:
   - Generative dialogue runs on RAG: knowledge chunks (curated public health, platform policies, doctor catalog) and user's private records are retrieved via hybrid search (pg_trgm + pgvector).
   - A deterministic rule-based + small lightweight classifier (DistilBERT / fast text classification) is used **only** for Emergency Triage (chest pain, stroke signs) to intercept emergencies *before* any LLM invocation.
   - Explicit citations accompany every generative response.

### Decision
Use **RAG** for generative patient interactions, with pgvector hybrid search and strict per-user authorization boundaries. Fine-tuning is reserved strictly for a lightweight symptom-to-specialty classification and emergency triage classification benchmark, documented honestly with evaluation metrics.

### Consequences
- **Positive**: Verifiable citations, instant knowledge base updates, zero medical hallucination in emergency triage, patient PHI remains in secure DB with row-level security.
- **Negative**: Requires maintaining vector embeddings and chunking pipelines.

---

## ADR-007: LiveKit WebRTC SFU for Telehealth Video Consultations

### Context
Peer-to-peer WebRTC (Mesh) fails when more than two participants join or under asymmetric NATs and poor cellular networks common in remote telehealth. A robust Selective Forwarding Unit (SFU) is required.

### Options Considered
1. **Direct Peer-to-Peer WebRTC**: High upstream bandwidth requirement on patient mobile devices, frequent connection drops, no central server control over access windows.
2. **Third-party Hosted SDKs (Twilio Video, Agora)**: Vendor lock-in, recurring per-minute SaaS billing, privacy constraints regarding data residency.
3. **Self-Hosted LiveKit SFU (Chosen)**: Open-source, production-grade WebRTC SFU built in Go. Can run directly in Docker Compose alongside MediBook. Backend mints cryptographically signed JWT access tokens strictly scoped to the appointment window.

### Decision
Deploy **LiveKit** as the core media server. The NestJS backend acts as the sole token minting authority, granting room access only during the authorized consultation window (-10 min to +30 min).

### Consequences
- **Positive**: Low latency, high network resiliency (simulcast, dynacast, adaptive stream), self-hostable in containerized infra, strict backend authorization.
- **Negative**: Requires configuring UDP port forwarding and STUN/TURN servers in production environments.

---

## ADR-008: Redis GEO & Distributed Locks for Ambulance Dispatch

### Context
Emergency ambulance dispatch requires sub-second driver location indexing, real-time proximity calculation, and atomic single-driver dispatch assignment to eliminate the risk of multiple drivers racing to claim the same patient request.

### Options Considered
1. **PostgreSQL PostGIS Queries on every GPS tick**: Excessive database write load; constant disk I/O when 20+ drivers emit GPS coordinates every 3 seconds.
2. **Kafka Geospatial Streams**: Overkill operational footprint for vehicle telemetry.
3. **Redis GEO Data Structures with Redlock / Atomic Lua Claims (Chosen)**:
   - In-memory `GEOADD` and `GEORADIUS` / `GEOSEARCH` execute in sub-millisecond time.
   - Driver heartbeats maintained using Redis key TTLs (auto-evicting inactive drivers).
   - Atomic claim window executed using Redis `SETNX` or atomic PostgreSQL conditional status update (`UPDATE ambulance_requests SET status='ACCEPTED', driver_id=$1 WHERE id=$2 AND status='OFFERED'`).

### Decision
Use **Redis GEO** for real-time driver tracking and proximity searches, backed by an atomic claim mechanism ensuring exactly one driver wins any dispatch offer.

### Consequences
- **Positive**: Blazing fast search and location streaming; zero database churn for ephemeral telemetry; guaranteed single-winner dispatch race.
- **Negative**: Telemetry in Redis is ephemeral; historical journey paths must be archived to PostgreSQL upon trip completion.
