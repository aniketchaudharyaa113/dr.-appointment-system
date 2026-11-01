-- Migration 004: Prescription versions table for auditing edits

CREATE TABLE IF NOT EXISTS prescription_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  diagnosis TEXT NOT NULL,
  medicines JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  version INT NOT NULL DEFAULT 1,
  saved_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_versions_prescription
ON prescription_versions(prescription_id, version DESC);
