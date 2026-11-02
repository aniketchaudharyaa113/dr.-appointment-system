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

export const RegisterUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
  role: UserRoleSchema.default('PATIENT'),
  // Doctor profile fields if role === 'DOCTOR'
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

export const HoldSlotSchema = z.object({
  doctorId: z.string().uuid(),
  slotTime: z.string().datetime(), // ISO 8601 wall clock string
  consultationMode: ConsultationModeSchema.default('VIDEO'),
});
export type HoldSlotInput = z.infer<typeof HoldSlotSchema>;

export const CreatePaymentOrderSchema = z.object({
  appointmentId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
});
export type CreatePaymentOrderInput = z.infer<typeof CreatePaymentOrderSchema>;

export const MedicineItemSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().min(1),
  frequency: z.string().min(1),
  durationDays: z.number().int().positive(),
  instructions: z.string().optional(),
});
export type MedicineItem = z.infer<typeof MedicineItemSchema>;

export const CreatePrescriptionSchema = z.object({
  appointmentId: z.string().uuid(),
  diagnosis: z.string().min(3),
  medicines: z.array(MedicineItemSchema).default([]),
  advice: z.string().optional(),
});
export type CreatePrescriptionInput = z.infer<typeof CreatePrescriptionSchema>;

export const AmbulanceRequestSchema = z.object({
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  pickupAddress: z.string().min(5),
});
export type AmbulanceRequestInput = z.infer<typeof AmbulanceRequestSchema>;

export const DriverLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  bearing: z.number().optional(),
  speedKmh: z.number().optional(),
});
export type DriverLocationInput = z.infer<typeof DriverLocationSchema>;

export const AiChatQuerySchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
});
export type AiChatQueryInput = z.infer<typeof AiChatQuerySchema>;
