import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 1 - Task 1.7: Atomic rescheduleAppointment", () => {
  let doctorId: string;
  let patientToken: string;
  let patient2Token: string;
  let originalApptId: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.resched@medibook.test', $1, 'Dr. Reschedule', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const docUserId = docUserRes.rows[0].id;

    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Cardiologist', 'MBBS, DM', 'Cardiac Wellness', 'Chennai', 700, true)
       RETURNING id`,
      [docUserId]
    );
    doctorId = docRes.rows[0].id;

    // Availability: Mon-Sat 09:00:00 to 18:00:00, 15 min slots
    for (let day = 0; day <= 6; day++) {
      await pool.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, '09:00:00', '18:00:00', 15)`,
        [doctorId, day]
      );
    }

    const p1Res = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('p1.resched@medibook.test', $1, 'Patient 1', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patientToken = jwt.sign(
      { id: p1Res.rows[0].id, role: "PATIENT" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    const p2Res = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('p2.resched@medibook.test', $1, 'Patient 2', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patient2Token = jwt.sign(
      { id: p2Res.rows[0].id, role: "PATIENT" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    // Initial booking at 2027-07-05T10:00:00
    const bRes = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: "2027-07-05T10:00:00" });
    expect(bRes.status).toBe(201);
    originalApptId = bRes.body.id;
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("atomically cancels the old appointment and rebooks the new slot", async () => {
    const res = await request(app)
      .patch(`/appointments/${originalApptId}/reschedule`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ newSlotTime: "2027-07-05T11:00:00" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CONFIRMED");
    expect(res.body.slot_time).toBe("2027-07-05 11:00:00");
    const newApptId = res.body.id;
    expect(newApptId).not.toBe(originalApptId);

    // Verify old appointment in DB is CANCELLED
    const oldRow = await pool.query(`SELECT status, notes FROM appointments WHERE id = $1`, [originalApptId]);
    expect(oldRow.rows[0].status).toBe("CANCELLED");
    expect(oldRow.rows[0].notes).toMatch(/Rescheduled to 2027-07-05 11:00:00/);

    // Verify original slot (10:00:00) can now be booked by patient 2
    const p2Booking = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patient2Token}`)
      .send({ doctorId, slotTime: "2027-07-05T10:00:00" });
    expect(p2Booking.status).toBe(201);
  });

  it("fails atomically without cancelling current slot when new slot is unavailable", async () => {
    // Patient 2 holds 10:00:00. Patient 1 has 11:00:00.
    // Fetch patient 1 current appointment
    const currentAppt = await pool.query(
      `SELECT id FROM appointments WHERE doctor_id = $1 AND slot_time = '2027-07-05 11:00:00' AND status = 'CONFIRMED'`,
      [doctorId]
    );
    const p1CurrentId = currentAppt.rows[0].id;

    // Try rescheduling to 10:00:00 (which is already booked by Patient 2)
    const conflictRes = await request(app)
      .patch(`/appointments/${p1CurrentId}/reschedule`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ newSlotTime: "2027-07-05T10:00:00" });

    expect(conflictRes.status).toBe(409);

    // Verify p1 current appointment is STILL CONFIRMED
    const checkStillConfirmed = await pool.query(`SELECT status FROM appointments WHERE id = $1`, [p1CurrentId]);
    expect(checkStillConfirmed.rows[0].status).toBe("CONFIRMED");
  });
});
