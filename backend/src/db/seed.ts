// Seeds the symptom_specialty_map table and creates one admin account.
// Run with: npm run seed

import bcrypt from "bcryptjs";
import pool from "./pool";

const symptomMap: [string, string][] = [
  ["chest pain", "Cardiologist"],
  ["heart palpitations", "Cardiologist"],
  ["toothache", "Dentist"],
  ["bleeding gums", "Dentist"],
  ["fever", "General Physician"],
  ["cough", "General Physician"],
  ["cold", "General Physician"],
  ["skin rash", "Dermatologist"],
  ["acne", "Dermatologist"],
  ["itching", "Dermatologist"],
  ["blurred vision", "Ophthalmologist"],
  ["eye pain", "Ophthalmologist"],
  ["ear pain", "ENT Specialist"],
  ["sore throat", "ENT Specialist"],
  ["hearing loss", "ENT Specialist"],
  ["joint pain", "Orthopedic"],
  ["back pain", "Orthopedic"],
  ["fracture", "Orthopedic"],
  ["anxiety", "Psychiatrist"],
  ["depression", "Psychiatrist"],
  ["stomach pain", "Gastroenterologist"],
  ["acidity", "Gastroenterologist"],
  ["nausea", "Gastroenterologist"],
  ["headache", "Neurologist"],
  ["migraine", "Neurologist"],
  ["dizziness", "Neurologist"],
  ["irregular periods", "Gynecologist"],
  ["pregnancy checkup", "Gynecologist"],
  ["child fever", "Pediatrician"],
  ["child vaccination", "Pediatrician"],
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Only seed if the table is empty, so re-running this is safe
    const existing = await client.query("SELECT COUNT(*) FROM symptom_specialty_map");
    if (parseInt(existing.rows[0].count, 10) === 0) {
      for (const [symptom, specialty] of symptomMap) {
        await client.query(
          "INSERT INTO symptom_specialty_map (symptom, specialty) VALUES ($1, $2)",
          [symptom, specialty]
        );
      }
      console.log(`Seeded ${symptomMap.length} symptom -> specialty mappings`);
    } else {
      console.log("symptom_specialty_map already has data, skipping");
    }

    // Create a default admin if none exists
    const adminCheck = await client.query("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1");
    if (adminCheck.rows.length === 0) {
      const hashed = await bcrypt.hash("admin123", 10);
      await client.query(
        "INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, 'ADMIN')",
        ["admin@medibook.com", hashed, "Admin"]
      );
      console.log("Created default admin: admin@medibook.com / admin123 (change this password!)");
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
