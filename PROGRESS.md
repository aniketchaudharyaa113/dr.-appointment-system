# MediBook Rebuild Progress Checklist

#### Current Status: Phase 8 (Frontend Next.js with Accessible UI/UX) in progress
- **Branch**: `rebuild/nest-next`
- **Active Phase**: Phase 8 (Frontend Next.js with Accessible UI/UX)


---

## Step 0: Deep Planning & Architecture
- [x] Create `docs/ARCHITECTURE.md` (C4 context & container diagrams, module map, 6 end-to-end data flows)
- [x] Create `docs/DECISIONS.md` (8 ADRs: Modular Monolith, Next.js, Prisma, Outbox, Payments, RAG, LiveKit, Redis GEO)
- [x] Create `docs/DOMAIN.md` (Mermaid ERD, state machines transition tables, 10 core domain invariants)
- [x] Create `docs/RISKS.md` (Top 15 production risks, mitigations, and specific proof tests)
- [x] Create `docs/UX.md` (Personas, top journeys, IA, design tokens, component inventory, WCAG 2.2 AA)
- [x] Create `docs/TEST_STRATEGY.md` (Test pyramid, Testcontainers, Playwright, CI quality gates)
- [x] Create `PROGRESS.md`
- [x] Create `docs/plans/phase-1.md`
- [x] Create `docs/plans/phase-2.md`
- [x] Create `docs/plans/phase-3.md`
- [x] Create `docs/plans/phase-4.md`
- [x] Create `docs/plans/phase-5.md`
- [x] Create `docs/plans/phase-6.md`

---

## Phase 1: Foundation
- [x] Monorepo scaffolding with pnpm workspaces & Turborepo (`apps/api`, `apps/worker`, `apps/web`, `services/ai`, `packages/shared`, `infra`)
- [x] Docker Compose setup (PostgreSQL 16 + pgvector, Redis 7, MinIO, Mailpit, LiveKit, API x2, Worker, Web, Nginx, AI)
- [x] Environment schema validation (strict Zod validation at startup)
- [x] Prisma setup + hand-written migration baseline (pgcrypto, pg_trgm, vector, partial indexes)
- [x] NestJS modular monolith core (`apps/api` with Fastify adapter, request-id middleware, Pino logging)
- [x] Health check endpoints (`/health/live`, `/health/ready` verifying DB, Redis, BullMQ)
- [x] OpenAPI Swagger documentation setup (`/api/docs`)
- [x] Global validation pipe with Zod + unified error exception filter
- [x] Integration test harness with Testcontainers (first passing test)
- [x] Phase 1 verification gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (PASSED)
- [x] Git commit & update PROGRESS.md

---

## Phase 2: Identity & Security
- [x] User and doctor authentication (Argon2id password hashing)
- [x] Short-lived access JWT (15m) + rotating hashed refresh tokens in httpOnly cookies with revocation
- [x] RBAC guards (`PATIENT | DOCTOR | ADMIN | DRIVER`)
- [x] Redis-backed rate limiting (IP + email login throttler)
- [x] Security headers (Helmet, strict CORS)
- [x] Doctor verification workflow (Admin approve/reject with audit logging)
- [x] Immutable audit logging service (recording all mutations and PHI reads)
- [x] Phase 2 tests: token rotation reuse detection, RBAC matrix, rate limit (PASSED)
- [x] Phase 2 verification gate & commit

---

## Phase 3: Scheduling Core
- [x] Doctor availability models, slot generation grid, timezone rules (`Asia/Kolkata`)
- [x] Slot hold mechanism (Redis 10-minute hold leases with WebSocket events)
- [x] Atomic booking with partial unique index `(doctor_id, slot_time)`
- [x] Atomic daily reference generator (`MB-YYYYMMDD-NNN`)
- [x] Doctor leave management with dry-run conflict check & cascade cancellation
- [x] Waitlist management with automated 15-minute claim offer chain
- [x] pg_trgm symptom-to-specialty search and multi-facet doctor filtering
- [x] Phase 3 tests: 50-parallel booking race, cancel-then-rebook, slot-grid, leave cascade, hold expiry, idempotency replay, waitlist offer chain (19 tests PASSED)
- [x] Phase 3 verification gate & commit

---

## Phase 4: Payments (Razorpay & Double-Entry Ledger)
- [x] `PaymentProvider` interface with `RazorpayProvider`, `FakeProvider`, and `StripeProvider` stub
- [x] Integer paise representation for all monetary values
- [x] Appointment payment state machine (`HELD -> PENDING_PAYMENT -> CAPTURED -> SETTLED | REFUNDED`)
- [x] Webhook inbox table with raw HMAC-SHA256 signature verification & `UNIQUE(provider_event_id)`
- [x] Worker processor with `SELECT ... FOR UPDATE` row locks and double-entry ledger balancing
- [x] Late-payment protection with automated refund fallback
- [x] Automated payment reconciliation job for stuck transactions
- [x] Phase 4 tests: 10x webhook replay flood, out-of-order events, invalid signature rejection, late payment auto-refund, reconciliation recovery, ledger zero-sum balance (27 tests PASSED)
- [x] Phase 4 verification gate & commit

