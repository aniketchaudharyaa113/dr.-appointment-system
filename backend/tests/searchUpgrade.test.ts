import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../src/app";
import { startTestEnvironment, stopTestEnvironment } from "./setup";
import pool from "../src/db/pool";

describe("Phase 6 - Task 6.5: pg_trgm Search Upgrade and Advanced Filters", () => {
  let doc1Id: string;
  let doc2Id: string;

  beforeAll(async () => {
    await startTestEnvironment();

    const passwordHash = await bcrypt.hash("password123", 10);

    // Doctor 1: Cardiologist in Mumbai, 500 fee, 5 stars
    const u1 = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ('doc.trgm1@medibook.test', $1, 'Dr. Heart', 'DOCTOR') RETURNING id`,
      [passwordHash]
    );
    const d1 = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, clinic_lat, clinic_lng, consultation_fee, is_verified, experience_years)
       VALUES ($1, 'Cardiologist', 'DM Cardiology', 'Heart Centre', 'Mumbai', 19.07, 72.87, 500, true, 15)
       RETURNING id`,
      [u1.rows[0].id]
    );
    doc1Id = d1.rows[0].id;

    // Doctor 2: Pulmonologist in Delhi, 300 fee, 3 stars
    const u2 = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ('doc.trgm2@medibook.test', $1, 'Dr. Lung', 'DOCTOR') RETURNING id`,
      [passwordHash]
    );
    const d2 = await pool.query(
      `INSERT INTO doctors (user_id, specialty, qualifications, clinic_name, clinic_address, clinic_lat, clinic_lng, consultation_fee, is_verified, experience_years)
       VALUES ($1, 'Pulmonologist', 'MD Pulmonology', 'Breathing Care', 'Delhi', 28.61, 77.20, 300, true, 8)
       RETURNING id`,
      [u2.rows[0].id]
    );
    doc2Id = d2.rows[0].id;

    // Doctor 1 has availability
    for (let day = 0; day <= 6; day++) {
      await pool.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, '09:00:00', '18:00:00', 15)`,
        [doc1Id, day]
      );
      await pool.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, '09:00:00', '18:00:00', 15)`,
        [doc2Id, day]
      );
    }

    // Add review for Doctor 1 (5 stars)
    const patientUser = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ('patient.trgm@medibook.test', $1, 'Reviewer', 'PATIENT') RETURNING id`,
      [passwordHash]
    );
    await pool.query(
      `INSERT INTO reviews (doctor_id, patient_id, rating, comment) VALUES ($1, $2, 5, 'Excellent heart specialist')`,
      [doc1Id, patientUser.rows[0].id]
    );

    // Seed multiple symptoms for similarity
    await pool.query(`DELETE FROM symptom_specialty_map`);
    await pool.query(`
      INSERT INTO symptom_specialty_map (symptom, specialty) VALUES
      ('chest pain', 'Cardiologist'),
      ('chest tightness and breathing difficulty', 'Pulmonologist'),
      ('chest congestion and cough', 'General Physician')
    `);
  });

  afterAll(async () => {
    await stopTestEnvironment();
  });

  it("returns top 3 matching specialties ranked by pg_trgm similarity", async () => {
    const res = await request(app).get("/search/symptom?q=chest%20discomfort");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("matches");
    expect(Array.isArray(res.body.matches)).toBe(true);
    expect(res.body.matches.length).toBeGreaterThan(0);
    expect(res.body.matches.length).toBeLessThanOrEqual(3);

    // Each match has specialty, matchedSymptom, and similarity score
    for (const match of res.body.matches) {
      expect(match).toHaveProperty("specialty");
      expect(match).toHaveProperty("matchedSymptom");
      expect(match).toHaveProperty("similarity");
      expect(typeof match.similarity).toBe("number");
    }

    // Top match is primary specialty
    expect(res.body.specialty).toBe(res.body.matches[0].specialty);
  });

  it("applies fee range, minRating, and sort filters properly", async () => {
    // 1. Fee filter: maxFee=400 should return only Doctor 2 (fee 300)
    const feeRes = await request(app).get("/search/symptom?q=chest%20pain&maxFee=400");
    expect(feeRes.status).toBe(200);
    expect(feeRes.body.doctors.every((d: any) => Number(d.consultation_fee) <= 400)).toBe(true);

    // 2. Rating filter: minRating=4.0 should return Doctor 1 (5 stars) and exclude Doctor 2 (0 reviews)
    const ratingRes = await request(app).get("/search/symptom?q=chest%20pain&minRating=4.0");
    expect(ratingRes.status).toBe(200);
    expect(ratingRes.body.doctors.every((d: any) => Number(d.avg_rating) >= 4.0)).toBe(true);

    // 3. Sorting by rating
    const sortRes = await request(app).get("/search/symptom?q=chest%20pain&sort=rating");
    expect(sortRes.status).toBe(200);
    if (sortRes.body.doctors.length > 1) {
      expect(sortRes.body.doctors[0].avg_rating >= sortRes.body.doctors[1].avg_rating).toBe(true);
    }
  });
});
