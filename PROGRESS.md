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

## Remaining Slices (In Progress)
- [ ] **Slice 6**: Compose port hardening, fail-fast env secrets, Nginx routes, real `grafana/k6` load tests in `docs/LOAD_TEST.md`, CI overhaul (pnpm lint/typecheck/test/build + Playwright + AI evals), final docs honesty pass.
