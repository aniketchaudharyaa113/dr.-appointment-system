import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 2 - Task 2.7: Audit reads of prescriptions", () => {
  let patientToken: string;
  let patientId: string;
  let appointmentId: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    const docUser = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.prescaudit@medibook.test', $1, 'Dr. PrescAudit', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const doc = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Physician', 'MBBS', 'Audit Clinic', 'Bengaluru', 500, true)
       RETURNING id`,
      [docUser.rows[0].id]
    );

    const pUser = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('patient.prescaudit@medibook.test', $1, 'Patient PrescAudit', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patientId = pUser.rows[0].id;
    patientToken = jwt.sign(
      { id: patientId, role: "PATIENT" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    const appt = await pool.query(
      `INSERT INTO appointments (patient_id, doctor_id, slot_time, status, booking_ref)
       VALUES ($1, $2, '2027-08-10 10:00:00', 'COMPLETED', 'MB-PRESC-AUDIT')
       RETURNING id`,
      [patientId, doc.rows[0].id]
    );
    appointmentId = appt.rows[0].id;

    await pool.query(
      `INSERT INTO prescriptions (appointment_id, doctor_id, patient_id, diagnosis, medicines, notes)
       VALUES ($1, $2, $3, 'Fever', '[{"name":"Paracetamol","dosage":"500mg","frequency":"1-0-1","duration":"3 days"}]'::jsonb, 'Rest well')`,
      [appointmentId, doc.rows[0].id, patientId]
    );
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("creates an audit log entry when a user reads a prescription", async () => {
    const res = await request(app)
      .get(`/prescriptions/appointment/${appointmentId}`)
      .set("Authorization", `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body.diagnosis).toBe("Fever");

    // Wait a brief moment for async queue worker to write audit log
    await new Promise((resolve) => setTimeout(resolve, 300));

    const auditRes = await pool.query(
      `SELECT * FROM audit_logs WHERE action = 'PRESCRIPTION_VIEWED' AND actor_id = $1`,
      [patientId]
    );

    expect(auditRes.rows.length).toBeGreaterThanOrEqual(1);
    expect(auditRes.rows[0].actor_role).toBe("PATIENT");
    expect(auditRes.rows[0].details.appointmentId).toBe(appointmentId);
  });
});
