import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 1 - Task 1.1: Cancelled slots can be rebooked", () => {
  let doctorId: string;
  let patient1Token: string;
  let patient2Token: string;
  let slotTime: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    // 1. Create doctor
    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.rebook@medibook.test', $1, 'Dr. Rebook', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const docUserId = docUserRes.rows[0].id;

    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Dermatologist', 'MBBS, MD', 'Skin Clinic', 'Mumbai', 400, true)
       RETURNING id`,
      [docUserId]
    );
    doctorId = docRes.rows[0].id;

    // Availability for all days 09:00 - 18:00
    for (let day = 0; day <= 6; day++) {
      await pool.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, '09:00:00', '18:00:00', 15)`,
        [doctorId, day]
      );
    }

    // 2. Create patient 1 & patient 2
    const p1Res = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('p1.rebook@medibook.test', $1, 'Patient One', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patient1Token = jwt.sign(
      { id: p1Res.rows[0].id, role: "PATIENT" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    const p2Res = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('p2.rebook@medibook.test', $1, 'Patient Two', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patient2Token = jwt.sign(
      { id: p2Res.rows[0].id, role: "PATIENT" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    slotTime = "2027-02-10T10:00:00";
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("allows booking, cancels it, and allows rebooking the same slot", async () => {
    // 1. Patient 1 books the slot
    const book1 = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patient1Token}`)
      .send({ doctorId, slotTime });
    expect(book1.status).toBe(201);
    const appointmentId = book1.body.id;

    // 2. Patient 2 tries to book the same slot -> 409 Conflict
    const bookConflict = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patient2Token}`)
      .send({ doctorId, slotTime });
    expect(bookConflict.status).toBe(409);

    // 3. Patient 1 cancels the appointment
    const cancelRes = await request(app)
      .patch(`/appointments/${appointmentId}/cancel`)
      .set("Authorization", `Bearer ${patient1Token}`)
      .send({ reason: "Changed plans" });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe("CANCELLED");

    // 4. Patient 2 now books the exact same slot -> should succeed with 201
    const bookRebook = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patient2Token}`)
      .send({ doctorId, slotTime });
    expect(bookRebook.status).toBe(201);
    expect(bookRebook.body.id).not.toBe(appointmentId);
    expect(bookRebook.body.status).toBe("CONFIRMED");

    // 5. Database check: exactly 2 appointments exist, one CANCELLED, one CONFIRMED
    const dbRows = await pool.query(
      `SELECT id, status FROM appointments WHERE doctor_id = $1 AND slot_time = $2 ORDER BY created_at ASC`,
      [doctorId, "2027-02-10 10:00:00"]
    );
    expect(dbRows.rows.length).toBe(2);
    expect(dbRows.rows[0].status).toBe("CANCELLED");
    expect(dbRows.rows[1].status).toBe("CONFIRMED");
  });
});
