import {
  USER_ROLES,
  CONSULTATION_MODES,
  APPOINTMENT_STATUSES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  CONSULTATION_SESSION_STATUSES,
  AMBULANCE_REQUEST_STATUSES,
  WAITLIST_STATUSES,
} from '../constants';

export type UserRole = (typeof USER_ROLES)[number];
export type ConsultationMode = (typeof CONSULTATION_MODES)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export type ConsultationSessionStatus = (typeof CONSULTATION_SESSION_STATUSES)[number];
export type AmbulanceRequestStatus = (typeof AMBULANCE_REQUEST_STATUSES)[number];
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  error?: string;
  requestId?: string;
  timestamp: string;
  details?: unknown;
}
