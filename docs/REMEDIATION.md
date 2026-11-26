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
- [ ] **P0-14**: Public data leak fixes (`GET /ambulance/drivers/online` auth, explicit Doctor public DTO + 404 unverified, strip ledger for non-admin, generic 500 in prod, protect Swagger, Helmet CSP)

## Phase 2 — P1: Broken or Missing Core Flows
- [ ] **P1-1** – **P1-15**: (Pending Phase 1 completion)

## Phase 3 — P2: Backend Quality / Performance
- [ ] **P2-1** – **P2-15**: (Pending Phase 2 completion)

## Phase 4 — Frontend Bugs (`apps/web`)
- [ ] **F-1** – **F-15**: (Pending Phase 3 completion)

## Phase 5 — UI / UX Polish
- [ ] Design system, forms & accessibility, flows, content & trust (Pending Phase 4 completion)

## Phase 6 — Infra, CI, Docs
- [ ] **I-1** – **I-7**: (Pending Phase 5 completion)
