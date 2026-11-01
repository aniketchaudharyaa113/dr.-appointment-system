import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";
import { getRedisClient } from "../src/cache/redis";
import { handleWaitlistExpiry } from "../src/services/waitlistService";

describe("Phase 6 - Task 6.3: Waitlist and Automated Slot Offer Cascade", () => {
  let doctorId: string;
  let patientAToken: string;
  let patientBToken: string;
  let patientCToken: string;
  let patientAId: string;
  let patientBId: string;
  let patientCId: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.waitlist@medibook.test', $1, 'Dr. Waitlist', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const docUserId = docUserRes.rows[0].id;

    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Orthopedics', 'MS', 'Bone Clinic', 'Bangalore', 500, true)
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

    // Patient A
    const pARes = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ('patientA.wait@medibook.test', $1, 'Patient A', 'PATIENT') RETURNING id`,
      [passwordHash]
    );
    patientAId = pARes.rows[0].id;
    patientAToken = jwt.sign({ id: patientAId, role: "PATIENT" }, process.env.JWT_SECRET as string, { expiresIn: "1h" });

    // Patient B
    const pBRes = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ('patientB.wait@medibook.test', $1, 'Patient B', 'PATIENT') RETURNING id`,
      [passwordHash]
    );
    patientBId = pBRes.rows[0].id;
    patientBToken = jwt.sign({ id: patientBId, role: "PATIENT" }, process.env.JWT_SECRET as string, { expiresIn: "1h" });

    // Patient C
    const pCRes = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ('patientC.wait@medibook.test', $1, 'Patient C', 'PATIENT') RETURNING id`,
      [passwordHash]
    );
    patientCId = pCRes.rows[0].id;
    patientCToken = jwt.sign({ id: patientCId, role: "PATIENT" }, process.env.JWT_SECRET as string, { expiresIn: "1h" });
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("enables joining waitlist, and offers freed slot on cancellation to first waiting patient", async () => {
    const slotTime = "2027-02-15T10:00:00";
    const slotDate = "2027-02-15";

    // 1. Patient A books slot
    const bookA = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId, slotTime });
    expect(bookA.status).toBe(201);
    const appointmentId = bookA.body.id;

    // 2. Patient B and Patient C join the waitlist in order
    const waitlistB = await request(app)
      .post("/waitlist")
      .set("Authorization", `Bearer ${patientBToken}`)
      .send({ doctorId, slotDate, slotTime });
    expect(waitlistB.status).toBe(201);
    expect(waitlistB.body.status).toBe("WAITING");

    const waitlistC = await request(app)
      .post("/waitlist")
      .set("Authorization", `Bearer ${patientCToken}`)
      .send({ doctorId, slotDate, slotTime });
    expect(waitlistC.status).toBe(201);
    expect(waitlistC.body.status).toBe("WAITING");

    // 3. Patient A cancels the appointment
    const cancelRes = await request(app)
      .patch(`/appointments/${appointmentId}/cancel`)
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ reason: "Cannot make it" });
    expect(cancelRes.status).toBe(200);

    // 4. Assert Patient B (first in queue) is automatically offered the slot
    const updatedB = await pool.query(`SELECT * FROM waitlists WHERE id = $1`, [waitlistB.body.id]);
    expect(updatedB.rows[0].status).toBe("OFFERED");
    expect(updatedB.rows[0].hold_token).toBeTruthy();

    const holdTokenB = updatedB.rows[0].hold_token;

    // Redis has the hold for Patient B
    const redis = getRedisClient()!;
    const redisVal = await redis.get(`hold:${doctorId}:${slotTime}`);
    expect(redisVal).toBe(`${patientBId}:${holdTokenB}`);

    // Patient C cannot book it
    const bookC = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientCToken}`)
      .send({ doctorId, slotTime });
    expect(bookC.status).toBe(409);

    // 5. Patient B books using their waitlist hold token -> 201 Created
    const bookB = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientBToken}`)
      .send({ doctorId, slotTime, holdToken: holdTokenB });
    expect(bookB.status).toBe(201);
  });

  it("cascades to the next waitlisted patient when a claim window expires", async () => {
    const slotTime = "2027-02-16T11:00:00";
    const slotDate = "2027-02-16";

    // 1. Patient A books slot
    const bookA = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ doctorId, slotTime });
    expect(bookA.status).toBe(201);
    const appointmentId = bookA.body.id;

    // 2. Patient B and Patient C join waitlist
    const waitlistB = await request(app)
      .post("/waitlist")
      .set("Authorization", `Bearer ${patientBToken}`)
      .send({ doctorId, slotDate, slotTime });

    const waitlistC = await request(app)
      .post("/waitlist")
      .set("Authorization", `Bearer ${patientCToken}`)
      .send({ doctorId, slotDate, slotTime });

    // 3. Patient A cancels
    await request(app)
      .patch(`/appointments/${appointmentId}/cancel`)
      .set("Authorization", `Bearer ${patientAToken}`)
      .send({ reason: "Emergency" });

    // Verify Patient B received offer
    const dbB = await pool.query(`SELECT status FROM waitlists WHERE id = $1`, [waitlistB.body.id]);
    expect(dbB.rows[0].status).toBe("OFFERED");

    // 4. Simulate Patient B's 10-minute offer expiry
    await handleWaitlistExpiry(waitlistB.body.id, doctorId, slotTime);

    // 5. Patient B is EXPIRED, Patient C is now OFFERED
    const dbBExpired = await pool.query(`SELECT status FROM waitlists WHERE id = $1`, [waitlistB.body.id]);
    expect(dbBExpired.rows[0].status).toBe("EXPIRED");

    const dbCOffered = await pool.query(`SELECT status, hold_token FROM waitlists WHERE id = $1`, [waitlistC.body.id]);
    expect(dbCOffered.rows[0].status).toBe("OFFERED");
    expect(dbCOffered.rows[0].hold_token).toBeTruthy();

    // Patient C books successfully with their hold token
    const bookC = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientCToken}`)
      .send({ doctorId, slotTime, holdToken: dbCOffered.rows[0].hold_token });
    expect(bookC.status).toBe(201);
  });
});
