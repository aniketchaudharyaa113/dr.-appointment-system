-- Drop full unique constraint to allow rebooking of cancelled slots
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_doctor_id_slot_time_key;

-- Add partial unique index only for active (PENDING, CONFIRMED) appointments
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_doctor_slot_active
ON appointments(doctor_id, slot_time)
WHERE status IN ('PENDING', 'CONFIRMED');
