import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 0 - Concurrency Test: 50 Parallel Bookings", () => {
  let doctorId: string;
  let slotTime: string;
  const patientTokens: { id: string; token: string }[] = [];

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    // 1. Create a verified doctor
    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.concurrency@medibook.test', $1, 'Dr. Concurrency', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const docUserId = docUserRes.rows[0].id;

    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Cardiologist', 'MBBS, MD', 'Heart Clinic', 'Kolkata', 500, true)
       RETURNING id`,
      [docUserId]
    );
    doctorId = docRes.rows[0].id;

    // Doctor available all 7 days from 09:00:00 to 18:00:00 with 15-min slots
    for (let day = 0; day <= 6; day++) {
      await pool.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, '09:00:00', '18:00:00', 15)`,
        [doctorId, day]
      );
    }

    // 2. Create 50 distinct patients with JWT tokens
    for (let i = 1; i <= 50; i++) {
      const pRes = await pool.query(
        `INSERT INTO users (email, password, name, role)
         VALUES ($1, $2, $3, 'PATIENT')
         RETURNING id`,
        [`patient${i}@medibook.test`, passwordHash, `Patient ${i}`]
      );
      const patientId = pRes.rows[0].id;
      const token = jwt.sign(
        { id: patientId, role: "PATIENT" },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" }
      );
      patientTokens.push({ id: patientId, token });
    }

    // Target slot in the future (2027-01-15T10:00:00)
    slotTime = "2027-01-15T10:00:00";
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("handles 50 parallel requests for the same slot: exactly 1 succeeds (201) and 49 receive 409 conflict", async () => {
    // Fire all 50 booking requests concurrently
    const promises = patientTokens.map(({ token }) =>
      request(app)
        .post("/appointments")
        .set("Authorization", `Bearer ${token}`)
        .send({ doctorId, slotTime })
    );

    const responses = await Promise.all(promises);

    const successResponses = responses.filter((r) => r.status === 201);
    const conflictResponses = responses.filter((r) => r.status === 409);
    const otherResponses = responses.filter((r) => r.status !== 201 && r.status !== 409);

    if (otherResponses.length > 0) {
      console.error("Unexpected responses:", otherResponses.map((r) => ({ status: r.status, body: r.body })));
    }

    // Assert exactly 1 succeeds and 49 conflict
    expect(successResponses.length).toBe(1);
    expect(conflictResponses.length).toBe(49);
    expect(otherResponses.length).toBe(0);

    // Verify booking_ref format on successful appointment
    const bookedAppt = successResponses[0].body;
    expect(bookedAppt).toHaveProperty("booking_ref");
    expect(bookedAppt.booking_ref).toMatch(/^MB-20270115-\d{3}$/);

    // Verify database state: exactly 1 row in appointments table
    const dbAppts = await pool.query(
      `SELECT * FROM appointments WHERE doctor_id = $1 AND slot_time = $2`,
      [doctorId, "2027-01-15 10:00:00"]
    );
    expect(dbAppts.rows.length).toBe(1);
    expect(dbAppts.rows[0].booking_ref).toBe(bookedAppt.booking_ref);

    // Verify token sequence counter in doctor_daily_counters
    const counterRes = await pool.query(
      `SELECT last_seq FROM doctor_daily_counters WHERE doctor_id = $1 AND booking_date = $2`,
      [doctorId, "2027-01-15"]
    );
    expect(counterRes.rows.length).toBe(1);
    expect(counterRes.rows[0].last_seq).toBe(1);
  });
});
