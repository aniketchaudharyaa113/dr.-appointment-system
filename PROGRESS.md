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

## Remaining Slices (In Progress)
- [ ] **Slice 2**: Outbox relay (`FOR UPDATE SKIP LOCKED`), BullMQ workers, in-app notifications, Nodemailer → Mailpit, 24h/1h reminders + cancel cleanup, retries/backoff + DLQ, real failure tests.
- [ ] **Slice 3**: Single `JWT_SECRET` everywhere (fail-fast), Socket.IO Redis adapter, DB participation checks on room join, strict CORS, cross-instance isolation tests, `livekit-client` in web, MinIO signed URL attachments.
- [ ] **Slice 4**: End-to-end ambulance dispatch, 20s timeout reassignment, atomic accept, Leaflet live tracking + driver simulator.
- [ ] **Slice 5**: Real pgvector + tsvector hybrid RAG with embeddings, LLM provider abstraction (Ollama + deterministic mock), ML emergency classifier (>=150 labeled texts, held-out eval >=0.97 recall), golden Q&A >=100 in `docs/AI_EVALS.md`, booking agent using user JWT.
- [ ] **Slice 6**: Compose port hardening, fail-fast env secrets, Nginx routes, real `grafana/k6` load tests in `docs/LOAD_TEST.md`, CI overhaul (pnpm lint/typecheck/test/build + Playwright + AI evals), final docs honesty pass.
