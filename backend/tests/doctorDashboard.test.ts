import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 6 - Task 6.6: Doctor Dashboard Day View, No-Show Status, and Earnings Analytics", () => {
  let doctorToken: string;
  let patientToken: string;
  let doctorId: string;
  let patientId: string;
  let appt1Id: string;
  let appt2Id: string;
  const testDate = "2027-03-20";

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    // Doctor
    const docUser = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ('doc.dash@medibook.test', $1, 'Dr. Dashboard', 'DOCTOR') RETURNING id`,
      [passwordHash]
    );
    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'General Physician', 'MBBS', 'City Clinic', 'MG Road', 600, true)
       RETURNING id`,
      [docUser.rows[0].id]
    );
    doctorId = docRes.rows[0].id;

    // Patient
    const patUser = await pool.query(
      `INSERT INTO users (email, password, name, phone, role) VALUES ('pat.dash@medibook.test', $1, 'Patient Dashboard', '9876543210', 'PATIENT') RETURNING id`,
      [passwordHash]
    );
    patientId = patUser.rows[0].id;

    // Doctor availability on Saturday (2027-03-20 is Saturday => day_of_week 6)
    await pool.query(
      `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
       VALUES ($1, 6, '09:00:00', '17:00:00', 30)`,
      [doctorId]
    );

    // Log in
    const docLogin = await request(app)
      .post("/auth/login")
      .send({ email: "doc.dash@medibook.test", password: "password123" });
    doctorToken = docLogin.body.token;

    const patLogin = await request(app)
      .post("/auth/login")
      .send({ email: "pat.dash@medibook.test", password: "password123" });
    patientToken = patLogin.body.token;

    // Create 2 appointments on 2027-03-20 and 1 on 2027-03-21
    const a1 = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: `${testDate}T10:00:00` });
    appt1Id = a1.body.id;

    const a2 = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: `${testDate}T11:00:00` });
    appt2Id = a2.body.id;
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("GET /doctors/me/day-view returns appointments for the specified date only in order", async () => {
    const res = await request(app)
      .get(`/doctors/me/day-view?date=${testDate}`)
      .set("Authorization", `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body[0].id).toBe(appt1Id);
    expect(res.body[0].patient_name).toBe("Patient Dashboard");
    expect(res.body[0].patient_phone).toBe("9876543210");
    expect(res.body[1].id).toBe(appt2Id);

    // Other date returns empty
    const otherRes = await request(app)
      .get(`/doctors/me/day-view?date=2027-03-25`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.length).toBe(0);
  });

  it("PATCH /appointments/:id/no-show marks appointment as NO_SHOW and writes outbox event", async () => {
    const res = await request(app)
      .patch(`/appointments/${appt1Id}/no-show`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ reason: "Patient failed to arrive after 20 minutes" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("NO_SHOW");

    // Verify DB status
    const dbAppt = await pool.query(`SELECT status, notes FROM appointments WHERE id = $1`, [appt1Id]);
    expect(dbAppt.rows[0].status).toBe("NO_SHOW");
    expect(dbAppt.rows[0].notes).toContain("Patient failed to arrive");

    // Verify outbox notification created
    const outbox = await pool.query(
      `SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'NOTIFICATION'`,
      [appt1Id]
    );
    expect(outbox.rows.length).toBeGreaterThan(0);
    const payload = outbox.rows[outbox.rows.length - 1].payload;
    expect(payload.type).toBe("APPOINTMENT_NO_SHOW");

    // Cannot mark no-show again (since no longer CONFIRMED)
    const secondRes = await request(app)
      .patch(`/appointments/${appt1Id}/no-show`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({});
    expect(secondRes.status).toBe(404);
  });

  it("GET /doctors/me/earnings returns total earnings and weekly/monthly breakdown", async () => {
    // Complete appointment 2
    await request(app)
      .patch(`/appointments/${appt2Id}/complete`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ notes: "Consultation finished" });

    const res = await request(app)
      .get("/doctors/me/earnings")
      .set("Authorization", `Bearer ${doctorToken}`);

    expect(res.status).toBe(200);
    expect(Number(res.body.total_earnings)).toBe(600);
    expect(Number(res.body.completed_appointments)).toBe(1);

    expect(Array.isArray(res.body.weekly)).toBe(true);
    expect(res.body.weekly.length).toBeGreaterThanOrEqual(1);
    expect(res.body.weekly[0].earnings).toBe(600);
    expect(res.body.weekly[0].count).toBe(1);

    expect(Array.isArray(res.body.monthly)).toBe(true);
    expect(res.body.monthly.length).toBeGreaterThanOrEqual(1);
    expect(res.body.monthly[0].earnings).toBe(600);
  });
});
