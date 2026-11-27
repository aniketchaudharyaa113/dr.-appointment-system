-- AlterTable
ALTER TABLE "consultation_sessions"
  ADD COLUMN IF NOT EXISTS "doctor_joined_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "patient_joined_at" TIMESTAMPTZ(6);
