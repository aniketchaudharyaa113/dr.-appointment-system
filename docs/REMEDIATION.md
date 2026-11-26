# MediBook Remediation Tracker

All fixes are committed atomically on `main` (baseline tag: `pre-agent-baseline`).

## Phase 1 — P0: Security, Money, Data Integrity
- [x] **P0-1** (`bbc62ef`): Public registration restricted to `PATIENT` / `DOCTOR` only; `ADMIN` / `DRIVER` via seed or admin-only endpoint + RBAC regression test
- [x] **P0-2** (`fa06811`): Doctor leave `applyLeave` / `previewLeave` ownership check (`doctor.userId === user.sub`), reject past start dates & overlapping leaves
- [x] **P0-3** (`892c935`): Worker refund dispatch calls real payment provider idempotently (no fake `rfnd_worker_*`), retries/DLQ on failure, notifies only on success
- [x] **P0-4** (`6780555`): Unified `RefundPolicyService` used by cancel, refund, and doctor leave in one transaction (lock, cancel, Refund row, ledger reversal, outbox)
- [x] **P0-5** (`6780555`): Block refunds for `COMPLETED`/`IN_PROGRESS`/`NO_SHOW`/past slots (except `ADMIN`); restrict cancel to `PENDING_PAYMENT`/`CONFIRMED`/`HELD`
- [x] **P0-6** (`366363f`): Webhook `payment_events` insert inside processing transaction (or re-process `PENDING` on duplicate) + crash-recovery test
- [x] **P0-7** (`366363f`): Webhook amount/currency verification, `X-Razorpay-Event-Id` header dedup, real `RazorpayProvider.fetchPaymentStatus`
- [x] **P0-8** (`366363f`): Shared `applyCapture(tx, payment)` for webhook & `reconcileStuckPayments`; no resurrecting cancelled/expired appointments; emit outbox events
- [x] **P0-9** (`366363f`): Payment retry after `FAILED` reuses/resets existing `Payment` row in transaction + fail->retry->capture test
- [x] **P0-10** (`366363f`): Reject `PAYMENT_PROVIDER=FAKE` when `NODE_ENV=production`; `GET /api/payments/config`; gate simulator UI
- [x] **P0-11** (`d0d3d3b`): Remove default secret fallbacks in `docker-compose.yml` (`${VAR:?required}`), reject weak secrets in production, bind admin ports to `127.0.0.1`
- [x] **P0-12** (`ed36c64`): Fastify `trustProxy`, `req.ip`, nginx `X-Forwarded-For $remote_addr`, atomic login rate limit, rate-limit register/hold/book/ambulance/ai
- [x] **P0-13** (`834956e`): Auth hardening (`isActive` check cached in Redis, `algorithms: ['HS256']`, `JWT_EXPIRES_IN`, atomic refresh rotation w/ grace window, uniform login timing, P2002->409, password max length/strength, refresh cleanup)
- [x] **P0-14** (`c886fa8`): Public data leak fixes (`GET /ambulance/drivers/online` auth, explicit Doctor public DTO + 404 unverified, strip ledger for non-admin, generic 500 in prod, protect Swagger, Helmet CSP)

