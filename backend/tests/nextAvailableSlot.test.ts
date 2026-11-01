import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 6 - Task 6.4: Next Available Slot Computation", () => {
  let doctorId: string;
  let patientToken: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    const docUserRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('doctor.nextslot@medibook.test', $1, 'Dr. NextSlot', 'DOCTOR')
       RETURNING id`,
      [passwordHash]
    );
    const docUserId = docUserRes.rows[0].id;

    const docRes = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, consultation_fee, is_verified)
       VALUES ($1, 'Pediatrics', 'MBBS, DCH', 'Kids Care', 'Chennai', 350, true)
       RETURNING id`,
      [docUserId]
    );
    doctorId = docRes.rows[0].id;

    // Doctor available Mon to Fri (days 1 to 5) 09:00:00 to 18:00:00
    for (let day = 0; day <= 6; day++) {
      await pool.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, '09:00:00', '18:00:00', 15)`,
        [doctorId, day]
      );
    }

    const pRes = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ('patient.nextslot@medibook.test', $1, 'Patient NextSlot', 'PATIENT') RETURNING id`,
      [passwordHash]
    );
    patientToken = jwt.sign({ id: pRes.rows[0].id, role: "PATIENT" }, process.env.JWT_SECRET as string, { expiresIn: "1h" });
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("computes next_available_slot server-side for doctors and advances it when booked", async () => {
    // 1. Fetch doctors list
    const res1 = await request(app).get("/doctors?specialty=Pediatrics");
    expect(res1.status).toBe(200);
    const docList = res1.body.data;
    const doc = docList.find((d: any) => d.id === doctorId);
    expect(doc).toBeDefined();
    expect(doc.next_available_slot).toBeTruthy();

    const firstNextSlot = doc.next_available_slot;

    // 2. Book that exact slot
    const bookRes = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId, slotTime: firstNextSlot });
    expect(bookRes.status).toBe(201);

    // 3. Fetch doctors list again: next_available_slot must advance to the next slot!
    const res2 = await request(app).get("/doctors?specialty=Pediatrics");
    expect(res2.status).toBe(200);
    const updatedDoc = res2.body.data.find((d: any) => d.id === doctorId);
    expect(updatedDoc.next_available_slot).toBeTruthy();
    expect(updatedDoc.next_available_slot).not.toBe(firstNextSlot);
    expect(updatedDoc.next_available_slot > firstNextSlot).toBe(true);
  });
});
