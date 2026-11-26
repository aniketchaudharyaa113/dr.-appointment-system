import { describe, it, expect } from 'vitest';
import {
  RegisterUserSchema,
  HoldSlotSchema,
  AmbulanceRequestSchema,
  UpdateDoctorAvailabilitySchema,
  CLINIC_TIMEZONE,
  SLOT_HOLD_DURATION_SECONDS,
} from '../src';

describe('Shared Schemas & Constants', () => {
  it('exports correct domain constants', () => {
    expect(CLINIC_TIMEZONE).toBe('Asia/Kolkata');
    expect(SLOT_HOLD_DURATION_SECONDS).toBe(600);
  });

  it('validates a patient registration payload', () => {
    const payload = {
      email: 'anita.roy@test.com',
      password: 'password123',
      name: 'Anita Roy',
      role: 'PATIENT',
    };
    const res = RegisterUserSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });

  it('validates doctor registration with clinic details and paise fee', () => {
    const payload = {
      email: 'dr.subhash@test.com',
      password: 'securepassword123',
      name: 'Dr. Subhash Chandra',
      role: 'DOCTOR',
      specialty: 'Cardiology',
      consultationFeePaise: 80000, // 800 INR
    };
    const res = RegisterUserSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });

  it('rejects short passwords', () => {
    const payload = {
      email: 'test@test.com',
      password: 'short',
      name: 'Test User',
    };
    const res = RegisterUserSchema.safeParse(payload);
    expect(res.success).toBe(false);
  });

  it('validates slot hold schema', () => {
    const holdPayload = {
      doctorId: '123e4567-e89b-12d3-a456-426614174000',
      slotTime: '2027-01-15T10:00:00.000Z',
      consultationMode: 'VIDEO',
    };
    const res = HoldSlotSchema.safeParse(holdPayload);
    expect(res.success).toBe(true);
  });

  it('validates ambulance request coordinates', () => {
    const ambulancePayload = {
      pickupLat: 22.5726,
      pickupLng: 88.3639,
      pickupAddress: 'Park Street, Kolkata',
    };
    const res = AmbulanceRequestSchema.safeParse(ambulancePayload);
    expect(res.success).toBe(true);
  });

  describe('UpdateDoctorAvailabilitySchema (P2-5)', () => {
    it('accepts valid non-overlapping slots with dividing duration', () => {
      const res = UpdateDoctorAvailabilitySchema.safeParse({
        slots: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', slotDurationMinutes: 15 },
          { dayOfWeek: 1, startTime: '14:00', endTime: '17:00', slotDurationMinutes: 30 },
        ],
      });
      expect(res.success).toBe(true);
    });

    it('rejects when startTime is after endTime', () => {
      const res = UpdateDoctorAvailabilitySchema.safeParse({
        slots: [
          { dayOfWeek: 1, startTime: '12:00', endTime: '09:00', slotDurationMinutes: 15 },
        ],
      });
      expect(res.success).toBe(false);
    });

    it('rejects when slotDurationMinutes does not divide the window', () => {
      const res = UpdateDoctorAvailabilitySchema.safeParse({
        slots: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '09:50', slotDurationMinutes: 15 },
        ],
      });
      expect(res.success).toBe(false);
    });

    it('rejects overlapping slots on the same day', () => {
      const res = UpdateDoctorAvailabilitySchema.safeParse({
        slots: [
          { dayOfWeek: 1, startTime: '09:00', endTime: '11:00', slotDurationMinutes: 15 },
          { dayOfWeek: 1, startTime: '10:30', endTime: '12:00', slotDurationMinutes: 15 },
        ],
      });
      expect(res.success).toBe(false);
    });
  });
});
