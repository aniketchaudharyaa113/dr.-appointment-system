import nodemailer, { Transporter } from "nodemailer";

export interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  template?: "booking_confirmation" | "cancellation" | "reminder" | "prescription_ready";
  templateData?: Record<string, any>;
}

const SMTP_HOST = process.env.SMTP_HOST || "localhost";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "1025", 10);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "MediBook <no-reply@medibook.test>";

let transporter: Transporter | null = null;

export function getTransporter(): Transporter {
  if (!transporter) {
    if (SMTP_USER && SMTP_PASS) {
      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      });
    } else {
      // Local dev / Mailpit / test setup (no auth required)
      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        ignoreTLS: true,
      });
    }
  }
  return transporter;
}

export function renderEmailTemplate(
  template: "booking_confirmation" | "cancellation" | "reminder" | "prescription_ready",
  data: Record<string, any>
): { subject: string; html: string; text: string } {
  switch (template) {
    case "booking_confirmation":
      return {
        subject: `Appointment Confirmed - Reference #${data.bookingRef || "N/A"}`,
        text: `Hello ${data.patientName || "Patient"},\n\nYour appointment with Dr. ${data.doctorName || "Doctor"} on ${data.slotTime || "Scheduled Time"} has been confirmed.\nBooking Reference: ${data.bookingRef}\n\nThank you for choosing MediBook!`,
        html: `
          <div style="font-family: sans-serif; line-height: 1.5; color: #1e293b; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #0284c7; margin-top: 0;">Appointment Confirmed</h2>
            <p>Dear <strong>${data.patientName || "Patient"}</strong>,</p>
            <p>Your appointment has been successfully scheduled. Here are the details:</p>
            <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; margin: 20px 0;">
              <p style="margin: 4px 0;"><strong>Doctor:</strong> Dr. ${data.doctorName || "Doctor"}</p>
              <p style="margin: 4px 0;"><strong>Specialty:</strong> ${data.specialty || "General"}</p>
              <p style="margin: 4px 0;"><strong>Slot Time:</strong> ${data.slotTime || "N/A"}</p>
              <p style="margin: 4px 0;"><strong>Reference ID:</strong> <span style="font-family: monospace; color: #0369a1;">${data.bookingRef || "N/A"}</span></p>
            </div>
            <p style="color: #64748b; font-size: 14px;">Please arrive 10 minutes prior to your consultation time.</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">MediBook Healthcare Platform • Do not reply directly to this email.</p>
          </div>
        `,
      };

    case "cancellation":
      return {
        subject: `Appointment Cancelled - Reference #${data.bookingRef || "N/A"}`,
        text: `Hello ${data.patientName || "Patient"},\n\nYour appointment with Dr. ${data.doctorName || "Doctor"} on ${data.slotTime || "Scheduled Time"} has been cancelled.\nReason: ${data.reason || "Schedule change"}\n\nMediBook Support`,
        html: `
          <div style="font-family: sans-serif; line-height: 1.5; color: #1e293b; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #ef4444; margin-top: 0;">Appointment Cancelled</h2>
            <p>Dear <strong>${data.patientName || "Patient"}</strong>,</p>
            <p>We regret to inform you that your upcoming appointment has been cancelled.</p>
            <div style="background-color: #fef2f2; padding: 16px; border-radius: 6px; margin: 20px 0; border: 1px solid #fecaca;">
              <p style="margin: 4px 0;"><strong>Doctor:</strong> Dr. ${data.doctorName || "Doctor"}</p>
              <p style="margin: 4px 0;"><strong>Slot Time:</strong> ${data.slotTime || "N/A"}</p>
              <p style="margin: 4px 0;"><strong>Reason:</strong> ${data.reason || "Schedule change"}</p>
            </div>
            <p>You can rebook another convenient time slot through your MediBook dashboard.</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">MediBook Healthcare Platform</p>
          </div>
        `,
      };

    case "reminder":
      return {
        subject: `Reminder: Upcoming Appointment with Dr. ${data.doctorName || "Doctor"}`,
        text: `Hello ${data.patientName || "Patient"},\n\nThis is a reminder for your appointment with Dr. ${data.doctorName || "Doctor"} scheduled for ${data.slotTime}.\n\nMediBook`,
        html: `
          <div style="font-family: sans-serif; line-height: 1.5; color: #1e293b; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #f59e0b; margin-top: 0;">Appointment Reminder (${data.reminderType === "24h" ? "24 Hours Ahead" : "1 Hour Ahead"})</h2>
            <p>Dear <strong>${data.patientName || "Patient"}</strong>,</p>
            <p>This is a reminder for your upcoming appointment:</p>
            <div style="background-color: #fffbeb; padding: 16px; border-radius: 6px; margin: 20px 0; border: 1px solid #fde68a;">
              <p style="margin: 4px 0;"><strong>Doctor:</strong> Dr. ${data.doctorName || "Doctor"}</p>
              <p style="margin: 4px 0;"><strong>Scheduled Time:</strong> ${data.slotTime || "N/A"}</p>
              <p style="margin: 4px 0;"><strong>Location/Clinic:</strong> ${data.clinicAddress || "MediBook Clinic"}</p>
            </div>
            <p>If you need to reschedule, please visit the dashboard in advance.</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">MediBook Healthcare Platform</p>
          </div>
        `,
      };

    case "prescription_ready":
      return {
        subject: `Prescription Available - Consultation with Dr. ${data.doctorName || "Doctor"}`,
        text: `Hello ${data.patientName || "Patient"},\n\nYour prescription from Dr. ${data.doctorName || "Doctor"} is now available on your MediBook patient dashboard.\n\nDiagnosis: ${data.diagnosis || "Consultation complete"}`,
        html: `
          <div style="font-family: sans-serif; line-height: 1.5; color: #1e293b; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #10b981; margin-top: 0;">Prescription Ready</h2>
            <p>Dear <strong>${data.patientName || "Patient"}</strong>,</p>
            <p>Dr. <strong>${data.doctorName || "Doctor"}</strong> has uploaded your prescription following your consultation.</p>
            <div style="background-color: #ecfdf5; padding: 16px; border-radius: 6px; margin: 20px 0; border: 1px solid #a7f3d0;">
              <p style="margin: 4px 0;"><strong>Diagnosis:</strong> ${data.diagnosis || "Standard evaluation"}</p>
              <p style="margin: 4px 0;"><strong>Instructions:</strong> ${data.notes || "Follow prescribed dosages carefully."}</p>
            </div>
            <p>Log in to your MediBook dashboard to view medications, dosages, and download your digital prescription.</p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">MediBook Healthcare Platform</p>
          </div>
        `,
      };
  }
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  try {
    let subject = options.subject;
    let html = options.html;
    let text = options.text;

    if (options.template && options.templateData) {
      const rendered = renderEmailTemplate(options.template, options.templateData);
      subject = options.subject || rendered.subject;
      html = rendered.html;
      text = rendered.text;
    }

    const t = getTransporter();
    await t.sendMail({
      from: EMAIL_FROM,
      to: options.to,
      subject,
      text,
      html,
    });
    return true;
  } catch (err: any) {
    console.error("[EmailService] Failed to send email:", err?.message || err);
    // Don't throw in development/testing if SMTP is offline
    if (process.env.NODE_ENV === "test") {
      return false;
    }
    throw err;
  }
}
