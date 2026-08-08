import { Response, NextFunction } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { AuthRequest } from "../types";

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

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}
