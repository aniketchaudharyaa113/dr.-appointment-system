-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- Create Enums
CREATE TYPE "UserRole" AS ENUM ('PATIENT', 'DOCTOR', 'ADMIN', 'DRIVER');
CREATE TYPE "DoctorVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "ConsultationMode" AS ENUM ('IN_CLINIC', 'VIDEO', 'CHAT');
CREATE TYPE "AppointmentStatus" AS ENUM ('HELD', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'REFUNDED');
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'CAPTURED', 'FAILED', 'REFUNDED');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');
CREATE TYPE "ConsultationSessionStatus" AS ENUM ('SCHEDULED', 'WAITING', 'LIVE', 'ENDED');
CREATE TYPE "AmbulanceRequestStatus" AS ENUM ('REQUESTED', 'OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'CLAIMED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "LedgerAccountType" AS ENUM ('PATIENT_RECEIVABLE', 'ESCROW', 'DOCTOR_PAYABLE', 'PLATFORM_REVENUE');
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBIT', 'CREDIT');

-- USERS TABLE
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "role" "UserRole" NOT NULL DEFAULT 'PATIENT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- REFRESH TOKENS TABLE
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "refresh_tokens_user_id_is_revoked_idx" ON "refresh_tokens"("user_id", "is_revoked");

-- DOCTORS TABLE
CREATE TABLE "doctors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "specialty" VARCHAR(100) NOT NULL,
    "qualifications" VARCHAR(255),
    "experience_years" INTEGER NOT NULL DEFAULT 0,
    "clinic_name" VARCHAR(255),
    "clinic_address" VARCHAR(255),
    "clinic_lat" DECIMAL(9,6),
    "clinic_lng" DECIMAL(9,6),
    "consultation_fee_paise" INTEGER NOT NULL DEFAULT 0,
    "license_number" VARCHAR(100),
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verification_status" "DoctorVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "photo_url" VARCHAR(255),
    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "doctors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "doctors_user_id_key" ON "doctors"("user_id");
CREATE INDEX "doctors_specialty_is_verified_idx" ON "doctors"("specialty", "is_verified");
CREATE INDEX "idx_doctors_specialty_trgm" ON "doctors" USING gin ("specialty" gin_trgm_ops);

-- AVAILABILITY TABLE
CREATE TABLE "availability" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" VARCHAR(8) NOT NULL,
    "end_time" VARCHAR(8) NOT NULL,
    "slot_duration_minutes" INTEGER NOT NULL DEFAULT 15,
    CONSTRAINT "availability_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "availability_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "availability_doctor_id_day_of_week_idx" ON "availability"("doctor_id", "day_of_week");

-- DOCTOR LEAVES TABLE
CREATE TABLE "doctor_leaves" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "doctor_leaves_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "doctor_leaves_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "doctor_leaves_doctor_id_start_date_end_date_idx" ON "doctor_leaves"("doctor_id", "start_date", "end_date");

-- DOCTOR DAILY COUNTERS TABLE
CREATE TABLE "doctor_daily_counters" (
    "doctor_id" UUID NOT NULL,
    "booking_date" DATE NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "doctor_daily_counters_pkey" PRIMARY KEY ("doctor_id", "booking_date"),
    CONSTRAINT "doctor_daily_counters_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- APPOINTMENTS TABLE
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_ref" VARCHAR(20),
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "slot_time" TIMESTAMP(3) NOT NULL,
    "consultation_mode" "ConsultationMode" NOT NULL DEFAULT 'VIDEO',
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "cancellation_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "appointments_booking_ref_key" ON "appointments"("booking_ref");
CREATE INDEX "appointments_patient_id_status_idx" ON "appointments"("patient_id", "status");
CREATE INDEX "appointments_doctor_id_slot_time_idx" ON "appointments"("doctor_id", "slot_time");

-- CRITICAL RULE 1: PARTIAL UNIQUE INDEX PREVENTING DOUBLE BOOKING ON ACTIVE SLOTS
CREATE UNIQUE INDEX "idx_appointments_doctor_slot_active"
ON "appointments"("doctor_id", "slot_time")
WHERE "status" IN ('PENDING_PAYMENT', 'CONFIRMED');

-- PAYMENTS TABLE
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'RAZORPAY',
    "provider_order_id" VARCHAR(100) NOT NULL,
    "provider_payment_id" VARCHAR(100),
    "amount_paise" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "idempotency_key" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payments_appointment_id_key" ON "payments"("appointment_id");
CREATE UNIQUE INDEX "payments_provider_order_id_key" ON "payments"("provider_order_id");
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- PAYMENT EVENTS (WEBHOOK INBOX)
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_event_id" VARCHAR(150) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider_event_id");
CREATE INDEX "payment_events_status_created_at_idx" ON "payment_events"("status", "created_at");

-- REFUNDS TABLE
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "provider_refund_id" VARCHAR(100),
    "amount_paise" INTEGER NOT NULL,
    "reason" VARCHAR(255),
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- LEDGER ENTRIES TABLE (DOUBLE-ENTRY)
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "account_type" "LedgerAccountType" NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");
CREATE INDEX "ledger_entries_account_type_entry_type_idx" ON "ledger_entries"("account_type", "entry_type");

-- CONSULTATION SESSIONS TABLE
CREATE TABLE "consultation_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "room_name" VARCHAR(100) NOT NULL,
    "status" "ConsultationSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "patient_consent_given" BOOLEAN NOT NULL DEFAULT false,
    "consent_timestamp" TIMESTAMP(3),
    CONSTRAINT "consultation_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consultation_sessions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "consultation_sessions_appointment_id_key" ON "consultation_sessions"("appointment_id");
CREATE UNIQUE INDEX "consultation_sessions_room_name_key" ON "consultation_sessions"("room_name");

-- PRESCRIPTIONS TABLE
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "medicines" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "advice" TEXT,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prescriptions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "prescriptions_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "prescriptions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "prescriptions_appointment_id_key" ON "prescriptions"("appointment_id");
CREATE INDEX "prescriptions_patient_id_idx" ON "prescriptions"("patient_id");
CREATE INDEX "prescriptions_doctor_id_idx" ON "prescriptions"("doctor_id");

-- PRESCRIPTION VERSIONS TABLE
CREATE TABLE "prescription_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prescription_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "medicines" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "advice" TEXT,
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prescription_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prescription_versions_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "prescription_versions_prescription_id_version_key" ON "prescription_versions"("prescription_id", "version");

-- REVIEWS TABLE
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reviews_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reviews_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reviews_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "reviews_appointment_id_key" ON "reviews"("appointment_id");
CREATE INDEX "reviews_doctor_id_rating_idx" ON "reviews"("doctor_id", "rating");

-- WAITLISTS TABLE
CREATE TABLE "waitlists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "slot_date" DATE NOT NULL,
    "slot_time" VARCHAR(20),
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "offered_at" TIMESTAMP(3),
    "claim_expires_at" TIMESTAMP(3),
    "hold_token" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "waitlists_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "waitlists_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "waitlists_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "waitlists_doctor_id_slot_date_status_idx" ON "waitlists"("doctor_id", "slot_date", "status");

-- AMBULANCE DRIVER PROFILES TABLE
CREATE TABLE "ambulance_driver_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "vehicle_number" VARCHAR(50) NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "last_lat" DECIMAL(9,6),
    "last_lng" DECIMAL(9,6),
    "last_heartbeat_at" TIMESTAMP(3),
    CONSTRAINT "ambulance_driver_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ambulance_driver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ambulance_driver_profiles_user_id_key" ON "ambulance_driver_profiles"("user_id");

-- AMBULANCE REQUESTS TABLE
CREATE TABLE "ambulance_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "driver_id" UUID,
    "pickup_lat" DECIMAL(9,6) NOT NULL,
    "pickup_lng" DECIMAL(9,6) NOT NULL,
    "pickup_address" VARCHAR(255) NOT NULL,
    "status" "AmbulanceRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "eta_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ambulance_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ambulance_requests_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ambulance_requests_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "ambulance_driver_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ambulance_requests_status_created_at_idx" ON "ambulance_requests"("status", "created_at");

-- OUTBOX EVENTS TABLE
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aggregate_type" VARCHAR(50) NOT NULL,
    "aggregate_id" VARCHAR(100) NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");

-- AUDIT LOGS TABLE
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "resource_id" VARCHAR(100),
    "details" JSONB,
    "ip_address" VARCHAR(50),
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");
CREATE INDEX "audit_logs_resource_resource_id_idx" ON "audit_logs"("resource", "resource_id");

-- SYMPTOM SPECIALTY MAP TABLE
CREATE TABLE "symptom_specialty_map" (
    "id" SERIAL NOT NULL,
    "symptom" VARCHAR(100) NOT NULL,
    "specialty" VARCHAR(100) NOT NULL,
    CONSTRAINT "symptom_specialty_map_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "symptom_specialty_map_symptom_idx" ON "symptom_specialty_map"("symptom");
CREATE INDEX "idx_symptom_specialty_trgm" ON "symptom_specialty_map" USING gin ("symptom" gin_trgm_ops);

-- CHAT MESSAGES TABLE
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "appointment_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "sender_role" "UserRole" NOT NULL,
    "content" TEXT NOT NULL,
    "attachment_url" VARCHAR(500),
    "attachment_type" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'SENT',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_messages_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "chat_messages_appointment_id_created_at_idx" ON "chat_messages"("appointment_id", "created_at");

