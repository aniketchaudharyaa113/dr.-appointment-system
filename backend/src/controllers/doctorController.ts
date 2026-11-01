import { Response, NextFunction } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { AuthRequest } from "../types";
import { SPECIALTIES } from "../constants";
import { nowInClinicTimezone } from "../utils/datetime";
import { cacheGet, cacheSet, cacheDel, cacheDelPattern } from "../cache/redis";

const emptyToUndefined = (val: unknown) => (val === "" ? undefined : val);

const profileUpdateSchema = z.object({
  specialty: z.preprocess(emptyToUndefined, z.enum(SPECIALTIES).optional()),
  qualifications: z.string().optional(),
  experienceYears: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).optional()),
  clinicName: z.string().optional(),
  clinicAddress: z.string().optional(),
  clinicLat: z.preprocess(emptyToUndefined, z.coerce.number().min(-90).max(90).optional()),
  clinicLng: z.preprocess(emptyToUndefined, z.coerce.number().min(-180).max(180).optional()),
  consultationFee: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  licenseNumber: z.string().optional(),
  photoUrl: z.string().optional(),
});

// GET /doctors?specialty=Cardiologist&city=Kolkata&maxFee=500
// Public - only shows verified doctors
export async function getDoctors(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { specialty, city, maxFee } = req.query;

    const cacheKey = `medibook:doctors:list:${specialty || ""}:${city || ""}:${maxFee || ""}`;
    const cached = await cacheGet<any[]>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const conditions: string[] = ["d.is_verified = true"];
    const values: any[] = [];

    if (specialty) {
      values.push(specialty);
      conditions.push(`d.specialty ILIKE $${values.length}`);
    }
    if (city) {
      values.push(`%${city}%`);
      conditions.push(`d.clinic_address ILIKE $${values.length}`);
    }
    if (maxFee) {
      const parsedFee = Number(maxFee);
      if (Number.isNaN(parsedFee)) {
        return res.status(400).json({ error: "maxFee must be a number" });
      }
      values.push(parsedFee);
      conditions.push(`d.consultation_fee <= $${values.length}`);
    }

    const query = `
      SELECT d.id, d.specialty, d.qualifications, d.experience_years,
             d.clinic_name, d.clinic_address, d.consultation_fee, d.photo_url,
             u.name,
             ROUND(COALESCE(AVG(r.rating), 0), 1)::float AS avg_rating,
             COUNT(r.id)::int AS review_count
      FROM doctors d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN reviews r ON r.doctor_id = d.id
      WHERE ${conditions.join(" AND ")}
      GROUP BY d.id, u.name
      ORDER BY d.experience_years DESC
    `;

    const result = await pool.query(query, values);
    await cacheSet(cacheKey, result.rows, 120); // 2 min cache
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// GET /doctors/:id - full profile including availability, leaves + reviews
export async function getDoctorById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const cacheKey = `medibook:doctor:${id}`;
    const cached = await cacheGet<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const doctorResult = await pool.query(
      `SELECT d.*, u.name
       FROM doctors d JOIN users u ON u.id = d.user_id
       WHERE d.id = $1 AND d.is_verified = true`,
      [id]
    );
    if (doctorResult.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    const availability = await pool.query(
      `SELECT day_of_week, start_time, end_time, slot_duration_minutes
       FROM availability WHERE doctor_id = $1 ORDER BY day_of_week`,
      [id]
    );

    const leaves = await pool.query(
      `SELECT leave_date, reason FROM doctor_leaves
       WHERE doctor_id = $1 AND leave_date >= CURRENT_DATE
       ORDER BY leave_date`,
      [id]
    );

    const reviews = await pool.query(
      `SELECT r.rating, r.comment, r.created_at, u.name AS patient_name
       FROM reviews r JOIN users u ON u.id = r.patient_id
       WHERE r.doctor_id = $1 ORDER BY r.created_at DESC`,
      [id]
    );

    const payload = {
      ...doctorResult.rows[0],
      availability: availability.rows,
      leaves: leaves.rows.map((l) => l.leave_date),
      reviews: reviews.rows,
    };

    await cacheSet(cacheKey, payload, 300); // 5 min cache
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

// GET /doctors/me - the logged-in doctor's own profile
export async function getMyProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    const doctorResult = await pool.query(
      `SELECT d.*, u.name, u.phone, u.email
       FROM doctors d JOIN users u ON u.id = d.user_id
       WHERE d.user_id = $1`,
      [userId]
    );
    if (doctorResult.rows.length === 0) {
      return res.status(404).json({ error: "Doctor profile not found" });
    }

    const docId = doctorResult.rows[0].id;

    const availability = await pool.query(
      `SELECT day_of_week, start_time, end_time, slot_duration_minutes
       FROM availability WHERE doctor_id = $1 ORDER BY day_of_week`,
      [docId]
    );

    const leaves = await pool.query(
      `SELECT id, leave_date, reason FROM doctor_leaves
       WHERE doctor_id = $1 AND leave_date >= CURRENT_DATE
       ORDER BY leave_date`,
      [docId]
    );

    res.json({
      ...doctorResult.rows[0],
      availability: availability.rows,
      leaves: leaves.rows,
    });
  } catch (err) {
    next(err);
  }
}

