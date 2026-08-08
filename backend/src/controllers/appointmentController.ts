import { Response, NextFunction } from "express";
import pool from "../db/pool";
import { AuthRequest } from "../types";
import { getIO } from "../sockets/slotEvents";
import { parseSlot, slotKey, nowInClinicTimezone } from "../utils/datetime";

// POST /appointments - book a slot
// The UNIQUE(doctor_id, slot_time) constraint in the DB is what actually
// prevents double-booking. This code just tries the insert and reacts
// if Postgres rejects it as a duplicate.
export async function createAppointment(req: AuthRequest, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const patientId = req.user!.id;
    const { doctorId, slotTime } = req.body;

    if (!doctorId || !slotTime) {
      return res.status(400).json({ error: "doctorId and slotTime are required" });
    }

    const slot = parseSlot(slotTime);
    if (!slot) {
      return res.status(400).json({ error: "slotTime must look like YYYY-MM-DDTHH:MM:SS" });
    }
    if (slotKey(slot) <= slotKey(nowInClinicTimezone())) {
      return res.status(400).json({ error: "slotTime must be in the future" });
    }

    // Doctor must exist and be verified - without this, an unverified or
    // made-up doctorId either 500s on the FK constraint or silently books
    // a doctor patients were never supposed to be able to find.
    const doctorResult = await client.query(
      `SELECT id, clinic_name, clinic_address FROM doctors WHERE id = $1 AND is_verified = true`,
      [doctorId]
    );
    if (doctorResult.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found or not verified" });
    }
    const doctor = doctorResult.rows[0];

    // The slot must fall inside a window the doctor actually offers -
    // otherwise the "availability" schedule is purely decorative and a
    // patient can book any arbitrary timestamp.
    const availabilityResult = await client.query(
      `SELECT id FROM availability
       WHERE doctor_id = $1 AND day_of_week = $2
         AND start_time <= $3 AND end_time > $3`,
      [doctorId, slot.dayOfWeek, slot.hhmmss]
    );
    if (availabilityResult.rows.length === 0) {
      return res.status(400).json({ error: "That time is outside the doctor's available hours" });
    }

    await client.query("BEGIN");

    // Atomically issue the next daily token number for this doctor.
    // ON CONFLICT ... DO UPDATE row-locks, so two concurrent bookings for
    // the same doctor on the same day can never receive the same number -
    // if this weren't atomic, two patients could both be told "token #4".
    const pad = (n: number) => String(n).padStart(2, "0");
    const bookingDate = `${slot.year}-${pad(slot.month)}-${pad(slot.day)}`;
    const counterResult = await client.query(
      `INSERT INTO doctor_daily_counters (doctor_id, booking_date, last_seq)
       VALUES ($1, $2, 1)
       ON CONFLICT (doctor_id, booking_date)
       DO UPDATE SET last_seq = doctor_daily_counters.last_seq + 1
       RETURNING last_seq`,
      [doctorId, bookingDate]
    );
    const seq = counterResult.rows[0].last_seq;
    const bookingRef = `MB-${bookingDate.replace(/-/g, "")}-${String(seq).padStart(3, "0")}`;

    // Store the exact wall-clock string the patient chose - no Date object,
    // no timezone math, so what goes in is exactly what comes back out.
    const storedSlotTime = `${bookingDate} ${slot.hhmmss}`;

    const result = await client.query(
      `INSERT INTO appointments (patient_id, doctor_id, slot_time, status, booking_ref)
       VALUES ($1, $2, $3, 'CONFIRMED', $4)
       RETURNING *`,
      [patientId, doctorId, storedSlotTime, bookingRef]
    );

    await client.query("COMMIT");

    const appointment = {
      ...result.rows[0],
      clinic_name: doctor.clinic_name,
      clinic_address: doctor.clinic_address,
    };

    // Tell every other patient looking at this doctor's page right now
    // that this slot is gone, without them needing to refresh.
    getIO().emit("slot-booked", { doctorId, slotTime: storedSlotTime });

    res.status(201).json(appointment);
  } catch (err: any) {
    await client.query("ROLLBACK");
    // Postgres error code 23505 = unique_violation -> someone else grabbed
    // this exact slot a moment earlier. errorMiddleware also handles this
    // globally, but we catch it here too in case you want custom messaging.
    if (err.code === "23505") {
      return res.status(409).json({ error: "That slot was just booked by someone else. Please pick another." });
    }
    next(err);
  } finally {
    client.release();
  }
}

// GET /appointments/mine - works for both patients and doctors, based on role
export async function getMyAppointments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id: userId, role } = req.user!;

    let query: string;
    let values: any[];

    if (role === "PATIENT") {
      query = `
        SELECT a.*, u.name AS doctor_name, d.specialty, d.clinic_name,
               d.clinic_address, d.clinic_lat, d.clinic_lng
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        JOIN users u ON u.id = d.user_id
        WHERE a.patient_id = $1
        ORDER BY a.slot_time DESC
      `;
      values = [userId];
    } else if (role === "DOCTOR") {
      query = `
        SELECT a.*, u.name AS patient_name, u.phone AS patient_phone
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        JOIN users u ON u.id = a.patient_id
        WHERE d.user_id = $1
        ORDER BY a.slot_time DESC
      `;
      values = [userId];
    } else {
      return res.status(403).json({ error: "Admins should use /admin/appointments" });
    }

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

// PATCH /appointments/:id/cancel
export async function cancelAppointment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { id: userId, role } = req.user!;

    // Patients can only cancel their own; doctors can only cancel their own
    // patients'; admins can cancel any appointment (e.g. if a doctor becomes
    // unreachable and the platform needs to step in on their behalf).
    let ownershipClause = "TRUE";
    if (role === "PATIENT") ownershipClause = "patient_id = $2";
    else if (role === "DOCTOR") ownershipClause = "doctor_id = (SELECT id FROM doctors WHERE user_id = $2)";

    const result = await pool.query(
      `UPDATE appointments SET status = 'CANCELLED'
       WHERE id = $1 AND ${ownershipClause}
         AND status NOT IN ('CANCELLED', 'COMPLETED')
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found, not yours, or already cancelled/completed" });
    }

    const appt = result.rows[0];
    getIO().emit("slot-freed", { doctorId: appt.doctor_id, slotTime: appt.slot_time });

    res.json(appt);
  } catch (err) {
    next(err);
  }
}

// PATCH /appointments/:id/complete - doctor marks a visit done, adds notes
export async function completeAppointment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.user!.id;

    const result = await pool.query(
      `UPDATE appointments SET status = 'COMPLETED', notes = $1
       WHERE id = $2 AND doctor_id = (SELECT id FROM doctors WHERE user_id = $3)
         AND status = 'CONFIRMED'
       RETURNING *`,
      [notes || null, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found, not yours, or not in a completable state" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}
