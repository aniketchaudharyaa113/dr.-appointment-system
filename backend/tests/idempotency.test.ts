import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";
import { getRedisClient } from "../src/cache/redis";

describe("Phase 6 - Task 6.2: Idempotency Key Caching", () => {
  let doctorId: string;
  let patientToken: string;
  let patientId: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.idempotency@medibook.test', $1, 'Dr. Idempotent', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const docUserId = docUserRes.rows[0].id;

    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Dermatology', 'MD', 'Skin Clinic', 'Mumbai', 600, true)
       RETURNING id`,
      [docUserId]
    );
    doctorId = docRes.rows[0].id;

    for (let day = 0; day <= 6; day++) {
      await pool.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, '09:00:00', '18:00:00', 15)`,
        [doctorId, day]
      );
    }

    const pRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('patient.idempotent@medibook.test', $1, 'Patient Idempotent', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patientId = pRes.rows[0].id;
    patientToken = jwt.sign({ id: patientId, role: "PATIENT" }, process.env.JWT_SECRET as string, { expiresIn: "1h" });
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("stores key->response in Redis for 24h and replaying the same key returns cached response without double-booking", async () => {
    const slotTime = "2027-02-12T10:00:00";
    const idempotencyKey = crypto.randomUUID();

    // First booking request with Idempotency-Key
    const firstRes = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ doctorId, slotTime });

    expect(firstRes.status).toBe(201);
    expect(firstRes.body).toHaveProperty("booking_ref");
    expect(firstRes.header["x-idempotent-replay"]).toBeUndefined();

    const bookingRef = firstRes.body.booking_ref;

    // Verify key in Redis has ~24h TTL
    const redis = getRedisClient()!;
    const ttl = await redis.ttl(`idempotency:appointment:${idempotencyKey}`);
    expect(ttl).toBeGreaterThan(86300); // within 100s of 86400 (24h)

    // Second booking request with SAME Idempotency-Key (even though DB has slot booked!)
    const replayRes = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({ doctorId, slotTime });

    // Must return exact same response and status
    expect(replayRes.status).toBe(201);
    expect(replayRes.body.booking_ref).toBe(bookingRef);
    expect(replayRes.header["x-idempotent-replay"]).toBe("true");

    // Verify exactly ONE appointment row exists in DB
    const dbCount = await pool.query(
      `SELECT COUNT(*) FROM appointments WHERE doctor_id = $1 AND slot_time = $2`,
      [doctorId, slotTime]
    );
    expect(Number(dbCount.rows[0].count)).toBe(1);
  });

  it("rejects request with 400 when Idempotency-Key header is enforced and missing", async () => {
    const slotTime = "2027-02-12T11:00:00";

    const res = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .set("X-Enforce-Idempotency", "true")
      .send({ doctorId, slotTime });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Idempotency-Key header is required");
  });
});
