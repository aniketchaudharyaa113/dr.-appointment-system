# MediBook Rebuild Progress Checklist (Honest Verification Log)

- **Active Branch**: `main` (rebuilt NestJS + Next.js monorepo)
- **Verification Standard**: Zero Prisma/Redis/Postgres mocks in integration tests (Testcontainers `pgvector/pgvector:pg16` + `redis:7-alpine` with real Prisma migrations). Mutation proofs recorded in `docs/AUDIT.md`.

---

## Slice 1: Book and Pay for Real — COMPLETED & VERIFIED
- [x] **Repo Cleanup & Standardization**: Removed legacy `backend/`, `frontend/`, duplicate `nginx/`, `monitoring/`, `.pyc` files; updated `.gitignore` & `.dockerignore`; standardized all routes under global `/api` prefix (`metrics` excluded, internal-only in Nginx); standardized `JwtPayload.sub` everywhere (`user.userId` removed); Zod validation pipes on all routes; `tsconfig.build.json` emitting `dist/main.js`.
- [x] **State Machine & Redis Hold Token**: Booking creates `PENDING_PAYMENT` (never `CONFIRMED`). Unguessable 48-hex-char hold token stored via `SET hold:{doctor}:{slot} {token}:{patient} NX EX 600`, verified at booking, released atomically via Lua script. 24h Redis idempotency key on booking and checkout. Expiry job (`releaseExpiredPendingAppointments`) releases unpaid `PENDING_PAYMENT` appointments using `FOR UPDATE SKIP LOCKED`.
- [x] **Raw Body HMAC Webhook & Double-Entry Ledger**: Fastify `{ rawBody: true }` captures exact raw bytes; `POST /api/payments/webhook` verifies HMAC-SHA256 on raw bytes, inserts into `payment_events` (`UNIQUE(provider_event_id)`), acquires `FOR UPDATE` row locks on `payments` and `appointments`, confirms booking, posts zero-sum double-entry ledger (`ESCROW`, `DOCTOR_PAYABLE`, `PLATFORM_REVENUE`), and writes outbox events in one DB transaction.
- [x] **Payment Authorization & Atomic Refunds**: `GET /api/payments/:id` and `POST /api/payments/:id/refund` enforce owner/doctor/admin authorization; refund takes `FOR UPDATE` row lock, verifies `CAPTURED` status inside transaction, records `Refund` (`PENDING`), reverses ledger, and emits `PAYMENT_REFUND_REQUESTED` outbox event for idempotent post-commit provider execution.
- [x] **Asia/Kolkata Timezone**: Wall-clock slot generation, alignment validation, leave bounds, and `MB-YYYYMMDD-NNN` midnight IST rollover in `apps/api/src/common/utils/ist-time.ts`.
- [x] **Real Testcontainers Tests (14/14 PASSED)**: `slice1-booking-race.spec.ts` (5), `slice1-payments-webhook.spec.ts` (5), `slice1-identity-leave-waitlist.spec.ts` (4). Mutation proofs recorded in `docs/AUDIT.md`.
- [x] **Real Frontend + Playwright E2E (PASSED)**: `/auth/login`, `/doctors`, `/doctors/[id]`, `/checkout/[id]` (with FakeProvider signed-webhook simulate button), `/appointments/[id]/confirmed`, `/appointments` all wired to real APIs via TanStack Query (`0` occurrences of `Dr. Arindam` in `apps/web/src`). `e2e/patient-flow.spec.ts` passed against Nginx + Compose stack (`http://localhost`).

---

## Slice 2: Outbox, Worker, Notifications — COMPLETED & VERIFIED
- [x] **Outbox Relay (`apps/worker/src/outbox-relay.ts`)**: Polls `outbox_events` with `FOR UPDATE SKIP LOCKED`, publishes to BullMQ with `jobId = event.id`, marks `PUBLISHED` inside the same transaction so Redis outages leave events `PENDING` for redelivery.
- [x] **Real Worker Processors (`apps/worker/src/worker-engine.ts`, `mailer.ts`)**: Inserts real `notifications` rows in Postgres (`GET /api/notifications`, `POST /api/notifications/:id/read`), sends emails via Nodemailer → Mailpit, schedules 24h & 1h delayed reminder jobs in BullMQ (and cancels them on `AppointmentCancelled` / `AppointmentCancelledByDoctor` / `APPOINTMENT_EXPIRED`), executes pending refunds idempotently, and routes exhausted poison jobs to `dlq-queue` (`status = 'DLQ'`).
- [x] **Real Testcontainers Tests (4/4 PASSED)**: `apps/worker/test/worker.spec.ts` verified against real Postgres (`pgvector/pgvector:pg16`), Redis (`redis:7-alpine`), and Mailpit (`axllent/mailpit:latest`): full outbox+Mailpit+reminders+cancel cleanup, worker crash mid-job stalled-lock recovery, Redis outage recovery, and poison job → DLQ.

