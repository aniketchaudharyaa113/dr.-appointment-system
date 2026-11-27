-- CreateEnum
CREATE TYPE "SecurityTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "refresh_tokens"
  ADD COLUMN IF NOT EXISTS "revoked_reason" VARCHAR(30);

-- CreateTable
CREATE TABLE "user_security_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "type" "SecurityTokenType" NOT NULL,
  "token_hash" VARCHAR(255) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_security_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_security_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "user_security_tokens_token_hash_key" ON "user_security_tokens"("token_hash");
CREATE INDEX "user_security_tokens_user_id_type_idx" ON "user_security_tokens"("user_id", "type");

-- CreateIndex (Prevent concurrent active ambulance requests per patient)
CREATE UNIQUE INDEX "idx_ambulance_patient_active"
  ON "ambulance_requests" ("patient_id")
  WHERE status IN ('REQUESTED', 'OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED');
