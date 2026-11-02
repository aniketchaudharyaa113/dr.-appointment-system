import { describe, it, expect } from 'vitest';
import {
  RegisterUserSchema,
  HoldSlotSchema,
  AmbulanceRequestSchema,
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
});