---

## Slice 3: Realtime & Consultation — COMPLETED & VERIFIED
- [x] **Fail-Fast Single `JWT_SECRET` & Secrets Validation (`env.schema.ts`, `env.spec.ts`)**: Removed hardcoded default secrets (`COOKIE_SECRET`, `LIVEKIT_*`, `MINIO_*`, webhook secret); fail-fast Zod validation enforces explicit non-empty secrets at boot (3/3 `env.spec.ts` passed).
- [x] **Socket.IO Redis Adapter & Cross-Instance Auth (`redis-io.adapter.ts`, `realtime.service.ts`, gateways)**: Authenticated sockets with `JwtPayload.sub` and strict CORS origin allowlist; `ConsultationGateway` & `AmbulanceGateway` verify DB participation before joining `consult:<id>` or `ambulance:<id>`; personal `user:<sub >` rooms broadcast across multiple Fastify instances via Redis Pub/Sub.
- [x] **LiveKit Join Window, Consent & Prescriptions (`consultation/[id]/page.tsx`, `prescription.service.ts`, `@Inject(AuditService)`)**: Web client integrates `livekit-client`, Socket.IO chat, MinIO upload/download, and immutable versioned prescriptions. Fixed NestJS constructor `@Inject(...)` metadata across `PrescriptionService`, `RolesGuard`, `AuditService`, and `MetricsController`.
- [x] **Real Testcontainers Verification (8/8 PASSED)**: `slice3-realtime-consultation.spec.ts` (4/4: 2-instance Redis adapter isolation + booking notification, socket chat persistence & unauthorized room rejection, LiveKit join window + consent + immutable prescription versions, real MinIO `bitnamilegacy/minio:latest` presigned PUT/GET), `rate-limit.spec.ts` (1/1 real Redis `/api/auth/login` 429), `env.spec.ts` (3/3).

---

## Slice 4: Ambulance Dispatch End-to-End — COMPLETED & VERIFIED
- [x] **End-to-End State Machine & 20s Timeout Cascade (`ambulance.service.ts`, `ambulance.controller.ts`)**: Redis GEO nearest-driver matching, 30s heartbeat eviction + lazy purge, non-repeating `ambulance:tried:<id>` exclusion set, automatic timer + Redis-locked 20s timeout reassignment, atomic conditional `updateMany({ where: { id, status: 'OFFERED', driverId } })` single-winner claim, live trip status transitions (`ACCEPTED -> EN_ROUTE -> ARRIVED -> COMPLETED`), and patient cancel/active/driver-offers APIs.
- [x] **Real-Time Socket.IO & Leaflet Map (`ambulance.gateway.ts`, `emergency/page.tsx`, `emergency-map.tsx`)**: Wired `/ambulance` namespace room authorization + `ambulance_offer` / `ambulance_status` / `ambulance_location` live updates to an interactive Leaflet map with live moving ambulance markers, pickup pin, trauma hospitals, route polyline, and real driver simulator (`scripts/simulate-drivers.ts` + FAKE-mode trip simulator).
- [x] **Real Testcontainers & Playwright Verification**: `slice4-ambulance.spec.ts` 4/4 PASSED (stale driver eviction + cancel, automatic multi-driver timeout cascade -> EXPIRED, 10x parallel atomic accept race, `/ambulance` socket isolation + live location stream). Slice 4 mutation proof recorded in `docs/AUDIT.md`. `e2e/emergency-flow.spec.ts` & `e2e/patient-flow.spec.ts` PASSED (2/2) against live Compose + Nginx stack.

---

