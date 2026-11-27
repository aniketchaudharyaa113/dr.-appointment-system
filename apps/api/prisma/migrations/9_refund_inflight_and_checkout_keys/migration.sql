-- Workstream 1: Refund IN_FLIGHT locking state, lastError tracking & appointment-bound checkout idempotency keys
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'IN_FLIGHT';

ALTER TABLE "refunds"
  ADD COLUMN IF NOT EXISTS "last_error" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS "checkout_idempotency_keys" (
  "idempotency_key" VARCHAR(100) NOT NULL,
  "appointment_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "checkout_idempotency_keys_pkey" PRIMARY KEY ("idempotency_key"),
  CONSTRAINT "checkout_idempotency_keys_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "checkout_idempotency_keys_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "checkout_idempotency_keys_payment_id_idx"
  ON "checkout_idempotency_keys"("payment_id");
