# MediBook Remediation Tracker

All fixes are committed atomically on `main` (baseline tag: `pre-agent-baseline`).

## Phase 1 — P0: Security, Money, Data Integrity
- [ ] **P0-1**: Public registration restricted to `PATIENT` / `DOCTOR` only; `ADMIN` / `DRIVER` via seed or admin-only endpoint + RBAC regression test
- [ ] **P0-2**: Doctor leave `applyLeave` / `previewLeave` ownership check (`doctor.userId === user.sub`), reject past start dates & overlapping leaves
- [ ] **P0-3**: Worker refund dispatch calls real payment provider idempotently (no fake `rfnd_worker_*`), retries/DLQ on failure, notifies only on success
- [ ] **P0-4**: Unified `RefundPolicyService` used by cancel, refund, and doctor leave in one transaction (lock, cancel, Refund row, ledger reversal, outbox)
- [ ] **P0-5**: Block refunds for `COMPLETED`/`IN_PROGRESS`/`NO_SHOW`/past slots (except `ADMIN`); restrict cancel to `PENDING_PAYMENT`/`CONFIRMED`/`HELD`
- [ ] **P0-6**: Webhook `payment_events` insert inside processing transaction (or re-process `PENDING` on duplicate) + crash-recovery test
- [ ] **P0-7**: Webhook amount/currency verification, `X-Razorpay-Event-Id` header dedup, real `RazorpayProvider.fetchPaymentStatus`
- [ ] **P0-8**: Shared `applyCapture(tx, payment)` for webhook & `reconcileStuckPayments`; no resurrecting cancelled/expired appointments; emit outbox events
- [ ] **P0-9**: Payment retry after `FAILED` reuses/resets existing `Payment` row in transaction + fail->retry->capture test
- [ ] **P0-10**: Reject `PAYMENT_PROVIDER=FAKE` when `NODE_ENV=production`; `GET /api/payments/config`; gate simulator UI
- [ ] **P0-11**: Remove default secret fallbacks in `docker-compose.yml` (`${VAR:?required}`), reject weak secrets in production, bind admin ports to `127.0.0.1`
- [ ] **P0-12**: Fastify `trustProxy`, `req.ip`, nginx `X-Forwarded-For $remote_addr`, atomic login rate limit, rate-limit register/hold/book/ambulance/ai
- [ ] **P0-13**: Auth hardening (`isActive` check cached in Redis, `algorithms: ['HS256']`, `JWT_EXPIRES_IN`, atomic refresh rotation w/ grace window, uniform login timing, P2002->409, password max length/strength, refresh cleanup)
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
