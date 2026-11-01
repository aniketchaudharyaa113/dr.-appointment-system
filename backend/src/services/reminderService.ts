import { getQueues } from "../queue/messageQueue";
import { insertOutboxEvent } from "../queue/outboxRelay";

export async function scheduleAppointmentReminders(
  client: { query: Function },
  appointment: { id: string; slot_time: string; patient_id: string; doctor_id: string }
): Promise<void> {
  const slotDate = new Date(appointment.slot_time);
  const slotMs = slotDate.getTime();
  const now = Date.now();

  const ms24h = slotMs - 24 * 60 * 60 * 1000;
  const ms1h = slotMs - 1 * 60 * 60 * 1000;

  const delay24h = ms24h - now;
  const delay1h = ms1h - now;

  if (delay24h > 0) {
    await insertOutboxEvent(client, {
      aggregateType: "APPOINTMENT",
      aggregateId: appointment.id,
      eventType: "REMINDER",
      payload: {
        appointmentId: appointment.id,
        patientId: appointment.patient_id,
        doctorId: appointment.doctor_id,
        slotTime: appointment.slot_time,
        reminderType: "24h",
        delayMs: delay24h,
        jobKey: `reminder_${appointment.id}_24h`,
      },
    });
  }

  if (delay1h > 0) {
    await insertOutboxEvent(client, {
      aggregateType: "APPOINTMENT",
      aggregateId: appointment.id,
      eventType: "REMINDER",
      payload: {
        appointmentId: appointment.id,
        patientId: appointment.patient_id,
        doctorId: appointment.doctor_id,
        slotTime: appointment.slot_time,
        reminderType: "1h",
        delayMs: delay1h,
        jobKey: `reminder_${appointment.id}_1h`,
      },
    });
  }
}

export async function cancelAppointmentReminders(appointmentId: string): Promise<void> {
  try {
    const { remindersQueue } = getQueues();
    const job24h = await remindersQueue.getJob(`reminder_${appointmentId}_24h`);
    if (job24h) {
      await job24h.remove();
    }
    const job1h = await remindersQueue.getJob(`reminder_${appointmentId}_1h`);
    if (job1h) {
      await job1h.remove();
    }
  } catch (err: any) {
    console.warn(`[ReminderService] Failed to cancel reminder jobs for ${appointmentId}:`, err?.message || err);
  }
}
