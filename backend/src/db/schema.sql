-- MediBook schema
-- Run this once against your PostgreSQL database:
--   psql -U username -d medibook -f src/db/schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gives us gen_random_uuid()

-- ==========================================================
-- USERS  (patients, doctors, and admins all live here)
-- ==========================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,        -- bcrypt hash, never plain text
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(20) NOT NULL DEFAULT 'PATIENT'
    CHECK (role IN ('PATIENT', 'DOCTOR', 'ADMIN')),
  created_at TIMESTAMP DEFAULT now()
);

-- ==========================================================
-- DOCTORS  (1:1 extension of a user with role = DOCTOR)
-- ==========================================================
CREATE TABLE IF NOT EXISTS doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  specialty VARCHAR(100) NOT NULL,
  qualifications VARCHAR(255),
  experience_years INT DEFAULT 0,
  clinic_name VARCHAR(255),
  clinic_address VARCHAR(255),
  clinic_lat DECIMAL(9,6),
  clinic_lng DECIMAL(9,6),
  consultation_fee DECIMAL(10,2) DEFAULT 0,
  license_number VARCHAR(100),
  is_verified BOOLEAN NOT NULL DEFAULT false,
  photo_url VARCHAR(255)
);

-- ==========================================================
-- AVAILABILITY  (a doctor's weekly working hours)
-- ==========================================================
CREATE TABLE IF NOT EXISTS availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes INT NOT NULL DEFAULT 15
);

-- ==========================================================
-- APPOINTMENTS
-- The UNIQUE constraint below is what makes double-booking
-- impossible at the database level, even under concurrent requests.
-- ==========================================================
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  slot_time TIMESTAMP NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
  notes TEXT,
  booking_ref VARCHAR(20) UNIQUE,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE (doctor_id, slot_time)
);

-- Tracks the last token number issued per doctor per day, so booking_ref
-- generation is race-safe under concurrent bookings (see appointmentController).
CREATE TABLE IF NOT EXISTS doctor_daily_counters (
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  last_seq INT NOT NULL DEFAULT 0,
  PRIMARY KEY (doctor_id, booking_date)
);

-- ==========================================================
-- REVIEWS
-- ==========================================================
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- ==========================================================
-- SYMPTOM -> SPECIALTY LOOKUP  (static, seeded once — no AI)
-- ==========================================================
CREATE TABLE IF NOT EXISTS symptom_specialty_map (
  id SERIAL PRIMARY KEY,
  symptom VARCHAR(100) NOT NULL,
  specialty VARCHAR(100) NOT NULL
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON doctors(specialty);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
