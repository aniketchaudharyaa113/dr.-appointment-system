import { z } from 'zod';
import {
  USER_ROLES,
  CONSULTATION_MODES,
  APPOINTMENT_STATUSES,
  PAYMENT_STATUSES,
} from '../constants';

export const UserRoleSchema = z.enum(USER_ROLES);
export const ConsultationModeSchema = z.enum(CONSULTATION_MODES);
export const AppointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export const UuidSchema = z.string().uuid();

export const RegisterUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
  role: UserRoleSchema.default('PATIENT'),
  specialty: z.string().optional(),
  qualifications: z.string().optional(),
  clinicName: z.string().optional(),
  clinicAddress: z.string().optional(),
  clinicLat: z.number().optional(),
  clinicLng: z.number().optional(),
  consultationFeePaise: z.number().int().nonnegative().optional(),
  licenseNumber: z.string().optional(),
});
export type RegisterUserInput = z.infer<typeof RegisterUserSchema>;

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshTokenBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const HoldSlotSchema = z.object({
  doctorId: z.string().uuid(),
  slotTime: z.string().datetime({ offset: true }),
  consultationMode: ConsultationModeSchema.default('VIDEO'),
});
export type HoldSlotInput = z.infer<typeof HoldSlotSchema>;

export const BookAppointmentSchema = z.object({
  doctorId: z.string().uuid(),
  slotTime: z.string().datetime({ offset: true }),
  holdToken: z.string().min(16, 'Valid holdToken is required'),
  consultationMode: ConsultationModeSchema.default('VIDEO'),
  notes: z.string().max(1000).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
export type BookAppointmentInput = z.infer<typeof BookAppointmentSchema>;

export const CancelAppointmentSchema = z.object({
  reason: z.string().min(2).max(500).optional(),
});
export type CancelAppointmentInput = z.infer<typeof CancelAppointmentSchema>;

export const DoctorSearchQuerySchema = z.object({
  symptom: z.string().max(200).optional(),
  specialty: z.string().max(100).optional(),
  maxFeePaise: z.coerce.number().int().nonnegative().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  userLat: z.coerce.number().min(-90).max(90).optional(),
  userLng: z.coerce.number().min(-180).max(180).optional(),
  maxDistanceKm: z.coerce.number().positive().optional(),
  sortBy: z.enum(['FEE_ASC', 'RATING_DESC', 'DISTANCE_ASC', 'EXPERIENCE_DESC']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
});
export type DoctorSearchQuery = z.infer<typeof DoctorSearchQuerySchema>;

export const DoctorSlotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').optional(),
});

export const LeaveRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  reason: z.string().max(255).optional(),
});

export const JoinWaitlistSchema = z.object({
  doctorId: z.string().uuid(),
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  slotTime: z.string().datetime({ offset: true }).optional(),
});

export const CreatePaymentOrderSchema = z.object({
  appointmentId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(100),
});
export type CreatePaymentOrderInput = z.infer<typeof CreatePaymentOrderSchema>;

export const RefundPaymentSchema = z.object({
  reason: z.string().min(2).max(500).optional(),
});

export const DevSimulateWebhookSchema = z.object({
  paymentId: z.string().uuid().optional(),
  providerOrderId: z.string().min(1).optional(),
  event: z.enum(['payment.captured', 'payment.failed']).default('payment.captured'),
});

export const VerifyDoctorSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
});

export const ConsultationStatusSchema = z.object({
  status: z.enum(['WAITING', 'LIVE', 'ENDED']),
});

export const SendChatMessageSchema = z.object({
  content: z.string().max(4000).default(''),
  attachmentUrl: z.string().max(500).optional(),
  attachmentType: z.string().max(100).optional(),
});

export const UploadAttachmentUrlSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
});

export const MedicineItemSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().min(1),
  frequency: z.string().min(1),
  durationDays: z.number().int().positive(),
  instructions: z.string().optional(),
});
export type MedicineItem = z.infer<typeof MedicineItemSchema>;

export const CreatePrescriptionSchema = z.object({
  diagnosis: z.string().min(3),
  medicines: z.array(MedicineItemSchema).default([]),
  advice: z.string().optional(),
});
export type CreatePrescriptionInput = z.infer<typeof CreatePrescriptionSchema>;

export const AmbulanceRequestSchema = z.object({
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  pickupAddress: z.string().min(5).max(255),
});
export type AmbulanceRequestInput = z.infer<typeof AmbulanceRequestSchema>;

export const UpdateTripStatusSchema = z.object({
  status: z.enum(['EN_ROUTE', 'ARRIVED', 'COMPLETED']),
});

export const DriverTelemetrySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isOnline: z.boolean(),
});

export const DriverLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  bearing: z.number().optional(),
  speedKmh: z.number().optional(),
});
export type DriverLocationInput = z.infer<typeof DriverLocationSchema>;

export const AiTriageQuerySchema = z.object({
  query: z.string().min(1).max(2000),
});

export const AiChatQuerySchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        sender: z.string(),
        content: z.string(),
      }),
    )
    .optional(),
  conversationId: z.string().uuid().optional(),
});
export type AiChatQueryInput = z.infer<typeof AiChatQuerySchema>;

export const AiCopilotNoteSchema = z.object({
  appointmentId: z.string().uuid(),
  patientName: z.string().min(1).max(255),
  messages: z
    .array(
      z.object({
        sender: z.string(),
        content: z.string(),
      }),
    )
    .default([]),
});
