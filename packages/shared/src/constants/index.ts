export const CLINIC_TIMEZONE = 'Asia/Kolkata';

export const USER_ROLES = ['PATIENT', 'DOCTOR', 'ADMIN', 'DRIVER'] as const;

export const CONSULTATION_MODES = ['IN_CLINIC', 'VIDEO', 'CHAT'] as const;

export const APPOINTMENT_STATUSES = [
  'HELD',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'REFUNDED',
] as const;

export const PAYMENT_STATUSES = [
  'INITIATED',
  'PENDING',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
] as const;

export const REFUND_STATUSES = ['PENDING', 'PROCESSED', 'FAILED'] as const;

export const CONSULTATION_SESSION_STATUSES = [
  'SCHEDULED',
  'WAITING',
  'LIVE',
  'ENDED',
] as const;

export const AMBULANCE_REQUEST_STATUSES = [
  'REQUESTED',
  'OFFERED',
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;

export const WAITLIST_STATUSES = [
  'WAITING',
  'OFFERED',
  'CLAIMED',
  'EXPIRED',
  'CANCELLED',
] as const;

export const SLOT_HOLD_DURATION_SECONDS = 600; // 10 minutes
export const WAITLIST_CLAIM_WINDOW_SECONDS = 900; // 15 minutes
export const DRIVER_DISPATCH_TIMEOUT_SECONDS = 20; // 20 seconds
export const DRIVER_HEARTBEAT_TTL_SECONDS = 15; // 15 seconds
