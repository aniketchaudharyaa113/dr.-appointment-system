import { z } from 'zod';
import {
  USER_ROLES,
  CONSULTATION_MODES,
  APPOINTMENT_STATUSES,
  PAYMENT_STATUSES,
} from '../constants';

export const UserRoleSchema = z.enum(USER_ROLES);
export const PublicRegisterRoleSchema = z.enum(['PATIENT', 'DOCTOR']);
export const AdminCreateRoleSchema = z.enum(['ADMIN', 'DRIVER']);
export const ConsultationModeSchema = z.enum(CONSULTATION_MODES);
export const AppointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export const UuidSchema = z.string().uuid();

export const RegisterUserSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password must be at most 128 characters long')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
  role: PublicRegisterRoleSchema.default('PATIENT'),
  specialty: z.string().optional(),
  qualifications: z.string().optional(),
  experienceYears: z.coerce.number().int().min(0).max(80).optional(),
  clinicName: z.string().optional(),
  clinicAddress: z.string().optional(),
  clinicLat: z.number().optional(),
  clinicLng: z.number().optional(),
  consultationFeePaise: z.number().int().nonnegative().optional(),
  licenseNumber: z.string().optional(),
});
export type RegisterUserInput = z.infer<typeof RegisterUserSchema>;

export const AdminCreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters long').max(128),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
  role: AdminCreateRoleSchema,
  vehicleNumber: z.string().min(3).max(30).optional(),
  licensePlate: z.string().max(30).optional(),
});
export type AdminCreateUserInput = z.infer<typeof AdminCreateUserSchema>;

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required').max(128),
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
  rejectionReason: z.string().max(500).optional(),
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

export const RecordVitalsSchema = z.object({
  systolicBp: z.number().int().min(50).max(250).optional(),
  diastolicBp: z.number().int().min(30).max(180).optional(),
  heartRate: z.number().int().min(30).max(250).optional(),
  spO2: z.number().min(50).max(100).optional(),
  temperatureF: z.number().min(90).max(110).optional(),
  weightKg: z.number().min(1).max(350).optional(),
  bloodGlucose: z.number().min(20).max(800).optional(),
});
export type RecordVitalsInput = z.infer<typeof RecordVitalsSchema>;

export const CreateLabOrderSchema = z.object({
  testName: z.string().min(2).max(120),
  testCode: z.string().min(2).max(30),
  urgency: z.enum(['ROUTINE', 'URGENT', 'STAT']).optional(),
  instructions: z.string().max(500).optional(),
});
export type CreateLabOrderInput = z.infer<typeof CreateLabOrderSchema>;

export const AiTriageQuerySchema = z.object({
  query: z.string().min(1).max(1000),
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

export const CreateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});
export type CreateReviewInput = z.infer<typeof CreateReviewSchema>;

export const UpdateLabResultsSchema = z.object({
  status: z.enum(['SAMPLE_COLLECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED']).optional().default('COMPLETED'),
  results: z.union([z.string().min(1), z.record(z.any())]).optional(),
  resultsJson: z.record(z.any()).optional(),
  resultNotes: z.string().max(1000).optional(),
});
export type UpdateLabResultsInput = z.infer<typeof UpdateLabResultsSchema>;

export const ReleaseSlotHoldSchema = z.object({
  doctorId: z.string().uuid().optional(),
  slotTime: z.string().optional(),
});
export type ReleaseSlotHoldInput = z.infer<typeof ReleaseSlotHoldSchema>;

export const UpdateDoctorAvailabilitySchema = z
  .object({
    slots: z.array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
        slotDurationMinutes: z.number().int().positive().default(15),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    const parseMins = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };

    const byDay = new Map<
      number,
      Array<{ startMins: number; endMins: number; index: number }>
    >();

    for (let i = 0; i < data.slots.length; i++) {
      const s = data.slots[i];
      const startMins = parseMins(s.startTime);
      const endMins = parseMins(s.endTime);
      const duration = s.slotDurationMinutes || 15;

      if (startMins >= endMins) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slots', i, 'endTime'],
          message: 'startTime must be strictly before endTime',
        });
      } else if ((endMins - startMins) % duration !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slots', i, 'slotDurationMinutes'],
          message: 'slotDurationMinutes must evenly divide the time window',
        });
      }

      if (!byDay.has(s.dayOfWeek)) byDay.set(s.dayOfWeek, []);
      byDay.get(s.dayOfWeek)!.push({ startMins, endMins, index: i });
    }

    for (const [, daySlots] of byDay) {
      daySlots.sort((a, b) => a.startMins - b.startMins);
      for (let j = 0; j < daySlots.length - 1; j++) {
        if (daySlots[j].endMins > daySlots[j + 1].startMins) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['slots', daySlots[j + 1].index],
            message: 'Overlapping availability windows on the same day are not allowed',
          });
        }
      }
    }
  });
export type UpdateDoctorAvailabilityInput = z.infer<typeof UpdateDoctorAvailabilitySchema>;

export const UpdateDoctorProfileSchema = z.object({
  specialty: z.string().optional(),
  qualifications: z.string().optional(),
  experienceYears: z.number().int().nonnegative().optional(),
  clinicName: z.string().optional(),
  clinicAddress: z.string().optional(),
  consultationFeePaise: z.number().int().nonnegative().optional(),
  licenseNumber: z.string().optional(),
  photoUrl: z.string().optional(),
});
export type UpdateDoctorProfileInput = z.infer<typeof UpdateDoctorProfileSchema>;

export const MyAppointmentsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z
    .enum([
      'PENDING_PAYMENT',
      'CONFIRMED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
      'REFUNDED',
    ])
    .optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mode: z.enum(['VIDEO', 'IN_CLINIC', 'CHAT']).optional(),
});
export type MyAppointmentsQuery = z.infer<typeof MyAppointmentsQuerySchema>;
