import { z } from "zod";

export const uuidParamSchema = z.object({
  id: z.string().uuid("Invalid UUID parameter"),
});

// Auth Schemas
export const signupSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  role: z.enum(["PATIENT", "DOCTOR"]).optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

// Appointment Schemas
export const createAppointmentSchema = z.object({
  doctorId: z.string().uuid("Invalid doctorId UUID"),
  slotTime: z.string().min(10, "slotTime is required"),
  holdToken: z.string().optional(),
});

export const holdSlotSchema = z.object({
  doctorId: z.string().uuid("Invalid doctorId UUID"),
  slotTime: z.string().min(10, "slotTime is required"),
});

export const releaseHoldSchema = z.object({
  doctorId: z.string().uuid("Invalid doctorId UUID"),
  slotTime: z.string().min(10, "slotTime is required"),
  holdToken: z.string().optional(),
});

export const joinWaitlistSchema = z.object({
  doctorId: z.string().uuid("Invalid doctorId UUID"),
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "slotDate must be YYYY-MM-DD"),
  slotTime: z.string().optional(),
});

export const cancelAppointmentSchema = z.object({
  reason: z.string().optional(),
});

export const completeAppointmentSchema = z.object({
  notes: z.string().optional(),
});

export const rescheduleAppointmentSchema = z.object({
  newSlotTime: z.string().min(10, "newSlotTime is required"),
});

export const noShowAppointmentSchema = z
  .object({
    reason: z.string().optional(),
  })
  .optional();

export const dayViewQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format"),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const appointmentsQuerySchema = paginationQuerySchema.extend({
  status: z.string().optional(),
});

// Doctor Schemas
export const doctorQuerySchema = paginationQuerySchema.extend({
  specialty: z.string().optional(),
  city: z.string().optional(),
  minFee: z.coerce.number().optional(),
  maxFee: z.coerce.number().optional(),
  minRating: z.coerce.number().optional(),
  availableToday: z.string().optional(),
  sort: z.string().optional(),
});

export const updateAvailabilitySchema = z.object({
  slots: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string(),
        endTime: z.string(),
        slotDurationMinutes: z.number().int().positive().optional(),
      })
    )
    .optional(),
  windowStart: z.string().optional(),
  windowEnd: z.string().optional(),
  window_start: z.string().optional(),
  window_end: z.string().optional(),
  slotDurationMinutes: z.number().int().positive().optional(),
  slot_duration_minutes: z.number().int().positive().optional(),
});

export const createLeaveSchema = z.object({
  leaveDate: z.string().optional(),
  leave_date: z.string().optional(),
  reason: z.string().optional(),
});

// Prescription Schemas
export const createPrescriptionSchema = z.object({
  appointmentId: z.string().uuid("Invalid appointmentId UUID"),
  diagnosis: z.string().min(1, "Diagnosis is required"),
  medicines: z.array(z.any()).min(1, "At least one medicine is required"),
  notes: z.string().optional(),
});

export const updatePrescriptionSchema = z.object({
  diagnosis: z.string().optional(),
  medicines: z.array(z.any()).optional(),
  notes: z.string().optional(),
});

export const appointmentIdParamSchema = z.object({
  appointmentId: z.string().uuid("Invalid appointmentId UUID"),
});

// Review Schema
export const createReviewSchema = z.object({
  appointmentId: z.string().uuid("Invalid appointmentId UUID"),
  rating: z.number().int().min(1).max(5, "Rating must be between 1 and 5"),
  comment: z.string().optional(),
});

// Admin Schemas
export const verifyDoctorSchema = z.object({
  approve: z.boolean().optional(),
});

export const adminAppointmentsQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
  status: z.string().optional(),
});
