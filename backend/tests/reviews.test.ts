import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 1 - Task 1.5: Reviews linked uniquely to completed appointments", () => {
  let doctorId: string;
  let patientToken: string;
  let patientId: string;
  let appointmentId: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.review@medibook.test', $1, 'Dr. Review', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const docUserId = docUserRes.rows[0].id;

    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Pediatrician', 'MBBS, DCH', 'Kids Clinic', 'Bengaluru', 500, true)
       RETURNING id`,
      [docUserId]
    );
    doctorId = docRes.rows[0].id;

    const pRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('patient.review@medibook.test', $1, 'Patient Reviewer', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patientId = pRes.rows[0].id;
    patientToken = jwt.sign(
      { id: patientId, role: "PATIENT" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    // Create an initial CONFIRMED appointment
    const apptRes = await pool.query(
      `INSERT INTO appointments (patient_id, doctor_id, slot_time, status, booking_ref)
       VALUES ($1, $2, '2027-05-10 10:00:00', 'CONFIRMED', 'MB-20270510-001')
       RETURNING id`,
      [patientId, doctorId]
    );
    appointmentId = apptRes.rows[0].id;
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("rejects review if appointment is not COMPLETED", async () => {
    const res = await request(app)
      .post("/reviews")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        appointmentId,
        rating: 5,
        comment: "Great doctor!",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only review a doctor after a completed appointment/i);
  });

  it("allows review once appointment is COMPLETED and rejects duplicate review on the same appointment", async () => {
    // Mark appointment as COMPLETED
    await pool.query(`UPDATE appointments SET status = 'COMPLETED' WHERE id = $1`, [appointmentId]);

    // 1. Submit review
    const res1 = await request(app)
      .post("/reviews")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        appointmentId,
        rating: 5,
        comment: "Excellent care!",
      });

    expect(res1.status).toBe(201);
    expect(res1.body.appointment_id).toBe(appointmentId);
    expect(res1.body.rating).toBe(5);

    // 2. Try submitting a second review for the same appointment -> 409 Conflict
    const res2 = await request(app)
      .post("/reviews")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        appointmentId,
        rating: 4,
        comment: "Trying to review again",
      });

    expect(res2.status).toBe(409);
    expect(res2.body.error).toMatch(/already been reviewed/i);
  });
});
