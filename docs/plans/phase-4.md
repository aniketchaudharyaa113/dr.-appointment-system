# Phase 4 Plan: Payments (Razorpay, Provider-Abstracted & Double-Entry Ledger)

## Objectives
1. Implement `PaymentProvider` interface:
   - `createOrder(params)`: creates an order with integer paise.
   - `verifyWebhookSignature(rawBody, signature, secret)`: raw-body HMAC-SHA256 signature verification.
   - `issueRefund(params)`: initiates refund in integer paise.
   - Implement `RazorpayProvider` (calls Razorpay SDK/API with sandbox credentials).
   - Implement `FakeProvider` (used in test/dev: can simulate instant success, payment failure, delayed webhook, duplicate webhook).
   - Implement `StripeProvider` stub (conforms to interface for Stripe readiness).
2. Payment State Machine & Invariants:
   - State machine: `INITIATED -> PENDING -> CAPTURED -> SETTLED | REFUNDED` and appointment lifecycle `HELD -> PENDING_PAYMENT -> CONFIRMED -> IN_PROGRESS -> COMPLETED`.
   - Money stored strictly in integer paise (`amount_paise`). No floating-point math anywhere.
3. Webhook Inbox & Worker Processing:
   - Webhook controller receives raw body and headers.
   - Verifies HMAC signature. Rejects invalid signatures with HTTP 400.
   - Inserts into `payment_events` table with `UNIQUE(provider_event_id)`. If duplicate event arrives, duplicate constraint / catch returns HTTP 200 no-op.
   - Dispatches background job (or processes within transactional boundary):
     - `SELECT ... FOR UPDATE` payment row to prevent concurrency races.
     - Validates state transition.
     - Marks payment `CAPTURED`.
     - Transitions appointment to `CONFIRMED`.
     - Posts balanced double-entry ledger entries (`debit_amount == credit_amount`).
     - Publishes transactional outbox events for patient/doctor notification and calendar sync.
4. Concurrency & Failure Mitigations:
   - Concurrent webhook replay (10x flood): idempotency key and `payment_events` unique constraint ensure exactly 1 execution and 1 ledger balance entry.
   - Late payment after hold expired & slot lost: detects that slot was taken by another user or hold lapsed, automatically calls `issueRefund` to return money to patient without double-booking.
   - Reconciliation job: queries stuck `PENDING_PAYMENT` / `INITIATED` transactions older than 15 minutes, checks provider status, settles or auto-refunds.
   - Refund policy: cancellation > 24h = 100% full refund; < 24h = partial or policy defined; doctor cancellation = 100% full refund.
5. Verification & Tests:
   - `same-webhook-replay.spec.ts`: 10x concurrent webhook replay results in exactly 1 ledger posting and 0 race conditions.
   - `bad-signature.spec.ts`: Webhooks with forged or mismatched HMAC signatures are rejected immediately.
   - `out-of-order-events.spec.ts`: Late or out-of-order events do not corrupt the payment state machine.
   - `late-payment-refund.spec.ts`: Payment captured after slot hold lapsed and slot rebooked triggers automated refund fallback.
   - `ledger-balance.spec.ts`: Invariant verification that sum of debits equals sum of credits for every transaction.
   - `reconciliation.spec.ts`: Recovering lost webhooks via periodic reconciliation.
