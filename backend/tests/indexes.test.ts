import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 1 - Task 1.9: Missing composite and query indexes", () => {
  beforeAll(async () => {
    await startTestEnvironment();
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("verifies all 4 required performance indexes exist", async () => {
    const res = await pool.query(
      `SELECT indexname, tablename, indexdef 
       FROM pg_indexes 
       WHERE schemaname = 'public' 
         AND indexname IN (
           'idx_notifications_user_created',
           'idx_reviews_doctor_id',
           'idx_appointments_doc_status_slot',
           'idx_appointments_patient_slot'
         )`
    );

    const foundNames = res.rows.map((r) => r.indexname);
    expect(foundNames).toContain("idx_notifications_user_created");
    expect(foundNames).toContain("idx_reviews_doctor_id");
    expect(foundNames).toContain("idx_appointments_doc_status_slot");
    expect(foundNames).toContain("idx_appointments_patient_slot");
  });
});