## Slice 5: Honest AI Service (pgvector RAG, ML Triage, Booking Agent) — COMPLETED & VERIFIED
- [x] **Real Hybrid RAG (`services/ai/rag.py`, `embeddings.py`, `migrations/3_ai_rag_pgvector`)**: Replaced word-overlap with 384-d `SentenceTransformer('all-MiniLM-L6-v2')` embeddings persisted in PostgreSQL `ai_knowledge_chunks` (`vector(384)` HNSW index + `tsvector` GIN index); RRF hybrid search merges cosine similarity and `ts_rank_cd`, returns source citations (`32/32` Golden hit rate), and abstains cleanly below threshold (`18/20` OOD abstention).
- [x] **LLM Provider Abstraction (`services/ai/llm_provider.py`)**: Implemented `OllamaLLMProvider` (local Ollama / `qwen2.5:latest`) with `DeterministicMockLLMProvider` for CI/offline deterministic grounded generation & SOAP note drafting.
- [x] **ML Triage Classifier + Safety Net (`services/ai/dataset.py`, `triage_model.py`)**: Curated 190-item dataset (`emergency` / `urgent` / `routine` with paraphrases, hard negatives, Hinglish, Bengali-romanized); trained `LogisticRegression` on sentence embeddings + lexical TF-IDF features on stratified 70/30 held-out split (`1.0000` recall, `0.8333` precision, `0.9091` F1 vs Keyword baseline `0.2000` recall, `0.3200` F1). Full benchmark recorded in `docs/AI_EVALS.md` (`103/105` Golden Q&A).
- [x] **Booking Agent & Frontend AI Drawer (`services/ai/booking_agent.py`, `ai.controller.ts`, `ai-client.service.ts`, `ai-drawer.tsx`)**: Forwarded user JWT `Authorization` securely from NestJS Gateway; `RealBookingAgent` queries `/api/doctors`, `/api/doctors/:id/slots`, and `/api/appointments/hold` using the user's own JWT; removed fake hardcoded client-side AI answers. Verified via `pytest services/ai/evals/test_evals.py` (`6/6 PASSED`) and `ai-gateway.spec.ts` (`4/4 PASSED`).

---

## Slice 6: Platform Hardening, Security, Infra & Observability — COMPLETED & VERIFIED
- [x] **Fail-Fast Secrets & Compose Hardening**: Removed default secrets fallbacks (`${VAR:?required}` pattern); restricted MinIO, Mailpit, LiveKit admin ports to `127.0.0.1`; healthchecks with exponential retries across all containers.
- [x] **Nginx Reverse Proxy & Load Balancing**: Least-connection API distribution across `api-1` and `api-2`, IP-hash affinity for Socket.IO WebSockets with Redis adapter, strict `X-Forwarded-For $remote_addr` IP anti-spoofing, rate limiting (30r/s API, 5r/s Auth), and `/metrics` blocked from public ingress.
- [x] **Full-Stack Remediation (Phases 1-6)**:
  - **Phase 1 (P0-1 through P0-14)**: Privilege escalation fixed, IDOR prevented, real provider refunds, double-entry ledger reverse, atomic transactions with row locks, idempotency, login rate limit.
  - **Phase 2 (P1-1 through P1-15)**: Doctor verification lifecycle, prescription immutability & audit logging, waitlist FIFO auto-claims, atomic reschedule, IST timezone validation.
  - **Phase 3 (P2-1 through P2-15)**: Patient Vitals & Lab orders schema, metrics isolation, dev endpoint gating, ambulance rate limits & service bounds, safe AI 112 emergency fallbacks, full TypeScript type safety.
  - **Phase 4 (F-1 through F-15)**: In-memory AuthProvider with httpOnly bootstrap, single-flight token refresh queue, truthful claims & cancellation policy, real LiveKit countdowns & socket auth, dynamic Razorpay Checkout.js, responsive mobile drawer & sticky checkout CTA, custom 404 & error boundaries, multi-lingual support, toast notifications.
  - **Phase 5 & 6**: WCAG AA touch targets & contrast, CI pipeline on `main` with monorepo lint/typecheck/build/test + Testcontainers backend tests + Playwright E2E + AI evals. All verified green.

---

## Audit Remediation (Defects B1–B28 across Workstreams WS1–WS6 on `main`) — COMPLETED & VERIFIED
- [x] **WS1 (`3ce5543`) — Payments, Refunds & Cancellation Safety (`B1, B6, B7, B8-partial, B11, B12, B13`)**:
  - Strict webhook event allowlist (`payment.captured`, `order.paid`), deterministic `providerEventId` fallback hashing raw body + signature, post-cutoff cancellation guard (`assertRefundableAppointment`), global lock order `appointments -> payments -> refunds`, pending payment cancellation/leave voiding, atomic idempotent refund claim (`IN_FLIGHT`), checkout idempotency DB table (`checkout_idempotency_keys`, migration `9_refund_inflight_and_checkout_keys`), and manual refund slot release + waitlist emission.
