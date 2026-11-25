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
