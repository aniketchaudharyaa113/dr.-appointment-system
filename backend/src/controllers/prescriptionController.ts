import { Response, NextFunction } from "express";
import { z } from "zod";
import pool from "../db/pool";
import { AuthRequest } from "../types";
import { enqueueJob } from "../queue/messageQueue";

const medicineSchema = z.object({
  name: z.string().min(1, "Medicine name is required"),
  dosage: z.string().min(1, "Dosage is required (e.g. 500mg)"),
  frequency: z.string().min(1, "Frequency is required (e.g. 1-0-1)"),
  duration: z.string().min(1, "Duration is required (e.g. 5 days)"),
  instructions: z.string().optional(),
});

const createPrescriptionSchema = z.object({
  appointmentId: z.string().uuid("Valid appointmentId required"),
  diagnosis: z.string().min(1, "Diagnosis is required"),
  medicines: z.array(medicineSchema).min(1, "At least one medicine is required"),
  notes: z.string().optional(),
});

// POST /prescriptions - doctor creates prescription for a visit
export async function createPrescription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const parsed = createPrescriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { appointmentId, diagnosis, medicines, notes } = parsed.data;

    // Verify appointment belongs to this doctor
    const apptResult = await pool.query(
      `SELECT a.id, a.patient_id, a.doctor_id, a.booking_ref, a.status,
              ud.name AS doctor_name
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       JOIN users ud ON ud.id = d.user_id
       WHERE a.id = $1 AND d.user_id = $2`,
      [appointmentId, userId]
    );

    if (apptResult.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found or not assigned to you" });
    }

    const appt = apptResult.rows[0];

    if (appt.status !== "COMPLETED") {
      return res.status(400).json({ error: "Prescriptions can only be created for COMPLETED appointments" });
    }

    // Check if prescription already exists for this appointment
    const existing = await pool.query(
      `SELECT id, diagnosis, medicines, notes FROM prescriptions WHERE appointment_id = $1`,
      [appointmentId]
    );

    let result;
    if (existing.rows.length > 0) {
      const prev = existing.rows[0];
      const versionCountRes = await pool.query(
        `SELECT COUNT(*) as count FROM prescription_versions WHERE prescription_id = $1`,
        [prev.id]
      );
      const nextVersion = Number(versionCountRes.rows[0].count) + 1;

      // Save previous version before overwriting
      await pool.query(
        `INSERT INTO prescription_versions (prescription_id, diagnosis, medicines, notes, version, saved_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [prev.id, prev.diagnosis, JSON.stringify(prev.medicines), prev.notes, nextVersion]
      );

      result = await pool.query(
        `UPDATE prescriptions
         SET diagnosis = $1, medicines = $2, notes = $3, created_at = now()
         WHERE id = $4
         RETURNING *`,
        [diagnosis, JSON.stringify(medicines), notes || null, prev.id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO prescriptions (appointment_id, doctor_id, patient_id, diagnosis, medicines, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          appointmentId,
          appt.doctor_id,
          appt.patient_id,
          diagnosis,
          JSON.stringify(medicines),
          notes || null,
        ]
      );
    }

    // Asynchronously notify patient via Queue
    await enqueueJob("NOTIFICATION", {
      userId: appt.patient_id,
      type: "PRESCRIPTION_ADDED",
      title: "Prescription Available",
      message: `${appt.doctor_name} has generated your prescription for appointment ${appt.booking_ref}.`,
      link: `/my-appointments`,
    });

    await enqueueJob("AUDIT", {
      actorId: userId,
      actorRole: "DOCTOR",
      action: existing.rows.length > 0 ? "PRESCRIPTION_UPDATED" : "PRESCRIPTION_CREATED",
      targetId: appointmentId,
      details: { diagnosis, medicinesCount: medicines.length, isUpdate: existing.rows.length > 0 },
    });

    res.status(existing.rows.length > 0 ? 200 : 201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

// GET /prescriptions/:prescriptionId/versions
export async function getPrescriptionVersions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { prescriptionId } = req.params;
    const { id: userId, role } = req.user!;

    const pRes = await pool.query(
      `SELECT p.id, p.patient_id, d.user_id as doctor_user_id
       FROM prescriptions p
       JOIN doctors d ON d.id = p.doctor_id
       WHERE p.id = $1`,
      [prescriptionId]
    );
    if (pRes.rows.length === 0) {
      return res.status(404).json({ error: "Prescription not found" });
    }
    const p = pRes.rows[0];
    if (role === "PATIENT" && p.patient_id !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (role === "DOCTOR" && p.doctor_user_id !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const versions = await pool.query(
      `SELECT * FROM prescription_versions WHERE prescription_id = $1 ORDER BY version DESC`,
      [prescriptionId]
    );

    await enqueueJob("AUDIT", {
      actorId: userId,
      actorRole: role,
      action: "PRESCRIPTION_VERSIONS_VIEWED",
      targetId: prescriptionId,
      details: { count: versions.rows.length, viewedAt: new Date().toISOString() },
    });

    res.json(versions.rows);
  } catch (err) {
    next(err);
  }
}

// GET /prescriptions/appointment/:appointmentId
export async function getPrescriptionByAppointment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { appointmentId } = req.params;
    const { id: userId, role } = req.user!;

    let accessCheckClause = "TRUE";
    if (role === "PATIENT") {
      accessCheckClause = "p.patient_id = $2";
    } else if (role === "DOCTOR") {
      accessCheckClause = "d.user_id = $2";
    }

    const query = `
      SELECT p.*,
             ud.name AS doctor_name, d.specialty, d.clinic_name, d.clinic_address,
             d.license_number,
             up.name AS patient_name, up.email AS patient_email, up.phone AS patient_phone,
             a.booking_ref, a.slot_time
      FROM prescriptions p
      JOIN appointments a ON a.id = p.appointment_id
      JOIN doctors d ON d.id = p.doctor_id
      JOIN users ud ON ud.id = d.user_id
      JOIN users up ON up.id = p.patient_id
      WHERE p.appointment_id = $1 AND ${accessCheckClause}
    `;

    const values = role === "ADMIN" ? [appointmentId] : [appointmentId, userId];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Prescription not found or access denied" });
    }

    const prescription = result.rows[0];

    // Audit prescription read access
    await enqueueJob("AUDIT", {
      actorId: userId,
      actorRole: role,
      action: "PRESCRIPTION_VIEWED",
      targetId: prescription.id,
      details: {
        appointmentId,
        bookingRef: prescription.booking_ref,
        viewedAt: new Date().toISOString(),
      },
    });

    res.json(prescription);
  } catch (err) {
    next(err);
  }
}

// GET /prescriptions/mine - patient's prescriptions
export async function getMyPrescriptions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT p.*,
              ud.name AS doctor_name, d.specialty, d.clinic_name,
              a.booking_ref, a.slot_time
       FROM prescriptions p
       JOIN appointments a ON a.id = p.appointment_id
       JOIN doctors d ON d.id = p.doctor_id
       JOIN users ud ON ud.id = d.user_id
       WHERE p.patient_id = $1
       ORDER BY p.created_at DESC`,
      [userId]
    );

    if (result.rows.length > 0) {
      await enqueueJob("AUDIT", {
        actorId: userId,
        actorRole: "PATIENT",
        action: "PRESCRIPTION_LIST_VIEWED",
        targetId: userId,
        details: { count: result.rows.length, viewedAt: new Date().toISOString() },
      });
    }

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}