## Phase 2 — P1: Broken or Missing Core Flows
- [x] **P1-1** (`66d8523`): State machine in `appointment-state.ts` (LIVE -> IN_PROGRESS, ENDED -> COMPLETED, NO_SHOW sweep for expired confirmed appts + outbox events); consultation room UI controls for doctor start/end and red phone action
- [x] **P1-2** (`66d8523`): Safe session status endpoint with upsert, transition validation, doctor-only restriction for LIVE/ENDED, and CONFIRMED/IN_PROGRESS requirement
- [x] **P1-3** (`1bce02b`): Chat, uploads, vitals guarded to CONFIRMED/IN_PROGRESS/COMPLETED; 7-day post-consultation window checked against `consultation.endedAt`; socket Zod schema validation & 4000 char cap; REST POST `/messages` emits to socket room; aligned socket `join_room` to deny non-participants (including ADMIN)
- [x] **P1-4** (`5525337`): Wire `AppointmentSlotFreed` outbox events into waitlist cascading offers, atomic claim with `updateMany` and mode support, `leaveWaitlist` endpoint with hold release and next-in-line cascade, offer expiration worker sweep
- [x] **P1-5** (`f4c09ba`): Review model endpoint `POST /appointments/:id/review`, aggregate/denormalized rating calculation (`ratingAvg`, `ratingCount`), doctor reviews list UI & review modal for completed appointments
- [x] **P1-6** (`86576b6`): `PATCH /lab-orders/:id` for ordering doctor with Zod schema (`UpdateLabResultsSchema`), completedAt and resultNotes migration, surfaced results and doctor notes in Health Passport
- [x] **P1-7** (`fc7fedb`): Filter out past slots and slots within 15-min lead time or >30-day advance in generation (`SlotService.getDoctorSlotsForDate`), hold, and booking alignment checks
- [x] **P1-8** (`fc7fedb`): Slot-hold hoarding prevention: max 1 active hold lease per patient in Redis (`active_hold:<patientId>`) with auto-release of old holds, `DELETE /appointments/hold` endpoint with frontend release button, and PATIENT-role restriction on hold & book
- [x] **P1-9** (`360ac35`): Doctor search SQL pagination, Haversine geo distance formula (`6371 * acos(...)`), SQL rating filter, AND intersection for symptom+specialty, and batched Redis `MGET` next slot lookups
- [x] **P1-10** (`a271629`): Doctor notifications & emails on booking/cancel/refund, HTML email escaping (`escapeHtml`), `POST /notifications/read-all`, and Navbar Notification Bell with unread badge + popover dropdown
- [x] **P1-11** (`bdab0a2`): Real admin endpoints & dashboard (`/admin/stats`, `/admin/ledgers`, `/admin/audit-logs`, `/admin/payments/reconcile`), real doctor clinical workspace (`/doctors/me/dashboard`, today's queue, 7-day earnings chart, dry-run leave conflict preview & cascade refund, verified reviews)
- [x] **P1-12** (`11f273e`): Doctor registration & onboarding flow in UI, pending verification banner (`ShieldAlert`), doctor profile management (`/doctors/me/profile`), and weekly schedule availability editor (`/doctors/me/availability`)
- [x] **P1-13** (`7e2bbe2`): 3-way consultation mode selector (`VIDEO | IN_CLINIC | CHAT`) in slot picker and booking flow, conditional LiveKit video token minting (restricted strictly to `VIDEO` mode, 400 for `IN_CLINIC`/`CHAT`), and dedicated chamber/chat views in consultation room
- [x] **P1-14** (`ad0751a`): Concurrency row-locking (`FOR UPDATE`) on prescription creation & updates, patient notification dispatch (`PRESCRIPTION_ISSUED` / `PRESCRIPTION_UPDATED`), and interactive multi-medicine form with validation in clinical workspace
- [x] **P1-15** (`8981c46`): Cursor pagination & status/date/mode filters on appointment lists (`getMyAppointments`), limit+1 cursor pagination, date range & mode filters, Next.js interactive filter toolbar and Load More pagination

## Phase 3 — P2: Backend Quality / Performance
- [x] **P2-1** (`88d36d2`): Configurable `PLATFORM_COMMISSION_BPS` (remove magic number 1000 repeated in 6 places)
- [x] **P2-2** (`88bcbb2`): Single source of truth for timezone (`CLINIC_TIMEZONE` in shared & api)
- [x] **P2-3** (`bf2b81f`): Invalidate `cache:next_slot:{doctor}` and emit `slot_freed` event on appointment expiration
- [x] **P2-4** (`939c9dd`): `bookAppointment`: Redis failure after DB commit made best-effort with logging; inspect `meta.target` for unique constraint errors
- [x] **P2-5** (`812e262`): Slot grid: validate availability rows (no overlap, start<end, duration divides window) and dedupe overlapping slots
- [x] **P2-6** (`7686a5c`): Presigned PUT ContentLength bound and HeadObject verification, attachment metadata table, magic byte MIME scan, path confinement under `appointments/{id}/`
- [x] **P2-7** (`160ade8`): LiveKit token: display real names instead of "Attending Doctor/Patient", reject non-VIDEO modes, append device suffix to identity
- [x] **P2-8** (`9048d59`): Socket.IO auth: header/auth only (no token in query string), periodic re-validation, disconnect on token expiry
- [x] **P2-9** (`a73c16b`): FakePaymentProvider persistence in Redis so multi-instance api reconciliation doesn't falsely mark orders FAILED
- [x] **P2-10** (`83b83af`): DB indexes: `appointments(status, created_at)`, `outbox_events(status, created_at)`, `notifications(user_id, read_at, created_at)`, `chat_messages(appointment_id, created_at)`, and outbox retention purge job
- [x] **P2-11** (`fb6c1e6`): Metrics label cardinality protection (use route patterns instead of raw `request.url`), add business metrics (bookings, captures, refunds, DLQ size)
- [x] **P2-12** (`805af01`): Gate dev-only endpoints behind `ENABLE_DEV_ENDPOINTS` flag (must be false in production, do not register routes otherwise)
- [x] **P2-13** (`25b76a3`): Ambulance rate limit & active request cap per user, service area coordinate validation, cascade race condition review
- [x] **P2-14** (`7e9c236`): AI gateway rate limiting, request size caps, 3s timeout with safe fallback when AI service is down
- [x] **P2-15** (`b179456`): Replace `any` in services (`tx: any`, `body: any`) with Prisma `TransactionClient` and Zod-inferred types

## Phase 4 — Frontend Bugs (`apps/web`)
- [x] **F-1** (`65cb7bc`): Single-flight token refresh in `src/lib/api.ts` with request queue and 204 handling
- [x] **F-2** (`2e68ee3`): Real logout calling `POST /auth/logout`, clearing TanStack Query cache, disconnecting sockets
- [x] **F-3** (`2e68ee3`): `AuthProvider` + `useAuth()` keeping access token in memory with httpOnly bootstrap via `GET /auth/me`
- [x] **F-4** (`db2473c`): Eliminate hydration mismatches across appointments, consultation, passport with ClientTime
- [x] **F-5** (`94e6261`): Prevent open redirect in login page (`startsWith('/') && !startsWith('//')`)
- [x] **F-6** (`94e6261`): Gate demo credentials behind `NEXT_PUBLIC_SHOW_DEMO_LOGINS=true`, remove dev jargon from copy
- [x] **F-7** (`42fb723`): Truthful doctor page claims, policy-driven text, calendar date picker, slot legend
- [x] **F-8** (`09f5dc1`): Consultation page improvements (LiveKit window countdown/retry, dynamic socket auth token callback, remove audio elements on disconnect, mic/cam permission error handling, 3s typing timeout, red phone confirmation)
- [x] **F-9** (`a157cb3`): Real Razorpay Checkout.js integration on checkout page
- [x] **F-10** (`410052b`): Emergency page: reverse-geocode, manual address + coordinate fallback on GPS denial, Call 112/108 primary action
- [x] **F-11** (`cc550be`): Dark mode clean implementation with `next-themes` and zero hydration mismatch
- [x] **F-12** (`b779b3f`): Mobile responsive navigation drawer, role-based navigation links, sticky checkout CTA
- [x] **F-13** (`0505c55`): Add Next.js App Router root & segment `error.tsx`, `not-found.tsx`, `global-error.tsx`, and RoleGuard
- [x] **F-14** (`e960b4b`): Complete user-facing i18n translations for English, Hindi, and Bengali
- [x] **F-15** (`88a2c9e`): Replace browser alerts with toast notifications, slot refetching on hold

## Phase 5 — UI / UX Polish
- [x] **UI-1** (`ea7e03b`): Touch targets audit (minimum 44x44px for buttons, links, controls) & focus-visible rings
- [x] **UI-2** (`ea7e03b`): WCAG AA contrast compliance in dark/light mode across status pills and emergency badges
- [x] **UI-3** (`ea7e03b`): Telemedicine Practice Guidelines (2020) compliance disclaimers and verified badges across patient flows
- [x] **UI-4** (`ea7e03b`): Form validation styling, aria-labels, and screen-reader accessible attributes across auth and booking

## Phase 6 — Infra, CI, Docs
- [x] **I-1** (`ea026c4`): Harden docker-compose.yml: strict environment secret validation, localhost-bound admin ports, healthchecks
- [x] **I-2** (`ea026c4`): Nginx configuration: secure proxy headers, rate limiting, and websocket upgrade support
- [x] **I-3** (`ea026c4`): CI workflow verification on `main` only (Testcontainers, Web checks, AI evals)
- [x] **I-4** (`PROGRESS.md`): Documentation: Update README.md and PROGRESS.md with full remediation details and runbook
