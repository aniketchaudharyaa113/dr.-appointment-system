import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 1 - Task 1.4: Doctor leave & availability cascade cancellation with dryRun", () => {
  let doctorUserId: string;
  let doctorId: string;
  let doctorToken: string;
  let patientToken: string;
  let patientId: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.leave@medibook.test', $1, 'Dr. Leave', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    doctorUserId = docUserRes.rows[0].id;
    doctorToken = jwt.sign(
      { id: doctorUserId, role: "DOCTOR" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Orthopedic', 'MBBS, MS', 'Bone Clinic', 'Pune', 600, true)
       RETURNING id`,
      [doctorUserId]
    );
    doctorId = docRes.rows[0].id;

    // Doctor availability: Mon-Sat 09:00:00 to 18:00:00 (15 min)
    for (let day = 0; day <= 6; day++) {
      await pool.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, '09:00:00', '18:00:00', 15)`,
        [doctorId, day]
      );
    }

    const pRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('patient.leave@medibook.test', $1, 'Patient Leave', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patientId = pRes.rows[0].id;
    patientToken = jwt.sign(
      { id: patientId, role: "PATIENT" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("identifies affected appointments with dryRun and cancels them when leave is added", async () => {
    // 2027-04-12 is a Monday
    // 1. Book two appointments on 2027-04-12
    const b1 = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: "2027-04-12T10:00:00" });
    expect(b1.status).toBe(201);

    const b2 = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: "2027-04-12T10:15:00" });
    expect(b2.status).toBe(201);

    // 2. Doctor runs dryRun for adding leave on 2027-04-12
    const dryRes = await request(app)
      .post("/doctors/me/leaves?dryRun=true")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ leaveDate: "2027-04-12", reason: "Attending Medical Seminar" });

    expect(dryRes.status).toBe(200);
    expect(dryRes.body.dryRun).toBe(true);
    expect(dryRes.body.affectedCount).toBe(2);
    expect(dryRes.body.affectedAppointments.length).toBe(2);

    // Verify appointments in DB are still CONFIRMED
    const preCheck = await pool.query(
      `SELECT status FROM appointments WHERE id IN ($1, $2)`,
      [b1.body.id, b2.body.id]
    );
    expect(preCheck.rows.every((r) => r.status === "CONFIRMED")).toBe(true);

    // 3. Doctor submits actual leave without dryRun
    const actRes = await request(app)
      .post("/doctors/me/leaves")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ leaveDate: "2027-04-12", reason: "Attending Medical Seminar" });

    expect(actRes.status).toBe(201);
    expect(actRes.body.affectedCount).toBe(2);

    // Verify both appointments in DB are now CANCELLED
    const postCheck = await pool.query(
      `SELECT status, notes FROM appointments WHERE id IN ($1, $2)`,
      [b1.body.id, b2.body.id]
    );
    expect(postCheck.rows.length).toBe(2);
    expect(postCheck.rows.every((r) => r.status === "CANCELLED")).toBe(true);
    expect(postCheck.rows[0].notes).toMatch(/Attending Medical Seminar/);
  });

  it("handles availability schedule reduction and cascade cancels out-of-bounds appointments", async () => {
    // 2027-04-19 is Monday (day 1).
    // Book a morning slot (10:00:00) and an afternoon slot (16:00:00)
    const bMorning = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: "2027-04-19T10:00:00" });
    expect(bMorning.status).toBe(201);

    const bAfternoon = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: "2027-04-19T16:00:00" });
    expect(bAfternoon.status).toBe(201);

    // Doctor reduces Monday schedule from full day (09:00 - 18:00) to morning only (09:00 - 13:00)
    const newSlots = [
      { dayOfWeek: 1, startTime: "09:00", endTime: "13:00", slotDurationMinutes: 15 },
    ];

    // Dry-run
    const dryRes = await request(app)
      .patch("/doctors/me/availability?dryRun=true")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ slots: newSlots });

    expect(dryRes.status).toBe(200);
    expect(dryRes.body.dryRun).toBe(true);
    // Afternoon slot at 16:00 is outside 09:00 - 13:00, morning slot at 10:00 is preserved
    expect(dryRes.body.affectedCount).toBe(1);
    expect(dryRes.body.affectedAppointments[0].id).toBe(bAfternoon.body.id);

    // Actual save
    const actRes = await request(app)
      .patch("/doctors/me/availability")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ slots: newSlots });

    expect(actRes.status).toBe(200);
    expect(actRes.body.affectedCount).toBe(1);

    // Verify morning is still CONFIRMED, afternoon is CANCELLED
    const mCheck = await pool.query(`SELECT status FROM appointments WHERE id = $1`, [bMorning.body.id]);
    expect(mCheck.rows[0].status).toBe("CONFIRMED");

    const aCheck = await pool.query(`SELECT status, notes FROM appointments WHERE id = $1`, [bAfternoon.body.id]);
    expect(aCheck.rows[0].status).toBe("CANCELLED");
    expect(aCheck.rows[0].notes).toMatch(/doctor schedule reduction/);
  });
});
