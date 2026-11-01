import pool from "../db/pool";
import { nowInClinicTimezone } from "../utils/datetime";

export async function attachNextAvailableSlots(doctors: any[]): Promise<any[]> {
  if (!doctors || doctors.length === 0) return doctors;

  const doctorIds = doctors.map((d) => d.id);
  const now = nowInClinicTimezone();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${now.year}-${pad(now.month)}-${pad(now.day)}`;
  const nowNaiveStr = `${todayStr} ${now.hhmmss}`;

  // 1. Fetch availability for all doctors
  const availRes = await pool.query(
    `SELECT doctor_id, day_of_week, start_time::text AS start_time, end_time::text AS end_time, slot_duration_minutes
     FROM availability
     WHERE doctor_id = ANY($1)`,
    [doctorIds]
  );

  // 2. Fetch leaves for the next 7 days
  const leavesRes = await pool.query(
    `SELECT doctor_id, leave_date::text AS leave_date
     FROM doctor_leaves
     WHERE doctor_id = ANY($1)
       AND leave_date >= $2::date
       AND leave_date <= ($2::date + 7)`,
    [doctorIds, todayStr]
  );

  // 3. Fetch booked appointments for the next 7 days
  const bookedRes = await pool.query(
    `SELECT doctor_id, slot_time::text AS slot_time
     FROM appointments
     WHERE doctor_id = ANY($1)
       AND status IN ('PENDING', 'CONFIRMED')
       AND slot_time >= $2::timestamp
       AND slot_time <= ($2::timestamp + INTERVAL '7 days')`,
    [doctorIds, nowNaiveStr]
  );

  // Group availability
  const availMap = new Map<string, any[]>();
  for (const a of availRes.rows) {
    if (!availMap.has(a.doctor_id)) availMap.set(a.doctor_id, []);
    availMap.get(a.doctor_id)!.push(a);
  }

  // Group leaves
  const leavesMap = new Map<string, Set<string>>();
  for (const l of leavesRes.rows) {
    if (!leavesMap.has(l.doctor_id)) leavesMap.set(l.doctor_id, new Set());
    leavesMap.get(l.doctor_id)!.add(l.leave_date.slice(0, 10));
  }

  // Group booked slots (stored both with and without :00)
  const bookedMap = new Map<string, Set<string>>();
  for (const b of bookedRes.rows) {
    if (!bookedMap.has(b.doctor_id)) bookedMap.set(b.doctor_id, new Set());
    const clean = b.slot_time.replace(" ", "T").slice(0, 19);
    bookedMap.get(b.doctor_id)!.add(clean);
    bookedMap.get(b.doctor_id)!.add(clean.slice(0, 16));
  }

  // Construct next 7 calendar days aligned with clinic's wall-clock timezone
  const days: { dateStr: string; dayOfWeek: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(now.year, now.month - 1, now.day + i));
    const y = d.getUTCFullYear();
    const m = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    days.push({
      dateStr: `${y}-${m}-${day}`,
      dayOfWeek: d.getUTCDay(),
    });
  }

  const currentNowKey = `${todayStr}T${now.hhmmss}`;

  for (const doc of doctors) {
    const doctorAvail = availMap.get(doc.id) || [];
    const doctorLeaves = leavesMap.get(doc.id) || new Set();
    const doctorBooked = bookedMap.get(doc.id) || new Set();

    let nextSlot: string | null = null;

    for (const d of days) {
      if (doctorLeaves.has(d.dateStr)) continue;

      const avail = doctorAvail.find((a) => a.day_of_week === d.dayOfWeek);
      if (!avail) continue;

      const duration = avail.slot_duration_minutes || 15;
      const [sh, sm] = avail.start_time.split(":").map(Number);
      const [eh, em] = avail.end_time.split(":").map(Number);
      let cursor = sh * 60 + sm;
      const end = eh * 60 + em;

      while (cursor + duration <= end) {
        const h = pad(Math.floor(cursor / 60));
        const min = pad(cursor % 60);
        const candidate = `${d.dateStr}T${h}:${min}:00`;

        if (candidate > currentNowKey) {
          if (!doctorBooked.has(candidate) && !doctorBooked.has(candidate.slice(0, 16))) {
            nextSlot = candidate;
            break;
          }
        }
        cursor += duration;
      }

      if (nextSlot) break;
    }

    doc.next_available_slot = nextSlot;
  }

  return doctors;
}
