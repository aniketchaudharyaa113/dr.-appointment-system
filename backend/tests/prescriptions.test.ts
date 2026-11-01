import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 1 - Task 1.6: Prescriptions require COMPLETED status and retain versions", () => {
  let doctorUserId: string;
  let doctorToken: string;
  let patientToken: string;
  let appointmentId: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.rx@medibook.test', $1, 'Dr. Rx', 'DOCTOR')
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
       VALUES ($1, 'General Physician', 'MBBS', 'General Clinic', 'Hyderabad', 300, true)
       RETURNING id`,
      [doctorUserId]
    );
    const doctorId = docRes.rows[0].id;

    const pRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('patient.rx@medibook.test', $1, 'Patient Rx', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    const patientId = pRes.rows[0].id;
    patientToken = jwt.sign(
      { id: patientId, role: "PATIENT" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    const apptRes = await pool.query(
      `INSERT INTO appointments (patient_id, doctor_id, slot_time, status, booking_ref)
       VALUES ($1, $2, '2027-06-01 11:00:00', 'CONFIRMED', 'MB-20270601-001')
       RETURNING id`,
      [patientId, doctorId]
    );
    appointmentId = apptRes.rows[0].id;
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("rejects prescription creation if appointment status is not COMPLETED", async () => {
    const res = await request(app)
      .post("/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        appointmentId,
        diagnosis: "Viral Fever",
        medicines: [{ name: "Paracetamol", dosage: "500mg", frequency: "1-0-1", duration: "3 days" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only be created for COMPLETED appointments/i);
  });

  it("allows creation on COMPLETED appointments and saves version history on update", async () => {
    // 1. Mark appointment as COMPLETED
    await pool.query(`UPDATE appointments SET status = 'COMPLETED' WHERE id = $1`, [appointmentId]);

    // 2. Create initial prescription
    const res1 = await request(app)
      .post("/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        appointmentId,
        diagnosis: "Viral Fever Initial",
        medicines: [{ name: "Paracetamol", dosage: "500mg", frequency: "1-0-1", duration: "3 days" }],
        notes: "Drink warm fluids",
      });

    expect(res1.status).toBe(201);
    const rxId = res1.body.id;
    expect(res1.body.diagnosis).toBe("Viral Fever Initial");

    // No versions exist yet
    const v0 = await request(app)
      .get(`/prescriptions/${rxId}/versions`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(v0.status).toBe(200);
    expect(v0.body.length).toBe(0);

    // 3. Update prescription with revised diagnosis & dosage
    const res2 = await request(app)
      .post("/prescriptions")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        appointmentId,
        diagnosis: "Viral Fever Revised",
        medicines: [
          { name: "Paracetamol", dosage: "650mg", frequency: "1-1-1", duration: "5 days" },
          { name: "Vitamin C", dosage: "500mg", frequency: "0-1-0", duration: "5 days" },
        ],
        notes: "Complete bed rest",
      });

    expect(res2.status).toBe(200);
    expect(res2.body.diagnosis).toBe("Viral Fever Revised");

    // 4. Check version history: should have version 1 stored with previous content
    const v1 = await request(app)
      .get(`/prescriptions/${rxId}/versions`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(v1.status).toBe(200);
    expect(v1.body.length).toBe(1);
    expect(v1.body[0].version).toBe(1);
    expect(v1.body[0].diagnosis).toBe("Viral Fever Initial");
  });
});
