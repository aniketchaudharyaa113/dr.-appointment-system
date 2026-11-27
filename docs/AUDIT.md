# MediBook Security, Invariant & Mutation Audit

This document records real Testcontainers integration test results and **mutation proofs** where each protecting index, lock, or authorization guard is temporarily removed, shown to FAIL, then restored and shown to PASS.

---

## Slice 1 Mutation Proofs

### 1. Partial Unique Index (`idx_appointments_doctor_slot_active`) — Prevents Double Booking Under 50-Way Concurrency

- **Test:** `test/slice1-booking-race.spec.ts` → `50 parallel bookings against real Postgres partial unique index -> exactly 1 winner`
- **Mutation:** Temporarily commented out `CREATE UNIQUE INDEX "idx_appointments_doctor_slot_active"` in `apps/api/prisma/migrations/0_init/migration.sql`.
- **Output WITHOUT guard (FAIL):**
```text
 ❯ test/slice1-booking-race.spec.ts (5 tests | 1 failed | 4 skipped) 2918ms
   × Slice 1: Real Postgres & Redis Booking, Holds, Concurrency & IST Timezone > 50 parallel bookings against real Postgres partial unique index -> exactly 1 winner 2743ms
     → expected [ Array(50) ] to have a length of 1 but got 50

FAIL  test/slice1-booking-race.spec.ts > Slice 1: Real Postgres & Redis Booking, Holds, Concurrency & IST Timezone > 50 parallel bookings against real Postgres partial unique index -> exactly 1 winner
AssertionError: expected [ Array(50) ] to have a length of 1 but got 50
- Expected: 1
+ Received: 50
 ❯ test/slice1-booking-race.spec.ts:79:25
```
- **Output AFTER restoring guard (PASS):**
  Verified in `slice1-booking-race.spec.ts` (all 5 tests passed against real `pgvector/pgvector:pg16` + `redis:7-alpine`).

---

### 2. Webhook Idempotency (`UNIQUE(provider_event_id)` + `FOR UPDATE` + `CAPTURED` Guard) — Prevents Duplicate Ledger Postings

- **Test:** `test/slice1-payments-webhook.spec.ts` → `Webhook x10 concurrent replay -> exactly ONE ledger posting and debits == credits`
- **Mutation:** Temporarily bypassed `paymentEvent.create` uniqueness check and the `payment.status === 'CAPTURED'` guard inside `PaymentService.processWebhook`.
- **Output WITHOUT guard (FAIL):**
```text
 ❯ test/slice1-payments-webhook.spec.ts (5 tests | 1 failed | 4 skipped) 1901ms
   × Slice 1: Real Razorpay-Style RawBody Webhooks, Ledger, Late Payment & Refunds > Webhook x10 concurrent replay -> exactly ONE ledger posting and debits == credits 1606ms
     → expected [ { …(7) }, { …(7) }, { …(7) }, …(27) ] to have a length of 3 but got 30

FAIL  test/slice1-payments-webhook.spec.ts > Slice 1: Real Razorpay-Style RawBody Webhooks, Ledger, Late Payment & Refunds > Webhook x10 concurrent replay -> exactly ONE ledger posting and debits == credits
AssertionError: expected [ { …(7) }, { …(7) }, { …(7) }, …(27) ] to have a length of 3 but got 30
- Expected: 3
+ Received: 30
 ❯ test/slice1-payments-webhook.spec.ts:185:27
```
- **Output AFTER restoring guard (PASS):**
  Verified in `slice1-payments-webhook.spec.ts` (strictly 3 ledger entries posted, `debits == credits == 90000`).

---

### 3. Redis Hold Token Ownership Guard — Rejects Unowned / Stolen Hold Tokens

- **Test:** `test/slice1-booking-race.spec.ts` → `Hold token is unguessable in Redis, verified at booking, and booking creates PENDING_PAYMENT`
- **Mutation:** Temporarily commented out `if (held.patientId !== patientId || held.token !== holdToken)` in `BookingService.bookAppointment`.
- **Output WITHOUT guard (FAIL):**
```text
 ❯ test/slice1-booking-race.spec.ts (5 tests | 1 failed | 4 skipped) 1555ms
   × Slice 1: Real Postgres & Redis Booking, Holds, Concurrency & IST Timezone > Hold token is unguessable in Redis, verified at booking, and booking creates PENDING_PAYMENT 1365ms
     → expected 201 to be 403 // Object.is equality

FAIL  test/slice1-booking-race.spec.ts > Slice 1: Real Postgres & Redis Booking, Holds, Concurrency & IST Timezone > Hold token is unguessable in Redis, verified at booking, and booking creates PENDING_PAYMENT
AssertionError: expected 201 to be 403 // Object.is equality
- Expected: 403
+ Received: 201
 ❯ test/slice1-booking-race.spec.ts:126:34
```
- **Output AFTER restoring guard (PASS):**
  Verified in `slice1-booking-race.spec.ts` (unowned hold token rejected with 403, valid hold transitions to `PENDING_PAYMENT`).

