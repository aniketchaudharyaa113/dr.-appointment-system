import { Response, NextFunction } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { AuthRequest } from "../types";
import { cacheDelPattern } from "../cache/redis";
import { enqueueJob } from "../queue/messageQueue";

const reviewSchema = z.object({
  doctorId: z.string().uuid("doctorId must be a valid id"),
  rating: z.number().int().min(1).max(5, "rating must be a whole number between 1 and 5"),
  comment: z.string().max(1000).optional(),
});

// POST /reviews - only allowed after a COMPLETED appointment with that doctor
export async function createReview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const patientId = req.user!.id;
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { doctorId, rating, comment } = parsed.data;

    const completedCheck = await pool.query(
      `SELECT id FROM appointments
       WHERE patient_id = $1 AND doctor_id = $2 AND status = 'COMPLETED'
       LIMIT 1`,
      [patientId, doctorId]
    );

    if (completedCheck.rows.length === 0) {
      return res.status(403).json({ error: "You can only review a doctor after a completed appointment" });
    }

    const result = await pool.query(
      `INSERT INTO reviews (doctor_id, patient_id, rating, comment)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [doctorId, patientId, rating, comment || null]
    );

    // Invalidate doctor cache and list caches
    await cacheDelPattern(`medibook:doctor:${doctorId}*`);
    await cacheDelPattern("medibook:doctors:list:*");

    // Fetch doctor user id and patient name
    const [docUser, patientUser] = await Promise.all([
      pool.query("SELECT user_id FROM doctors WHERE id = $1", [doctorId]),
      pool.query("SELECT name FROM users WHERE id = $1", [patientId]),
    ]);

    if (docUser.rows.length > 0) {
      await enqueueJob("NOTIFICATION", {
        userId: docUser.rows[0].user_id,
        type: "NEW_REVIEW",
        title: "New Patient Review",
        message: `${patientUser.rows[0]?.name || "A patient"} left you a ${rating}★ review: "${comment || "No comment"}"`,
        link: "/doctor/dashboard",
      });
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}