---

## Phase 5: Consultation (Video + Chat)
- [x] Consultation modes (`IN_CLINIC | VIDEO | CHAT`) and session state machine
- [x] LiveKit service minting scoped JWT join tokens strictly within join window (-10m/+30m)
- [x] NestJS WebSocket gateway for consultation chat (`consult:<id>` rooms)
- [x] Chat message persistence, delivery/read receipts, typing indicators
- [x] MinIO signed URL generation for encrypted medical attachments
- [x] Patient telemedicine consent logging with timestamp
- [x] Versioned immutable prescription workflow and PDF generation
- [x] Phase 5 tests: join-window enforcement, non-participant rejection, message ordering, signed-URL scope (43 tests PASSED)
- [x] Phase 5 verification gate & commit

---

## Phase 6: Ambulance Dispatch
- [x] Emergency ambulance screen with one-tap location and click-to-call 112/108
- [x] Ambulance driver telemetry stream to Redis GEO with heartbeat TTL eviction
- [x] Dispatch state machine (`REQUESTED -> OFFERED -> ACCEPTED -> EN_ROUTE -> ARRIVED -> COMPLETED`)
- [x] 20-second offer countdown with automatic cascading reassignment to next nearest driver
- [x] Atomic single-winner claim mechanism (Redis Lua / PostgreSQL conditional update)
- [x] Live tracking map over WebSockets with dynamic Haversine ETA calculation
- [x] Driver simulation script (`scripts/simulate-drivers.ts` moving 20 drivers around Kolkata)
- [x] Phase 6 tests: concurrent accept single-winner race, timeout reassignment chain, stale driver eviction, socket isolation (50 tests PASSED)
- [x] Phase 6 verification gate & commit


---

## Phase 7: AI Service & Gateway
- [x] Python FastAPI service in `services/ai` with uv/pip and Pydantic schemas
- [x] Safety-first emergency triage detector (rules + classifier) intercepting before LLM
- [x] Clinical RAG pipeline with curated public health corpus in `services/ai/corpus/`
- [x] Hybrid search with pgvector + pg_trgm and explicit citation generation
- [x] Booking agent with tool calling executing strictly with end-user JWT permissions
- [x] Doctor clinical note copilot summarizing consultation transcripts into draft prescriptions
- [x] LLM provider abstraction (Ollama local, Mock LLM for CI, PII redaction)
- [x] Quantitative symptom-to-specialty classifier evaluation (`docs/AI_EVALS.md`)
- [x] Phase 7 tests & evals: golden Q&A suite, retrieval hit rate, emergency 100% recall (53 tests + 7 pytest suites PASSED)
- [x] Phase 7 verification gate & commit


---

## Phase 8: Next.js Frontend with Better UI/UX
- [ ] Tailwind CSS design system with custom medical color palette and shadcn/ui tokens
- [ ] Multilingual support with `next-intl` (English, Hindi, Bengali)
- [ ] Patient journeys: landing page, symptom search, doctor profiles, slot picker, checkout with hold countdown, confirmation card
- [ ] Consultation room: split-screen LiveKit video, device check, chat side-panel, prescription view
- [ ] Emergency SOS screen: one-tap dispatch, click-to-call 112, live Leaflet tracking map
- [ ] Doctor workspace: day-view queue, one-click consult start, availability/leave manager with dry-run preview, earnings Recharts
- [ ] Admin dashboard: doctor verification queue, ledger reconciliation, audit logs viewer, Bull Board queue monitoring
- [ ] Client component tests and Playwright E2E test suite + Axe WCAG 2.2 AA audit
- [ ] Phase 8 verification gate & commit

---

## Phase 9: Observability, Hardening, Load, & Final Docs
- [ ] Prometheus metrics endpoints + Grafana dashboard provisioning
- [ ] k6 load test scripts (booking and webhook flood) with real benchmark results in `docs/LOAD_TEST.md`
- [ ] Chaos resilience validation (Redis drop, worker kill, webhook flood)
- [ ] Production Dockerfiles with multi-stage builds and non-root users
- [ ] Nginx configuration with rate limits, CSP, and security headers
- [ ] Updated `README.md`, `docs/SYSTEM_DESIGN.md`, and `docs/INTERVIEW_GUIDE.md` (20 toughest questions)
- [ ] Final verification gate & comprehensive final report
