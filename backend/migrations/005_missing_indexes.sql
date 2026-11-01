CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_doctor_id ON reviews(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doc_status_slot ON appointments(doctor_id, status, slot_time);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_slot ON appointments(patient_id, slot_time DESC);
