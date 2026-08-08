import { Response, NextFunction } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { AuthRequest } from "../types";
import { SPECIALTIES } from "../constants";
import { nowInClinicTimezone } from "../utils/datetime";

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
             u.name
      FROM doctors d
      JOIN users u ON u.id = d.user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY d.experience_years DESC
    `;

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// GET /doctors/:id - full profile including availability + reviews
// Public route - only exposes verified doctors, same as the list endpoint.
// (An unverified doctor's own profile is fetched via GET /doctors/me instead.)
export async function getDoctorById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

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

    const reviews = await pool.query(
      `SELECT r.rating, r.comment, r.created_at, u.name AS patient_name
       FROM reviews r JOIN users u ON u.id = r.patient_id
       WHERE r.doctor_id = $1 ORDER BY r.created_at DESC`,
      [id]
    );

    res.json({
      ...doctorResult.rows[0],
      availability: availability.rows,
      reviews: reviews.rows,
    });
  } catch (err) {
    next(err);
  }
}

// GET /doctors/me - the logged-in doctor's own profile, regardless of verification status
// (unlike GET /doctors/:id, which only returns verified doctors)
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

    const availability = await pool.query(
      `SELECT day_of_week, start_time, end_time, slot_duration_minutes
       FROM availability WHERE doctor_id = $1 ORDER BY day_of_week`,
      [doctorResult.rows[0].id]
    );

    res.json({ ...doctorResult.rows[0], availability: availability.rows });
  } catch (err) {
    next(err);
  }
}

// GET /doctors/:id/booked-slots - public. Lets the frontend grey out
// already-taken slots on page load instead of only discovering them
// via a live socket event or a failed booking attempt.
export async function getBookedSlots(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
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

    res.json(result.rows.map((r) => r.slot_time));
  } catch (err) {
    next(err);
  }
}

// PATCH /doctors/me - the logged-in doctor fills out/updates their own profile
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

    // pg rejects `undefined` params outright (it only accepts null for "no value"),
    // so any field the frontend didn't send needs to be normalized here first.
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

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// PATCH /doctors/me/availability - replace the doctor's weekly schedule
export async function setAvailability(req: AuthRequest, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const userId = req.user!.id;
    const { slots } = req.body; // [{ dayOfWeek, startTime, endTime, slotDurationMinutes }]

    const doctorResult = await client.query("SELECT id FROM doctors WHERE user_id = $1", [userId]);
    if (doctorResult.rows.length === 0) {
      return res.status(404).json({ error: "Doctor profile not found" });
    }
    const doctorId = doctorResult.rows[0].id;

    await client.query("BEGIN");
    await client.query("DELETE FROM availability WHERE doctor_id = $1", [doctorId]);

    for (const slot of slots) {
      await client.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, $3, $4, $5)`,
        [doctorId, slot.dayOfWeek, slot.startTime, slot.endTime, slot.slotDurationMinutes || 15]
      );
    }

    await client.query("COMMIT");
    res.json({ message: "Availability updated" });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

// GET /doctors/me/earnings - sum of completed appointment fees
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
