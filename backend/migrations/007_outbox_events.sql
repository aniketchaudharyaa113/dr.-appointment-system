-- Up Migration: 007_outbox_events.sql
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending ON outbox_events (created_at ASC) WHERE status = 'PENDING';

---
-- Down Migration
DROP INDEX IF EXISTS idx_outbox_events_pending;
DROP TABLE IF EXISTS outbox_events;
