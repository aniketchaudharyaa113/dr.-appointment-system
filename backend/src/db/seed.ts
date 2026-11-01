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
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;

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

    // Create demo patient if none exists
    const patientCheck = await client.query("SELECT id FROM users WHERE email = 'patient@medibook.com' LIMIT 1");
    if (patientCheck.rows.length === 0) {
      const patientHash = await bcrypt.hash("patient123", 10);
      await client.query(
        "INSERT INTO users (email, password, name, phone, role) VALUES ($1, $2, $3, $4, 'PATIENT')",
        ["patient@medibook.com", patientHash, "Demo Patient", "9876543210"]
      );
      console.log("Created demo patient: patient@medibook.com / patient123");
    }

    // Seed sample verified doctors if doctors table is empty
    const doctorsCount = await client.query("SELECT COUNT(*) FROM doctors");
    if (parseInt(doctorsCount.rows[0].count, 10) === 0) {
      const docPassword = await bcrypt.hash("doctor123", 10);

      const demoDoctors = [
        {
          name: "Dr. Ananya Roy",
          email: "ananya.roy@medibook.com",
          phone: "9830112233",
          specialty: "Cardiologist",
          qualifications: "MBBS, MD (Cardiology), FACC",
          experienceYears: 14,
          clinicName: "Pulse Heart Care Clinic",
          clinicAddress: "Park Street, Kolkata, West Bengal",
          clinicLat: 22.5532,
          clinicLng: 88.3524,
          consultationFee: 800,
          licenseNumber: "WBMC-78921",
        },
        {
          name: "Dr. Rahul Sharma",
          email: "rahul.sharma@medibook.com",
          phone: "9830223344",
          specialty: "General Physician",
          qualifications: "MBBS, MD (General Medicine)",
          experienceYears: 10,
          clinicName: "Apex Family Health Center",
          clinicAddress: "Salt Lake Sector 1, Kolkata, West Bengal",
          clinicLat: 22.5867,
          clinicLng: 88.4178,
          consultationFee: 500,
          licenseNumber: "WBMC-65412",
        },
        {
          name: "Dr. Priya Patel",
          email: "priya.patel@medibook.com",
          phone: "9830334455",
          specialty: "Dermatologist",
          qualifications: "MBBS, DVD, MD (Dermatology)",
          experienceYears: 8,
          clinicName: "Glow Skin & Laser Center",
          clinicAddress: "Ballygunge, Kolkata, West Bengal",
          clinicLat: 22.5280,
          clinicLng: 88.3654,
          consultationFee: 650,
          licenseNumber: "WBMC-88231",
        },
      ];

      for (const d of demoDoctors) {
        const uRes = await client.query(
          "INSERT INTO users (email, password, name, phone, role) VALUES ($1, $2, $3, $4, 'DOCTOR') RETURNING id",
          [d.email, docPassword, d.name, d.phone]
        );
        const uId = uRes.rows[0].id;

        const docRes = await client.query(
          `INSERT INTO doctors (
            user_id, specialty, qualifications, experience_years,
            clinic_name, clinic_address, clinic_lat, clinic_lng,
            consultation_fee, license_number, is_verified
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true) RETURNING id`,
          [
            uId, d.specialty, d.qualifications, d.experienceYears,
            d.clinicName, d.clinicAddress, d.clinicLat, d.clinicLng,
            d.consultationFee, d.licenseNumber
          ]
        );
        const docId = docRes.rows[0].id;

        // Add Mon-Sat availability (days 1 to 6) 9:00 - 13:00 and 15:00 - 18:00
        for (let day = 1; day <= 6; day++) {
          await client.query(
            `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
             VALUES ($1, $2, '09:00:00', '13:00:00', 30),
                    ($1, $2, '15:00:00', '18:00:00', 30)`,
            [docId, day]
          );
        }
      }
      console.log(`Seeded ${demoDoctors.length} verified starter doctors with weekly availability`);
    }

    await client.query("COMMIT");
    inTransaction = false;
  } catch (err) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    console.error("Seed failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
