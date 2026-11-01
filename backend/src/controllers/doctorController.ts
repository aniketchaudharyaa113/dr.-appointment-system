import { Response, NextFunction } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { AuthRequest } from "../types";
import { SPECIALTIES } from "../constants";
import { nowInClinicTimezone, parseSlot } from "../utils/datetime";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  cacheDelPattern,
  getCacheVersion,
  cacheSetWithVersion,
  normalizeDoctorQueryKey,
} from "../cache/redis";
import { getIO } from "../sockets/slotEvents";
import { insertOutboxEvent } from "../queue/outboxRelay";
import { cancelAppointmentReminders } from "../services/reminderService";

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
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const version = await getCacheVersion("doctors:list");
    const cacheKey = normalizeDoctorQueryKey(req.query, version);
    const cached = await cacheGet<any>(cacheKey);
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

    const countQuery = `
      SELECT COUNT(DISTINCT d.id)::int AS total
      FROM doctors d
      WHERE ${conditions.join(" AND ")}
    `;
    const countRes = await pool.query(countQuery, values);
    const total = countRes.rows[0].total;

    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

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
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const result = await pool.query(query, values);
    const responsePayload = {
      data: result.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + result.rows.length < total,
      },
    };
    await cacheSetWithVersion("doctors:list", version, cacheKey, responsePayload, 120); // 2 min cache
    res.json(responsePayload);
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
    const dryRun = req.query.dryRun === "true";

    const doctorResult = await client.query("SELECT id FROM doctors WHERE user_id = $1", [userId]);
    if (doctorResult.rows.length === 0) {
      return res.status(404).json({ error: "Doctor profile not found" });
    }
    const doctorId = doctorResult.rows[0].id;

    // Normalize new slots
    const normalizedSlots = (slots || []).map((s: any) => ({
      dayOfWeek: Number(s.dayOfWeek),
      startTime: String(s.startTime).length === 5 ? `${s.startTime}:00` : String(s.startTime),
      endTime: String(s.endTime).length === 5 ? `${s.endTime}:00` : String(s.endTime),
      slotDurationMinutes: Number(s.slotDurationMinutes) || 15,
    }));

    const timeToMinutes = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };

    // Find future active appointments for this doctor
    const nowClinic = nowInClinicTimezone();
    const pad = (n: number) => String(n).padStart(2, "0");
    const nowIso = `${nowClinic.year}-${pad(nowClinic.month)}-${pad(nowClinic.day)} ${nowClinic.hhmmss}`;

    const futureAppts = await client.query(
      `SELECT a.*, u.email as patient_email, u.name as patient_name
       FROM appointments a
       JOIN users u ON u.id = a.patient_id
       WHERE a.doctor_id = $1
         AND a.status IN ('CONFIRMED', 'PENDING')
         AND a.slot_time >= $2`,
      [doctorId, nowIso]
    );

    const affectedAppointments = futureAppts.rows.filter((appt) => {
      const p = parseSlot(String(appt.slot_time));
      if (!p) return false;
      const apptMins = timeToMinutes(p.hhmmss);

      // Check if any slot in normalizedSlots covers this appointment
      const matched = normalizedSlots.some((slot: any) => {
        if (slot.dayOfWeek !== p.dayOfWeek) return false;
        const startMins = timeToMinutes(slot.startTime);
        const endMins = timeToMinutes(slot.endTime);
        const duration = slot.slotDurationMinutes;

        // Is it inside window?
        if (apptMins < startMins || apptMins + duration > endMins) return false;
        // Is it aligned?
        if ((apptMins - startMins) % duration !== 0) return false;

        return true;
      });

      return !matched; // affected if not covered by any new slot
    });

    const affectedCount = affectedAppointments.length;

    if (dryRun) {
      return res.json({
        dryRun: true,
        affectedCount,
        affectedAppointments: affectedAppointments.map((a) => ({
          id: a.id,
          slotTime: a.slot_time,
          patientName: a.patient_name,
          bookingRef: a.booking_ref,
        })),
      });
    }

    await client.query("BEGIN");
    inTransaction = true;
    await client.query("DELETE FROM availability WHERE doctor_id = $1", [doctorId]);

    for (const slot of normalizedSlots) {
      await client.query(
        `INSERT INTO availability (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
         VALUES ($1, $2, $3, $4, $5)`,
        [doctorId, slot.dayOfWeek, slot.startTime, slot.endTime, slot.slotDurationMinutes]
      );
    }

    if (affectedCount > 0) {
      const affectedIds = affectedAppointments.map((a) => a.id);
      await client.query(
        `UPDATE appointments
         SET status = 'CANCELLED',
             notes = COALESCE(notes || ' | ', '') || 'Cancelled due to doctor schedule reduction'
         WHERE id = ANY($1::uuid[])`,
        [affectedIds]
      );

      // Insert transactional outbox events
      for (const appt of affectedAppointments) {
        await insertOutboxEvent(client, {
          aggregateType: "APPOINTMENT",
          aggregateId: appt.id,
          eventType: "NOTIFICATION",
          payload: {
            userId: appt.patient_id,
            type: "APPOINTMENT_CANCELLED",
            title: "Appointment Cancelled",
            message: `Your appointment at ${String(appt.slot_time).slice(0, 16)} was cancelled because the doctor modified their schedule. Booking Ref: ${appt.booking_ref}`,
            link: "/my-appointments",
          },
        });

        await insertOutboxEvent(client, {
          aggregateType: "APPOINTMENT",
          aggregateId: appt.id,
          eventType: "AUDIT",
          payload: {
            actorId: userId,
            actorRole: "DOCTOR",
            action: "APPOINTMENT_CANCELLED_BY_SCHEDULE_CHANGE",
            targetId: appt.id,
            details: { doctorId, slotTime: appt.slot_time, bookingRef: appt.booking_ref },
          },
        });
      }
    }

    await client.query("COMMIT");
    inTransaction = false;

    await cacheDel(`medibook:doctor:${doctorId}`);
    await cacheDel(`medibook:slots:${doctorId}`);
    await cacheDelPattern(`medibook:admin:*`);

    // Emit socket events to doctor room and cancel BullMQ reminders
    for (const appt of affectedAppointments) {
      getIO().to(`doctor:${doctorId}`).emit("slot-freed", { doctorId, slotTime: appt.slot_time });
      await cancelAppointmentReminders(appt.id);
    }

    res.json({ message: "Availability updated", affectedCount });
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
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const userId = req.user!.id;
    const { leaveDate, reason } = req.body;
    const dryRun = req.query.dryRun === "true";

    if (!leaveDate) {
      return res.status(400).json({ error: "leaveDate is required (YYYY-MM-DD)" });
    }

    const docRes = await client.query("SELECT id FROM doctors WHERE user_id = $1", [userId]);
    if (docRes.rows.length === 0) return res.status(404).json({ error: "Doctor not found" });
    const doctorId = docRes.rows[0].id;

    // Find affected CONFIRMED / PENDING appointments on this leave date
    const affectedRes = await client.query(
      `SELECT a.*, u.email as patient_email, u.name as patient_name
       FROM appointments a
       JOIN users u ON u.id = a.patient_id
       WHERE a.doctor_id = $1
         AND a.status IN ('CONFIRMED', 'PENDING')
         AND a.slot_time::date = $2::date`,
      [doctorId, leaveDate]
    );
    const affectedAppointments = affectedRes.rows;
    const affectedCount = affectedAppointments.length;

    if (dryRun) {
      return res.json({
        dryRun: true,
        affectedCount,
        affectedAppointments: affectedAppointments.map((a) => ({
          id: a.id,
          slotTime: a.slot_time,
          patientName: a.patient_name,
          bookingRef: a.booking_ref,
        })),
      });
    }

    await client.query("BEGIN");
    inTransaction = true;

    const leaveResult = await client.query(
      `INSERT INTO doctor_leaves (doctor_id, leave_date, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (doctor_id, leave_date) DO UPDATE SET reason = $3
       RETURNING *`,
      [doctorId, leaveDate, reason || "On Leave"]
    );

    if (affectedCount > 0) {
      await client.query(
        `UPDATE appointments
         SET status = 'CANCELLED',
             notes = COALESCE(notes || ' | ', '') || 'Cancelled due to doctor leave: ' || $3
         WHERE doctor_id = $1
           AND status IN ('CONFIRMED', 'PENDING')
           AND slot_time::date = $2::date`,
        [doctorId, leaveDate, reason || "Doctor on leave"]
      );
      // Insert outbox events
      for (const appt of affectedAppointments) {
        await insertOutboxEvent(client, {
          aggregateType: "APPOINTMENT",
          aggregateId: appt.id,
          eventType: "NOTIFICATION",
          payload: {
            userId: appt.patient_id,
            type: "APPOINTMENT_CANCELLED",
            title: "Appointment Cancelled",
            message: `Your appointment on ${leaveDate} was cancelled due to doctor leave (${reason || "Doctor on leave"}). Booking Ref: ${appt.booking_ref}`,
            link: "/my-appointments",
          },
        });

        await insertOutboxEvent(client, {
          aggregateType: "APPOINTMENT",
          aggregateId: appt.id,
          eventType: "AUDIT",
          payload: {
            actorId: userId,
            actorRole: "DOCTOR",
            action: "APPOINTMENT_CANCELLED_BY_LEAVE",
            targetId: appt.id,
            details: { doctorId, leaveDate, reason: reason || "Doctor on leave" },
          },
        });
      }
    }

    await client.query("COMMIT");
    inTransaction = false;

    await cacheDel(`medibook:doctor:${doctorId}`);
    await cacheDel(`medibook:slots:${doctorId}`);
    await cacheDelPattern(`medibook:admin:*`);

    // Emit socket events to doctor room and cancel BullMQ reminders
    for (const appt of affectedAppointments) {
      getIO().to(`doctor:${doctorId}`).emit("slot-freed", { doctorId, slotTime: appt.slot_time });
      await cancelAppointmentReminders(appt.id);
    }

    res.status(201).json({
      ...leaveResult.rows[0],
      affectedCount,
    });
  } catch (err) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    next(err);
  } finally {
    client.release();
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
