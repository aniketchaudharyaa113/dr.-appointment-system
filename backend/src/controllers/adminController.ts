import { Response, NextFunction } from "express";
import pool from "../db/pool";
import { AuthRequest } from "../types";

// GET /admin/doctors/pending
export async function getPendingDoctors(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT d.id, d.specialty, d.clinic_name, d.clinic_address,
              d.license_number, u.name, u.email
       FROM doctors d JOIN users u ON u.id = d.user_id
       WHERE d.is_verified = false
       ORDER BY u.name`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// PATCH /admin/doctors/:id/verify   body: { approve: true|false }
export async function verifyDoctor(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { approve } = req.body;

    const result = await pool.query(
      `UPDATE doctors SET is_verified = $1 WHERE id = $2 RETURNING *`,
      [!!approve, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// GET /admin/appointments - every appointment on the platform
export async function getAllAppointments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT a.*, up.name AS patient_name, ud.name AS doctor_name, d.specialty
       FROM appointments a
       JOIN users up ON up.id = a.patient_id
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users ud ON ud.id = d.user_id
       ORDER BY a.slot_time DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// GET /admin/stats
export async function getStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const [totalBookings, activeDoctors, cancellations] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM appointments`),
      pool.query(`SELECT COUNT(*) FROM doctors WHERE is_verified = true`),
      pool.query(`SELECT COUNT(*) FROM appointments WHERE status = 'CANCELLED'`),
    ]);

    res.json({
      totalBookings: parseInt(totalBookings.rows[0].count, 10),
      activeDoctors: parseInt(activeDoctors.rows[0].count, 10),
      cancellations: parseInt(cancellations.rows[0].count, 10),
    });
  } catch (err) {
    next(err);
  }
}
