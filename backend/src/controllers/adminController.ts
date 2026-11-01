import { Response, NextFunction } from "express";
import pool from "../db/pool";
import { AuthRequest } from "../types";
import { cacheGet, cacheSet, cacheDelPattern } from "../cache/redis";
import { enqueueJob } from "../queue/messageQueue";

// GET /admin/doctors/pending
export async function getPendingDoctors(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT d.id, d.specialty, d.clinic_name, d.clinic_address,
              d.license_number, d.qualifications, d.experience_years,
              u.name, u.email, u.phone
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
    const adminId = req.user!.id;

    const result = await pool.query(
      `UPDATE doctors SET is_verified = $1
       WHERE id = $2
       RETURNING *`,
      [!!approve, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    const doc = result.rows[0];

    // Invalidate caches
    await cacheDelPattern("medibook:doctors:list:*");
    await cacheDelPattern(`medibook:doctor:${id}*`);
    await cacheDelPattern("medibook:admin:*");

    // Asynchronously notify doctor and record audit log
    await enqueueJob("NOTIFICATION", {
      userId: doc.user_id,
      type: approve ? "DOCTOR_VERIFIED" : "DOCTOR_REJECTED",
      title: approve ? "Verification Approved!" : "Verification Update",
      message: approve
        ? "Congratulations! Your clinic verification was approved. You are now active in patient searches."
        : "Your verification request was not approved. Please review your credentials.",
      link: "/doctor/dashboard",
    });

    await enqueueJob("AUDIT", {
      actorId: adminId,
      actorRole: "ADMIN",
      action: approve ? "DOCTOR_VERIFIED" : "DOCTOR_REJECTED",
      targetId: id,
      details: { doctorId: id, approved: !!approve },
    });

    res.json(doc);
  } catch (err) {
    next(err);
  }
}

// GET /admin/appointments - with optional status & search filtering
export async function getAllAppointments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { q, status } = req.query;

    const conditions: string[] = ["1=1"];
    const values: any[] = [];

    if (status) {
      values.push(status);
      conditions.push(`a.status = $${values.length}`);
    }

    if (q) {
      values.push(`%${q}%`);
      const idx = values.length;
      conditions.push(
        `(a.booking_ref ILIKE $${idx} OR up.name ILIKE $${idx} OR ud.name ILIKE $${idx} OR d.clinic_name ILIKE $${idx})`
      );
    }

    const query = `
      SELECT a.*, up.name AS patient_name, up.email AS patient_email,
             ud.name AS doctor_name, d.specialty, d.clinic_name
      FROM appointments a
      JOIN users up ON up.id = a.patient_id
      JOIN doctors d ON d.id = a.doctor_id
      JOIN users ud ON ud.id = d.user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY a.slot_time DESC
    `;

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// GET /admin/stats - cached with Redis
export async function getStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const cacheKey = "medibook:admin:stats";
    const cached = await cacheGet<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [totalBookings, activeDoctors, cancellations, totalPatients] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM appointments`),
      pool.query(`SELECT COUNT(*) FROM doctors WHERE is_verified = true`),
      pool.query(`SELECT COUNT(*) FROM appointments WHERE status = 'CANCELLED'`),
      pool.query(`SELECT COUNT(*) FROM users WHERE role = 'PATIENT'`),
    ]);

    const stats = {
      totalBookings: parseInt(totalBookings.rows[0].count, 10),
      activeDoctors: parseInt(activeDoctors.rows[0].count, 10),
      cancellations: parseInt(cancellations.rows[0].count, 10),
      totalPatients: parseInt(totalPatients.rows[0].count, 10),
    };

    await cacheSet(cacheKey, stats, 60); // 60s cache
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

// GET /admin/audit-logs
export async function getAuditLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT al.*, u.name AS actor_name, u.email AS actor_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       ORDER BY al.created_at DESC
       LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}
