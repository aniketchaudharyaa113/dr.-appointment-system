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

    const result = await pool.query(
      `INSERT INTO prescriptions (appointment_id, doctor_id, patient_id, diagnosis, medicines, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (appointment_id)
       DO UPDATE SET diagnosis = $4, medicines = $5, notes = $6, created_at = now()
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
      action: "PRESCRIPTION_CREATED",
      targetId: appointmentId,
      details: { diagnosis, medicinesCount: medicines.length },
    });

    res.status(201).json(result.rows[0]);
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

    res.json(result.rows[0]);
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

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}
