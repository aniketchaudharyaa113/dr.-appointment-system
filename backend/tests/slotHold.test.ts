import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";
import { getRedisClient } from "../src/cache/redis";

describe("Phase 6 - Task 6.1: Slot Hold Mechanism", () => {
  let doctorId: string;
  let patientAToken: string;
  let patientBToken: string;
  let patientAId: string;
  let patientBId: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.hold@medibook.test', $1, 'Dr. Hold', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const docUserId = docUserRes.rows[0].id;

    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'General Medicine', 'MBBS', 'Hold Care Clinic', 'Delhi', 400, true)
       RETURNING id`,
      [docUserId]
    );
    doctorId = docRes.rows[0].id;

    // Doctor availability
    for (let day = 0; day <= 6; day++) {
      await pool.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, '09:00:00', '18:00:00', 15)`,
        [doctorId, day]
      );
    }

    // Patient A
    const pARes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('patientA.hold@medibook.test', $1, 'Patient A', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patientAId = pARes.rows[0].id;
    patientAToken = jwt.sign({ id: patientAId, role: "PATIENT" }, process.env.JWT_SECRET as string, { expiresIn: "1h" });

    // Patient B
    const pBRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('patientB.hold@medibook.test', $1, 'Patient B', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patientBId = pBRes.rows[0].id;
    patientBToken = jwt.sign({ id: patientBId, role: "PATIENT" }, process.env.JWT_SECRET as string, { expiresIn: "1h" });
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("creates a 5-minute redis hold and blocks concurrent holds by other patients", async () => {
    const slotTime = "2027-02-10T10:00:00";

    // 1. Patient A holds the slot
    const holdResA = await request(app)
      .post("/appointments/hold")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId, slotTime });

    expect(holdResA.status).toBe(201);
    expect(holdResA.body).toHaveProperty("holdToken");
    expect(holdResA.body.expiresIn).toBe(300);

    const holdTokenA = holdResA.body.holdToken;

    // Verify key in Redis
    const redis = getRedisClient()!;
    const redisVal = await redis.get(`hold:${doctorId}:${slotTime}`);
    expect(redisVal).toBe(`${patientAId}:${holdTokenA}`);

    // Verify TTL is around 300
    const ttl = await redis.ttl(`hold:${doctorId}:${slotTime}`);
    expect(ttl).toBeGreaterThan(250);

    // 2. Patient B tries to hold the same slot -> 409 Conflict
    const holdResB = await request(app)
      .post("/appointments/hold")
      .set("Authorization", `Bearer ${patientBToken}`)
      .send({ doctorId, slotTime });

    expect(holdResB.status).toBe(409);
    expect(holdResB.body.error).toContain("currently held");

    // 3. Patient B tries to book the held slot -> 409 Conflict
    const bookResB = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientBToken}`)
      .send({ doctorId, slotTime });

    expect(bookResB.status).toBe(409);
    expect(bookResB.body.error).toContain("currently held");

    // 4. Patient A books with their hold token -> 201 Created
    const bookResA = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId, slotTime, holdToken: holdTokenA });

    expect(bookResA.status).toBe(201);
    expect(bookResA.body).toHaveProperty("booking_ref");

    // Verify hold key is deleted from Redis after booking
    const holdKeyAfter = await redis.get(`hold:${doctorId}:${slotTime}`);
    expect(holdKeyAfter).toBeNull();
  });

  it("allows releasing a hold and enables another patient to hold and book it", async () => {
    const slotTime = "2027-02-10T11:00:00";

    // Patient A holds slot
    const holdResA = await request(app)
      .post("/appointments/hold")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId, slotTime });
    expect(holdResA.status).toBe(201);
    const holdTokenA = holdResA.body.holdToken;

    // Patient A releases the hold
    const releaseRes = await request(app)
      .post("/appointments/release-hold")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId, slotTime, holdToken: holdTokenA });
    expect(releaseRes.status).toBe(200);

    // Patient B holds slot successfully
    const holdResB = await request(app)
      .post("/appointments/hold")
      .set("Authorization", `Bearer ${patientBToken}`)
      .send({ doctorId, slotTime });
    expect(holdResB.status).toBe(201);
    const holdTokenB = holdResB.body.holdToken;

    // Patient B completes booking
    const bookResB = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientBToken}`)
      .send({ doctorId, slotTime, holdToken: holdTokenB });
    expect(bookResB.status).toBe(201);
  });
});
