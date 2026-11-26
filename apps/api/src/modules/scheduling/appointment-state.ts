import { BadRequestException } from '@nestjs/common';

export type AppointmentStatus =
  | 'HELD'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'REFUNDED';

export type SessionStatus = 'SCHEDULED' | 'WAITING' | 'LIVE' | 'ENDED';

export const ALLOWED_APPOINTMENT_TRANSITIONS: Record<
  AppointmentStatus,
  AppointmentStatus[]
> = {
  HELD: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'NO_SHOW', 'CANCELLED', 'REFUNDED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['REFUNDED'],
  CANCELLED: [],
  NO_SHOW: [],
  REFUNDED: [],
};

export const ALLOWED_SESSION_TRANSITIONS: Record<
  SessionStatus,
  SessionStatus[]
> = {
  SCHEDULED: ['WAITING', 'LIVE', 'ENDED'],
  WAITING: ['LIVE', 'ENDED'],
  LIVE: ['ENDED'],
  ENDED: [],
};

export function canTransitionAppointment(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_APPOINTMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertAppointmentTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): void {
  if (!canTransitionAppointment(from, to)) {
    throw new BadRequestException(
      `Invalid appointment status transition from ${from} to ${to}`,
    );
  }
}

export function canTransitionSession(
  from: SessionStatus,
  to: SessionStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_SESSION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertSessionTransition(
  from: SessionStatus,
  to: SessionStatus,
): void {
  if (!canTransitionSession(from, to)) {
    throw new BadRequestException(
      `Invalid consultation session transition from ${from} to ${to}`,
    );
  }
}
