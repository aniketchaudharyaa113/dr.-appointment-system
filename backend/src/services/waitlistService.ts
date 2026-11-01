import pool from "../db/pool";
import crypto from "crypto";
import { getRedisClient, isRedisConnected } from "../cache/redis";
import { getIO } from "../sockets/slotEvents";

export async function addToWaitlist(data: {
  doctorId: string;
  patientId: string;
  slotDate: string;
  slotTime?: string;
}) {
  const { doctorId, patientId, slotDate, slotTime } = data;
  const res = await pool.query(
    `INSERT INTO waitlists (doctor_id, patient_id, slot_date, slot_time, status)
     VALUES ($1, $2, $3, $4, 'WAITING')
     RETURNING id, doctor_id, patient_id, slot_date, slot_time, status, created_at`,
    [doctorId, patientId, slotDate, slotTime || null]
  );
  return res.rows[0];
}

export async function getPatientWaitlist(patientId: string) {
  const res = await pool.query(
    `SELECT w.*, d.clinic_name, u.name AS doctor_name, d.specialty
     FROM waitlists w
     JOIN doctors d ON d.id = w.doctor_id
     JOIN users u ON u.id = d.user_id
     WHERE w.patient_id = $1 AND w.status IN ('WAITING', 'OFFERED')
     ORDER BY w.created_at DESC`,
    [patientId]
  );
  return res.rows;
}

export async function cancelWaitlistEntry(id: string, patientId: string) {
  const res = await pool.query(
    `UPDATE waitlists
     SET status = 'CANCELLED'
     WHERE id = $1 AND patient_id = $2 AND status = 'WAITING'
     RETURNING *`,
    [id, patientId]
  );
  return res.rows[0];
}

export function normalizeSlotTime(raw: any): string {
  if (raw instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = raw.getFullYear();
    const m = pad(raw.getMonth() + 1);
    const d = pad(raw.getDate());
    const hh = pad(raw.getHours());
    const mm = pad(raw.getMinutes());
    const ss = pad(raw.getSeconds());
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }
  const str = String(raw).trim();
  if (str.includes(" ")) {
    return str.replace(" ", "T");
  }
  return str;
}

export async function offerSlotToNextWaitlistedPatient(doctorId: string, rawSlotTime: any) {
  const slotTime = normalizeSlotTime(rawSlotTime);
  const slotDate = slotTime.slice(0, 10);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Select the first waiting patient in FIFO order
    const nextInLine = await client.query(
      `SELECT id, patient_id
       FROM waitlists
       WHERE doctor_id = $1
         AND (
           slot_time = $2
           OR REPLACE(COALESCE(slot_time, ''), ' ', 'T') = REPLACE($2, ' ', 'T')
           OR (slot_time IS NULL AND slot_date = $3)
         )
         AND status = 'WAITING'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [doctorId, slotTime, slotDate]
    );

    if (nextInLine.rows.length === 0) {
      await client.query("COMMIT");
      return null;
    }

    const { id: waitlistId, patient_id: patientId } = nextInLine.rows[0];
    const holdToken = crypto.randomUUID();
    const redis = getRedisClient();
    const holdKey = `hold:${doctorId}:${slotTime}`;
    const holdVal = `${patientId}:${holdToken}`;

    // 10-minute hold (600 seconds)
    if (redis && isRedisConnected()) {
      await redis.set(holdKey, holdVal, "EX", 600);
    }

    await client.query(
      `UPDATE waitlists
       SET status = 'OFFERED',
           offered_at = CURRENT_TIMESTAMP,
           claim_expires_at = CURRENT_TIMESTAMP + INTERVAL '10 minutes',
           hold_token = $1
       WHERE id = $2`,
      [holdToken, waitlistId]
    );

    await client.query("COMMIT");

    // Real-time notification to patient and doctor rooms
    try {
      getIO().to(`user:${patientId}`).emit("waitlist-offered", {
        waitlistId,
        doctorId,
        slotTime,
        holdToken,
        claimExpiresIn: 600,
      });
      getIO().to(`doctor:${doctorId}`).emit("slot-held", {
        doctorId,
        slotTime,
        heldBy: patientId,
      });
    } catch {}

    // Schedule automatic expiry check in 10 minutes (outside of unit test environment)
    if (process.env.NODE_ENV !== "test") {
      setTimeout(async () => {
        try {
          await handleWaitlistExpiry(waitlistId, doctorId, slotTime);
        } catch (e) {
          console.warn(`[Waitlist] Error expiring waitlist ${waitlistId}:`, e);
        }
      }, 10 * 60 * 1000);
    }

    return { waitlistId, patientId, holdToken, doctorId, slotTime };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function handleWaitlistExpiry(waitlistId: string, doctorId: string, slotTime: string) {
  if ((pool as any).ending || (pool as any).ended) return;
  const check = await pool.query(
    `SELECT id, status, hold_token FROM waitlists WHERE id = $1`,
    [waitlistId]
  );
  if (check.rows.length === 0 || check.rows[0].status !== "OFFERED") {
    return; // Already claimed or cancelled
  }

  // Mark expired
  await pool.query(
    `UPDATE waitlists SET status = 'EXPIRED' WHERE id = $1`,
    [waitlistId]
  );

  const redis = getRedisClient();
  const holdKey = `hold:${doctorId}:${slotTime}`;
  if (redis && isRedisConnected()) {
    await redis.del(holdKey);
  }

  try {
    getIO().to(`doctor:${doctorId}`).emit("slot-hold-released", { doctorId, slotTime });
  } catch {}

  // Cascade offer to the NEXT waitlisted patient
  await offerSlotToNextWaitlistedPatient(doctorId, slotTime);
}
