import { Response, NextFunction } from "express";
import pool from "../db/pool";
import { AuthRequest } from "../types";
import { getIO } from "../sockets/slotEvents";
import { parseSlot, slotKey, nowInClinicTimezone } from "../utils/datetime";
import { cacheDel, cacheDelPattern } from "../cache/redis";
import { enqueueJob } from "../queue/messageQueue";

// POST /appointments - book a slot
// The UNIQUE(doctor_id, slot_time) constraint in the DB is what actually
// prevents double-booking. This code just tries the insert and reacts
// if Postgres rejects it as a duplicate.
export async function createAppointment(req: AuthRequest, res: Response, next: NextFunction) {
  const client = await pool.connect();
  let inTransaction = false;
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

    // Doctor must exist and be verified
    const doctorResult = await client.query(
      `SELECT d.id, d.user_id, d.clinic_name, d.clinic_address, u.name AS doctor_name, u.email AS doctor_email
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       WHERE d.id = $1 AND d.is_verified = true`,
      [doctorId]
    );
    if (doctorResult.rows.length === 0) {
      return res.status(404).json({ error: "Doctor not found or not verified" });
    }
    const doctor = doctorResult.rows[0];

    // Check doctor leaves / blackout dates
    const pad = (n: number) => String(n).padStart(2, "0");
    const bookingDate = `${slot.year}-${pad(slot.month)}-${pad(slot.day)}`;

    const leaveCheck = await client.query(
      `SELECT id, reason FROM doctor_leaves WHERE doctor_id = $1 AND leave_date = $2`,
      [doctorId, bookingDate]
    );
    if (leaveCheck.rows.length > 0) {
      return res.status(400).json({
        error: `Doctor is unavailable on this date (${leaveCheck.rows[0].reason || "Doctor on leave"})`,
      });
    }

    // The slot must fall inside a window the doctor actually offers
    const availabilityResult = await client.query(
      `SELECT id, start_time, end_time, slot_duration_minutes FROM availability
       WHERE doctor_id = $1 AND day_of_week = $2
         AND start_time <= $3 AND end_time > $3`,
      [doctorId, slot.dayOfWeek, slot.hhmmss]
    );
    if (availabilityResult.rows.length === 0) {
      return res.status(400).json({ error: "That time is outside the doctor's available hours" });
    }

    const avail = availabilityResult.rows[0];
    const timeToMinutes = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    const slotMins = timeToMinutes(slot.hhmmss);
    const startMins = timeToMinutes(avail.start_time);
    const endMins = timeToMinutes(avail.end_time);
    const duration = avail.slot_duration_minutes || 15;

    if ((slotMins - startMins) % duration !== 0) {
      return res.status(400).json({
        error: `Slot time is not aligned to the doctor's ${duration}-minute schedule grid from start time (${avail.start_time.slice(0, 5)})`,
      });
    }

    if (slotMins + duration > endMins) {
      return res.status(400).json({
        error: `Slot duration (${duration} mins) exceeds available window end (${avail.end_time.slice(0, 5)})`,
      });
    }

    await client.query("BEGIN");
    inTransaction = true;

    // Atomically issue the next daily token number for this doctor.
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

    // Store the exact wall-clock string the patient chose
    const storedSlotTime = `${bookingDate} ${slot.hhmmss}`;

    const result = await client.query(
      `INSERT INTO appointments (patient_id, doctor_id, slot_time, status, booking_ref)
       VALUES ($1, $2, $3, 'CONFIRMED', $4)
       RETURNING *`,
      [patientId, doctorId, storedSlotTime, bookingRef]
    );

    await client.query("COMMIT");
    inTransaction = false;

    const appointment = {
      ...result.rows[0],
      clinic_name: doctor.clinic_name,
      clinic_address: doctor.clinic_address,
      doctor_name: doctor.doctor_name,
    };

    // Invalidate caches
    await cacheDel(`medibook:slots:${doctorId}`);
    await cacheDelPattern(`medibook:admin:*`);

    // Real-time broadcast
    getIO().emit("slot-booked", { doctorId, slotTime: storedSlotTime });

    // Fetch patient name for notifications
    const patientQuery = await pool.query("SELECT name, email FROM users WHERE id = $1", [patientId]);
    const patientName = patientQuery.rows[0]?.name || "Patient";
    const patientEmail = patientQuery.rows[0]?.email;

    // Asynchronously dispatch notifications and audit via Message Queue
    await enqueueJob("NOTIFICATION", {
      userId: patientId,
      type: "BOOKING_CONFIRMED",
      title: "Appointment Confirmed",
      message: `Your appointment with ${doctor.doctor_name} is confirmed for ${bookingDate} at ${slot.hhmmss.slice(0, 5)}. Booking Ref: ${bookingRef}`,
      link: "/my-appointments",
    });

    await enqueueJob("NOTIFICATION", {
      userId: doctor.user_id,
      type: "NEW_APPOINTMENT",
      title: "New Booking Received",
      message: `${patientName} booked a slot for ${bookingDate} at ${slot.hhmmss.slice(0, 5)} (${bookingRef}).`,
      link: "/doctor/dashboard",
    });

    await enqueueJob("EMAIL_DISPATCH", {
      recipient: patientEmail,
      subject: `Appointment Confirmation - ${bookingRef}`,
      details: { doctorName: doctor.doctor_name, bookingRef, slotTime: storedSlotTime },
    });

    await enqueueJob("AUDIT", {
      actorId: patientId,
      actorRole: "PATIENT",
      action: "APPOINTMENT_BOOKED",
      targetId: appointment.id,
      details: { doctorId, bookingRef, slotTime: storedSlotTime },
    });

    res.status(201).json(appointment);
  } catch (err: any) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
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
               d.clinic_address, d.clinic_lat, d.clinic_lng,
               p.id AS prescription_id,
               r.id AS review_id, r.rating AS review_rating
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        JOIN users u ON u.id = d.user_id
        LEFT JOIN prescriptions p ON p.appointment_id = a.id
        LEFT JOIN reviews r ON r.appointment_id = a.id
        WHERE a.patient_id = $1
        ORDER BY a.slot_time DESC
      `;
      values = [userId];
    } else if (role === "DOCTOR") {
      query = `
        SELECT a.*, u.name AS patient_name, u.phone AS patient_phone, u.email AS patient_email,
               p.id AS prescription_id,
               r.id AS review_id, r.rating AS review_rating
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        JOIN users u ON u.id = a.patient_id
        LEFT JOIN prescriptions p ON p.appointment_id = a.id
        LEFT JOIN reviews r ON r.appointment_id = a.id
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
    const { reason } = req.body || {};

    let query: string;
    let values: any[];

    if (role === "PATIENT") {
      query = `
        UPDATE appointments SET status = 'CANCELLED'
        WHERE id = $1 AND patient_id = $2
          AND status NOT IN ('CANCELLED', 'COMPLETED')
        RETURNING *
      `;
      values = [id, userId];
    } else if (role === "DOCTOR") {
      query = `
        UPDATE appointments SET status = 'CANCELLED'
        WHERE id = $1 AND doctor_id = (SELECT id FROM doctors WHERE user_id = $2)
          AND status NOT IN ('CANCELLED', 'COMPLETED')
        RETURNING *
      `;
      values = [id, userId];
    } else if (role === "ADMIN") {
      query = `
        UPDATE appointments SET status = 'CANCELLED'
        WHERE id = $1 AND status NOT IN ('CANCELLED', 'COMPLETED')
        RETURNING *
      `;
      values = [id];
    } else {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Appointment not found, not yours, or already cancelled/completed" });
    }

    const appt = result.rows[0];

    // Invalidate caches
    await cacheDel(`medibook:slots:${appt.doctor_id}`);
    await cacheDelPattern(`medibook:admin:*`);

    // Emit live slot-freed socket event
    getIO().emit("slot-freed", { doctorId: appt.doctor_id, slotTime: appt.slot_time });

    // Fetch doctor user id for notifications
    const docQuery = await pool.query("SELECT user_id FROM doctors WHERE id = $1", [appt.doctor_id]);
    const doctorUserId = docQuery.rows[0]?.user_id;

    // Asynchronously notify via queue
    if (role === "PATIENT") {
      if (doctorUserId) {
        await enqueueJob("NOTIFICATION", {
          userId: doctorUserId,
          type: "APPOINTMENT_CANCELLED",
          title: "Appointment Cancelled",
          message: `Appointment ${appt.booking_ref} was cancelled by the patient.`,
          link: "/doctor/dashboard",
        });
      }
    } else {
      await enqueueJob("NOTIFICATION", {
        userId: appt.patient_id,
        type: "APPOINTMENT_CANCELLED",
        title: "Appointment Cancelled",
        message: `Your appointment ${appt.booking_ref} has been cancelled${reason ? `: ${reason}` : "."}`,
        link: "/my-appointments",
      });
    }

    await enqueueJob("AUDIT", {
      actorId: userId,
      actorRole: role,
      action: "APPOINTMENT_CANCELLED",
      targetId: id,
      details: { bookingRef: appt.booking_ref, reason: reason || "No reason specified" },
    });

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

    const appt = result.rows[0];

    // Invalidate caches
    await cacheDel(`medibook:slots:${appt.doctor_id}`);
    await cacheDelPattern(`medibook:doctor:${appt.doctor_id}*`);
    await cacheDelPattern(`medibook:admin:*`);

    // Notify patient
    await enqueueJob("NOTIFICATION", {
      userId: appt.patient_id,
      type: "APPOINTMENT_COMPLETED",
      title: "Appointment Completed",
      message: `Your visit (${appt.booking_ref}) is marked completed. How was your experience? Leave a review!`,
      link: "/my-appointments",
    });

    await enqueueJob("AUDIT", {
      actorId: userId,
      actorRole: "DOCTOR",
      action: "APPOINTMENT_COMPLETED",
      targetId: id,
      details: { bookingRef: appt.booking_ref },
    });

    res.json(appt);
  } catch (err) {
    next(err);
  }
}
