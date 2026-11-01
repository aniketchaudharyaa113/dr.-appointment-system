-- Migration 008: waitlists table and indexes
CREATE TABLE IF NOT EXISTS waitlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  slot_time VARCHAR(25),
  status VARCHAR(20) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'OFFERED', 'CLAIMED', 'EXPIRED', 'CANCELLED')),
  offered_at TIMESTAMP,
  claim_expires_at TIMESTAMP,
  hold_token VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlists_unique_active
  ON waitlists(doctor_id, patient_id, slot_date, COALESCE(slot_time, 'ALL'))
  WHERE status IN ('WAITING', 'OFFERED');

CREATE INDEX IF NOT EXISTS idx_waitlists_queue
  ON waitlists(doctor_id, slot_date, created_at ASC)
  WHERE status = 'WAITING';
