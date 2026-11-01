import { Response, NextFunction } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { AuthRequest } from "../types";
import { cacheDelPattern } from "../cache/redis";
import { insertOutboxEvent } from "../queue/outboxRelay";

const reviewSchema = z.object({
  appointmentId: z.string().uuid("appointmentId must be a valid id").optional(),
  doctorId: z.string().uuid("doctorId must be a valid id").optional(),
  rating: z.number().int().min(1).max(5, "rating must be a whole number between 1 and 5"),
  comment: z.string().max(1000).optional(),
});

// POST /reviews - only allowed after a COMPLETED appointment with that doctor, 1 review per appointment
export async function createReview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const patientId = req.user!.id;
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { appointmentId, doctorId, rating, comment } = parsed.data;

    let apptId = appointmentId;
    let docId = doctorId;

    if (apptId) {
      const apptRes = await pool.query(
        `SELECT id, doctor_id, patient_id, status FROM appointments WHERE id = $1`,
        [apptId]
      );
      if (apptRes.rows.length === 0) {
        return res.status(404).json({ error: "Appointment not found" });
      }
      const appt = apptRes.rows[0];
      if (appt.patient_id !== patientId) {
        return res.status(403).json({ error: "You can only review your own appointments" });
      }
      if (appt.status !== "COMPLETED") {
        return res
          .status(400)
          .json({ error: "You can only review a doctor after a completed appointment" });
      }
      docId = appt.doctor_id;
    } else if (docId) {
      const completedCheck = await pool.query(
        `SELECT a.id, a.doctor_id
         FROM appointments a
         LEFT JOIN reviews r ON r.appointment_id = a.id
         WHERE a.patient_id = $1 AND a.doctor_id = $2 AND a.status = 'COMPLETED' AND r.id IS NULL
         ORDER BY a.slot_time DESC
         LIMIT 1`,
        [patientId, docId]
      );
      if (completedCheck.rows.length === 0) {
        return res.status(403).json({
          error:
            "You can only review a doctor after a completed appointment (or this appointment was already reviewed)",
        });
      }
      apptId = completedCheck.rows[0].id;
    } else {
      return res.status(400).json({ error: "Either appointmentId or doctorId is required" });
    }

    const existingReview = await pool.query(`SELECT id FROM reviews WHERE appointment_id = $1`, [
      apptId,
    ]);
    if (existingReview.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "This completed appointment has already been reviewed" });
    }

    const result = await pool.query(
      `INSERT INTO reviews (doctor_id, patient_id, appointment_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [docId, patientId, apptId, rating, comment || null]
    );

    // Invalidate doctor cache and list caches
    await cacheDelPattern(`medibook:doctor:${docId}*`);
    await cacheDelPattern("medibook:doctors:list:*");

    // Fetch doctor user id and patient name
    const [docUser, patientUser] = await Promise.all([
      pool.query("SELECT user_id FROM doctors WHERE id = $1", [docId]),
      pool.query("SELECT name FROM users WHERE id = $1", [patientId]),
    ]);

    if (docUser.rows.length > 0) {
      await insertOutboxEvent(pool, {
        aggregateType: "REVIEW",
        aggregateId: result.rows[0].id,
        eventType: "NOTIFICATION",
        payload: {
          userId: docUser.rows[0].user_id,
          type: "NEW_REVIEW",
          title: "New Patient Review",
          message: `${patientUser.rows[0]?.name || "A patient"} left you a ${rating}★ review: "${comment || "No comment"}"`,
          link: "/doctor/dashboard",
        },
      });
    }

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "This appointment has already been reviewed" });
    }
    next(err);
  }
}
