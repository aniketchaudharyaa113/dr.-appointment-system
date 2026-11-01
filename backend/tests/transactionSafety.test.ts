import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 1 - Task 1.3: Transaction rollback safety", () => {
  let patientToken: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);
    const pRes = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ('tx.patient@medibook.test', $1, 'Tx Patient', 'PATIENT')
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

  it("handles early rejection before transaction start without issuing ROLLBACK", async () => {
    // Calling with missing doctorId or invalid slotTime returns 400 before BEGIN
    const res = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ doctorId: "00000000-0000-0000-0000-000000000000", slotTime: "invalid-time" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();

    // Pool remains completely healthy and responsive
    const ping = await pool.query("SELECT 1 AS ok");
    expect(ping.rows[0].ok).toBe(1);
  });
});
