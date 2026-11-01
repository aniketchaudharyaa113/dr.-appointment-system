-- Migration 009: Enable pg_trgm extension and add trigram indexes for similarity search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_symptom_trgm
  ON symptom_specialty_map USING gin (symptom gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_doctors_specialty_trgm
  ON doctors USING gin (specialty gin_trgm_ops);
