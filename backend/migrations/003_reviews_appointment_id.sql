-- Migration 003: Link reviews uniquely to completed appointments

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS appointment_id UUID;

-- Backfill existing reviews if any
DO $$
DECLARE
    r RECORD;
    appt_id UUID;
BEGIN
    FOR r IN SELECT id, doctor_id, patient_id FROM reviews WHERE appointment_id IS NULL LOOP
        SELECT id INTO appt_id FROM appointments
        WHERE doctor_id = r.doctor_id AND patient_id = r.patient_id AND status = 'COMPLETED'
          AND id NOT IN (SELECT appointment_id FROM reviews WHERE appointment_id IS NOT NULL)
        LIMIT 1;
        IF appt_id IS NOT NULL THEN
            UPDATE reviews SET appointment_id = appt_id WHERE id = r.id;
        END IF;
    END LOOP;
END $$;

-- Add foreign key and unique constraint
ALTER TABLE reviews
  DROP CONSTRAINT IF EXISTS fk_reviews_appointment,
  DROP CONSTRAINT IF EXISTS reviews_appointment_id_key;

ALTER TABLE reviews
  ADD CONSTRAINT fk_reviews_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  ADD CONSTRAINT reviews_appointment_id_key UNIQUE (appointment_id);