- [x] **WS2 (`74a27ec`) — Consultation Windows, IDOR, Clinical Integrity & Shared No-Show (`B2, B3, B9, B19, B21, B22-noshow`)**:
  - Time-bounded LiveKit session transitions & attendance tracking (`consultation_attendance` migration `10_consultation_attendance`), `ChatService.markRead` participant authorization, patient-waited vs doctor-no-show differentiation in shared `executeNoShowSweep` (`packages/shared/src/logic/no-show.ts`), overrun reconnect support & status checks on video/consent, lab order appointment validation & status transition guards, transactional prescription audit logging.
- [x] **WS3 (`99a1930`) — Concurrency, Waitlist, Timezone & Shared Worker Engine (`B8-stress, B10, B14, B16, B17, B18, B22`)**:
  - Verified + active doctor checks (`isVerified && user.isActive`), timezone-parameterized IST utilities & shared waitlist/expiry algorithms in `packages/shared/src/logic/` (`timezone.ts`, `waitlist.ts`, `expiry.ts`), per-day booking counter (`daily_booking_counters`, migration `11_daily_booking_counter`), atomic `SKIP LOCKED` waitlist matching with slot-time specificity and post-commit Redis cleanup, 2-phase Redis booking idempotency lock + result caching.
- [x] **WS4 (`b8039aa`) — Auth, Session Hardening, Env Boolean Coercion & Ambulance Privacy (`B5, B15, B20, B23, B25`)**:
  - Strict boolean parser replacing `z.coerce.boolean()` (`B5`), stripped `userEmail` from unauthenticated doctor search (`B15`), refresh token logout vs theft revocation & user deactivation token revocation, password change/reset & email verification flows (`user_security_tokens`, migration `12_auth_privacy_ambulance`), credential-stuffing & fail-closed Redis rate limiters, non-admin redaction + `GEOSEARCH` on `/ambulance/drivers/online`, `simulate-trip` ownership check, and transient network error tolerance in `refreshAccessToken` (`B25`).
- [x] **WS5 (`c91855d`) — AI Security, Circuit Breaker, Infra Hardening & Worker Fault Isolation (`B4, B24, B27, B28`)**:
  - Added shared-secret `X-Internal-Token` and `X-Caller-Role: DOCTOR` enforcement on FastAPI `/chat`, `/triage`, and `/copilot/draft-note`; bound AI port internally via `expose` in `docker-compose.yml`; scrubbed PII and anonymized patient names in `AiClientService.summarizeNote` & `chat`.
  - Added fast-fail AI circuit breaker and digit-boundary Indian phone/Aadhaar PII regex (`B27`); required verified `ConsultationAttachment` records in chat and isolated independent maintenance steps in `WorkerEngine.processExpiryJob` (`B28`).
  - Hardened Nginx headers (HSTS, stricter CSP without `'unsafe-eval'`), replaced `.env.example` secrets with placeholders, bound local DB/Redis/Web host ports to `127.0.0.1`, and dynamically gated demo quick-login panel behind `NEXT_PUBLIC_SHOW_DEMO_LOGINS === 'true'` (`apps/web/src/app/auth/login/demo-panel.tsx`).
- [x] **WS6 — Performance, Search Escaping, Container/E2E Fixes & Full Verification (`B26`)**:
  - Replaced sequential `GET` slot-hold checks with batched `RedisService.getSlotHoldsBatch` (`MGET`), added negative-availability caching sentinel (`NEXT_SLOT_NONE_SENTINEL = 'NONE'`) with invalidation on `updateDoctorAvailability`, and escaped `!`, `%`, `_` LIKE wildcards (`ESCAPE '!'`) in `DoctorService.searchDoctors`.
  - Fixed Docker MinIO image pull (`bitnamilegacy/minio:latest`), empty-string optional env handling in `env.schema.ts`, emergency page form `<label htmlFor>` / Leaflet marker accessibility, and exact badge matching in `e2e/patient-flow.spec.ts`.
  - Verified full Testcontainers integration/unit suites (`pnpm -r typecheck && pnpm -r lint && pnpm -r test`), Python AI evals (`7/7 PASSED`), and full-stack Docker Compose Playwright E2E (`5/5 PASSED`).
