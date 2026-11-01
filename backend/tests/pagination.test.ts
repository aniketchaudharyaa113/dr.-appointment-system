import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 1 - Task 1.8: Pagination across list endpoints", () => {
  let adminToken: string;
  let patientToken: string;
  let doctorToken: string;
  let patientId: string;
  let doctorId: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    // Admin
    const adminUser = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('admin.page@medibook.test', $1, 'Admin Pager', 'ADMIN')
       RETURNING id`,
      [passwordHash]
    );
    adminToken = jwt.sign(
      { id: adminUser.rows[0].id, role: "ADMIN" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    // Doctor
    const docUser = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.page@medibook.test', $1, 'Dr. Pager', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Cardiologist', 'MBBS, MD', 'Heart Clinic', 'Bengaluru', 800, true)
       RETURNING id`,
      [docUser.rows[0].id]
    );
    doctorId = docRes.rows[0].id;
    doctorToken = jwt.sign(
      { id: docUser.rows[0].id, role: "DOCTOR" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    // Additional doctors for doctor pagination test
    for (let i = 1; i <= 3; i++) {
      const u = await pool.query(
        `INSERT INTO users (email, password, name, role)
         VALUES ('doctor.extra${i}@medibook.test', $1, 'Dr. Extra ${i}', 'DOCTOR')
         RETURNING id`,
        [passwordHash]
      );
      await pool.query(
        `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
         VALUES ($1, 'General Physician', 'MBBS', 'General Clinic', 'Bengaluru', 400, true)`,
        [u.rows[0].id]
      );
    }

    // Patient
    const pUser = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('patient.page@medibook.test', $1, 'Patient Pager', 'PATIENT')
       RETURNING id`,
      [passwordHash]
    );
    patientId = pUser.rows[0].id;
    patientToken = jwt.sign(
      { id: patientId, role: "PATIENT" },
      process.env.JWT_SECRET as string,
      { expiresIn: "1h" }
    );

    // Insert 3 appointments
    for (let i = 1; i <= 3; i++) {
      await pool.query(
        `INSERT INTO appointments (patient_id, doctor_id, slot_time, status, booking_ref)
         VALUES ($1, $2, '2027-06-10 1${i}:00:00', 'CONFIRMED', 'MB-PAGE-${i}')`,
        [patientId, doctorId]
      );
    }

    // Insert 3 notifications
    for (let i = 1; i <= 3; i++) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, message)
         VALUES ($1, 'SYSTEM', 'Notice ${i}', 'Message ${i}')`,
        [patientId]
      );
    }


    // Insert 3 audit logs
    for (let i = 1; i <= 3; i++) {
      await pool.query(
        `INSERT INTO audit_logs (action, actor_id, actor_role, details)
         VALUES ('ACTION_${i}', $1, 'PATIENT', '{"item": ${i}}'::jsonb)`,
        [patientId]
      );
    }
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("paginates /doctors with page and limit", async () => {
    const res = await request(app)
      .get("/doctors?page=1&limit=2")
      .expect(200);

    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("pagination");
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(4);
    expect(res.body.pagination.hasMore).toBe(true);

    const page2 = await request(app)
      .get("/doctors?page=2&limit=2")
      .expect(200);
    expect(page2.body.data.length).toBe(2);
    expect(page2.body.pagination.page).toBe(2);
  });

  it("paginates /appointments/mine for patient", async () => {
    const res = await request(app)
      .get("/appointments/mine?page=1&limit=2")
      .set("Authorization", `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("pagination");
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
    expect(res.body.pagination.hasMore).toBe(true);

    const page2 = await request(app)
      .get("/appointments/mine?page=2&limit=2")
      .set("Authorization", `Bearer ${patientToken}`)
      .expect(200);

    expect(page2.body.data.length).toBe(1);
    expect(page2.body.pagination.hasMore).toBe(false);
  });

  it("paginates /notifications for user", async () => {
    const res = await request(app)
      .get("/notifications?page=1&limit=2")
      .set("Authorization", `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("pagination");
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.hasMore).toBe(true);
  });

  it("paginates /admin/appointments", async () => {
    const res = await request(app)
      .get("/admin/appointments?page=1&limit=2")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("pagination");
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(3);
  });

  it("paginates /admin/audit-logs", async () => {
    const res = await request(app)
      .get("/admin/audit-logs?page=1&limit=2")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("pagination");
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(3);
  });
});
