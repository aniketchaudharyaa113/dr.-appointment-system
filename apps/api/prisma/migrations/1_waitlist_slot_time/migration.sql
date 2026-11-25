-- Widen waitlists.slot_time from VARCHAR(20) to VARCHAR(40) to store ISO 8601 timestamps
ALTER TABLE "waitlists" ALTER COLUMN "slot_time" TYPE VARCHAR(40);