// GET /doctors/:id/booked-slots
export async function getBookedSlots(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const cacheKey = `medibook:slots:${id}`;

    const cached = await cacheGet<string[]>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    const now = nowInClinicTimezone();
    const nowAsNaiveTimestamp = `${now.year}-${pad(now.month)}-${pad(now.day)} ${now.hhmmss}`;

    const result = await pool.query(
      `SELECT slot_time FROM appointments
       WHERE doctor_id = $1
         AND status IN ('PENDING', 'CONFIRMED')
         AND slot_time > $2
       ORDER BY slot_time`,
      [id, nowAsNaiveTimestamp]
    );

    const slots = result.rows.map((r) => r.slot_time);
    await cacheSet(cacheKey, slots, 60); // 1 min cache
    res.json(slots);
  } catch (err) {
    next(err);
  }
}

// PATCH /doctors/me - update profile
export async function updateMyProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const {
      specialty, qualifications, experienceYears, clinicName,
      clinicAddress, clinicLat, clinicLng, consultationFee,
      licenseNumber, photoUrl,
    } = parsed.data;

    const values = [
      specialty ?? null, qualifications ?? null, experienceYears ?? null,
      clinicName ?? null, clinicAddress ?? null, clinicLat ?? null,
      clinicLng ?? null, consultationFee ?? null, licenseNumber ?? null,
      photoUrl ?? null, userId,
    ];

    const result = await pool.query(
      `UPDATE doctors SET
         specialty = COALESCE($1, specialty),
         qualifications = COALESCE($2, qualifications),
         experience_years = COALESCE($3, experience_years),
         clinic_name = COALESCE($4, clinic_name),
         clinic_address = COALESCE($5, clinic_address),
         clinic_lat = COALESCE($6, clinic_lat),
         clinic_lng = COALESCE($7, clinic_lng),
         consultation_fee = COALESCE($8, consultation_fee),
         license_number = COALESCE($9, license_number),
         photo_url = COALESCE($10, photo_url)
       WHERE user_id = $11
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Doctor profile not found" });
    }

    const docId = result.rows[0].id;
    await cacheDel(`medibook:doctor:${docId}`);
    await cacheDelPattern("medibook:doctors:list:*");

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// PATCH /doctors/me/availability
export async function setAvailability(req: AuthRequest, res: Response, next: NextFunction) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const userId = req.user!.id;
    const { slots } = req.body;

    const doctorResult = await client.query("SELECT id FROM doctors WHERE user_id = $1", [userId]);
    if (doctorResult.rows.length === 0) {
      return res.status(404).json({ error: "Doctor profile not found" });
    }
    const doctorId = doctorResult.rows[0].id;

    await client.query("BEGIN");
    inTransaction = true;
    await client.query("DELETE FROM availability WHERE doctor_id = $1", [doctorId]);

    for (const slot of slots || []) {
      await client.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, $3, $4, $5)`,
        [doctorId, slot.dayOfWeek, slot.startTime, slot.endTime, slot.slotDurationMinutes || 15]
      );
    }

    await client.query("COMMIT");
    inTransaction = false;

    await cacheDel(`medibook:doctor:${doctorId}`);
    await cacheDel(`medibook:slots:${doctorId}`);

    res.json({ message: "Availability updated" });
  } catch (err) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    next(err);
  } finally {
    client.release();
  }
}

// POST /doctors/me/leaves - add blackout date
export async function addDoctorLeave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { leaveDate, reason } = req.body;

    if (!leaveDate) {
      return res.status(400).json({ error: "leaveDate is required (YYYY-MM-DD)" });
    }

    const docRes = await pool.query("SELECT id FROM doctors WHERE user_id = $1", [userId]);
    if (docRes.rows.length === 0) return res.status(404).json({ error: "Doctor not found" });
    const doctorId = docRes.rows[0].id;

    const result = await pool.query(
      `INSERT INTO doctor_leaves (doctor_id, leave_date, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (doctor_id, leave_date) DO UPDATE SET reason = $3
       RETURNING *`,
      [doctorId, leaveDate, reason || "On Leave"]
    );

    await cacheDel(`medibook:doctor:${doctorId}`);
    await cacheDel(`medibook:slots:${doctorId}`);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// DELETE /doctors/me/leaves/:date
export async function removeDoctorLeave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { date } = req.params;

    const docRes = await pool.query("SELECT id FROM doctors WHERE user_id = $1", [userId]);
    if (docRes.rows.length === 0) return res.status(404).json({ error: "Doctor not found" });
    const doctorId = docRes.rows[0].id;

    await pool.query(
      "DELETE FROM doctor_leaves WHERE doctor_id = $1 AND leave_date = $2",
      [doctorId, date]
    );

    await cacheDel(`medibook:doctor:${doctorId}`);
    await cacheDel(`medibook:slots:${doctorId}`);

    res.json({ message: "Leave date removed" });
  } catch (err) {
    next(err);
  }
}

// GET /doctors/me/earnings
export async function getMyEarnings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT COALESCE(SUM(d.consultation_fee), 0) AS total_earnings,
              COUNT(*) AS completed_appointments
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       WHERE d.user_id = $1 AND a.status = 'COMPLETED'`,
      [userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}