---

## Slice 4 Mutation Proofs

### 4. Atomic Conditional Update (`status: 'OFFERED'`) — Prevents Multi-Accept Race on Ambulance Dispatch

- **Test:** `test/slice4-ambulance.spec.ts` → `guarantees atomic single winner across 10 parallel acceptRequest attempts`
- **Mutation:** Temporarily commented out `status: 'OFFERED'` in `AmbulanceService.acceptRequest`'s `updateMany` `where` clause.
- **Output WITHOUT guard (FAIL):**
```text
 ❯ test/slice4-ambulance.spec.ts (4 tests | 1 failed | 3 skipped) 1598ms
   × Slice 4: Real Ambulance Dispatch, 20s Timeout Reassignment, Atomic Accept, Heartbeat Eviction & Live Socket Tracking > guarantees atomic single winner across 10 parallel acceptRequest attempts 1415ms
     → expected [ { raw: { …(2) }, …(10) }, …(9) ] to have a length of 1 but got 10

FAIL  test/slice4-ambulance.spec.ts > Slice 4: Real Ambulance Dispatch, 20s Timeout Reassignment, Atomic Accept, Heartbeat Eviction & Live Socket Tracking > guarantees atomic single winner across 10 parallel acceptRequest attempts
AssertionError: expected [ { raw: { …(2) }, …(10) }, …(9) ] to have a length of 1 but got 10
- Expected: 1
+ Received: 10
 ❯ test/slice4-ambulance.spec.ts:277:22
```
- **Output AFTER restoring guard (PASS):**
  Verified in `slice4-ambulance.spec.ts` (4/4 passed against real `pgvector/pgvector:pg16` + `redis:7-alpine`: 1 accepted `201`, 10 conflicting/unoffered rejected `409`).

---

## Security Audit Remediation Proofs (WS1–WS6, Defects B1–B28)

New real-infrastructure integration & unit suites added on `main` to reproduce and verify all 28 audit findings (`pgvector/pgvector:pg16`, `redis:7-alpine`, real Mailpit/MinIO containers, FastAPI `TestClient`, Playwright + Axe):

| Workstream | Test Suite | Defects Covered | Verification Environment |
| --- | --- | --- | --- |
| **WS1** (`3ce5543`) | `apps/api/test/ws1-payments-refunds.spec.ts` | `B1, B6, B7, B8, B11, B12, B13` | Testcontainers Postgres + Redis |
| **WS2** (`74a27ec`) | `apps/api/test/ws2-consultation-noshow.spec.ts` | `B2, B3, B9, B19, B21, B22` | Testcontainers Postgres + Redis + Shared Logic |
| **WS3** (`99a1930`) | `apps/api/test/ws3-concurrency-waitlist-tz.spec.ts` | `B8, B10, B14, B16, B17, B18, B22` | Testcontainers Postgres + Redis + Shared Logic |
| **WS4** (`b8039aa`) | `apps/api/test/ws4-auth-privacy-ambulance.spec.ts`, `apps/web/test/api.test.ts` | `B5, B15, B20, B23, B25` | Testcontainers Postgres + Redis + Node test runner |
| **WS5** (`c91855d`) | `apps/api/test/ws5-ai-infra-hardening.spec.ts`, `apps/worker/test/worker.spec.ts`, `services/ai/evals/test_evals.py` | `B4, B24, B27, B28` | Testcontainers Postgres + Redis + Mailpit + FastAPI TestClient (`7/7 passed`) |
| **WS6** | `apps/api/test/ws6-performance-search.spec.ts`, `e2e/*.spec.ts` | `B26` + Full E2E (`5/5`) | Testcontainers Postgres + Redis + Full Docker Compose + Playwright/Axe |
