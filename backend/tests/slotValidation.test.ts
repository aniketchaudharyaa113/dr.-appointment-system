import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 1 - Task 1.2: Slot-grid validation", () => {
  let doctorId: string;
  let patientToken: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.grid@medibook.test', $1, 'Dr. Grid', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const docUserId = docUserRes.rows[0].id;

    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Neurologist', 'MBBS, DM', 'Brain Center', 'Delhi', 800, true)
       RETURNING id`,
      [docUserId]
    );
    doctorId = docRes.rows[0].id;

    // Doctor availability:
    // Sunday (0) to Friday (5): 09:00:00 to 18:00:00 with 15-minute slots
    // Saturday (6): 14:00:00 to 16:00:00 with 45-minute slots
    for (let day = 0; day <= 5; day++) {
      await pool.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, '09:00:00', '18:00:00', 15)`,
        [doctorId, day]
      );
    }
    await pool.query(
      `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
       VALUES ($1, 6, '14:00:00', '16:00:00', 45)`,
      [doctorId]
    );

    const pRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('patient.grid@medibook.test', $1, 'Patient Grid', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patientToken = jwt.sign(
      { id: pRes.rows[0].id, role: "PATIENT" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("rejects slot times not aligned to slot_duration_minutes from start_time", async () => {
    // 2027-03-01 is a Monday (day 1). Window 09:00:00 to 18:00:00, 15-min intervals.
    // 10:07:00 is not aligned to 15-min interval from 09:00:00 (10:00, 10:15, 10:30, 10:45)
    const res = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: "2027-03-01T10:07:00" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not aligned to the doctor's 15-minute schedule grid/i);
  });

  it("rejects slot times where slot duration exceeds window end_time", async () => {
    // 2027-03-06 is a Saturday (day 6). Window is 14:00:00 to 16:00:00 with 45-min slots.
    // Valid slots: 14:00:00 (ends 14:45), 14:45:00 (ends 15:30).
    // A slot at 15:30:00 is aligned (15:30 - 14:00 = 90 mins, 90 % 45 = 0),
    // but ends at 16:15 > 16:00:00 window end!
    const res = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: "2027-03-06T15:30:00" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds available window end/i);
  });

  it("accepts valid, aligned slot within window bounds", async () => {
    const res = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: "2027-03-01T10:15:00" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("CONFIRMED");
  });
});
