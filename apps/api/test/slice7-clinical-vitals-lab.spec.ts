import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { env } from '../src/common/config/env.schema';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  TestContext,
} from './helpers/test-app';

describe('Clinical Service: Telemedicine Vitals & Diagnostic Lab Orders', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await bootTestApp();
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  it('records clinical vitals, enforces authorization, and returns recorded history', async () => {
    // 1. Seed doctor and patient
    const doctorUser = await ctx.prisma.user.create({
      data: {
        email: `doc_vitals_${Date.now()}@medibook.test`,
        passwordHash: 'hashed',
        name: 'Dr. Vitals Specialist',
        role: 'DOCTOR',
      },
    });

    const doctor = await ctx.prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        specialty: 'Cardiology',
        isVerified: true,
      },
    });

    const patientUser = await ctx.prisma.user.create({
      data: {
        email: `patient_vitals_${Date.now()}@medibook.test`,
        passwordHash: 'hashed',
        name: 'Patient Heart',
        role: 'PATIENT',
      },
    });

    const appt = await ctx.prisma.appointment.create({
      data: {
        patientId: patientUser.id,
        doctorId: doctor.id,
        slotTime: new Date(Date.now() + 3600000),
        status: 'CONFIRMED',
      },
    });

    const patientToken = jwt.sign(
      { sub: patientUser.id, email: patientUser.email, role: 'PATIENT' },
      env.JWT_SECRET,
    );
    const doctorToken = jwt.sign(
      { sub: doctorUser.id, email: doctorUser.email, role: 'DOCTOR' },
      env.JWT_SECRET,
    );
    const strangerToken = jwt.sign(
      { sub: '00000000-0000-0000-0000-000000000099', email: 'stranger@test.com', role: 'PATIENT' },
      env.JWT_SECRET,
    );

    // 2. Stranger tries to record vitals -> 403 Forbidden
    const strangerRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/consultations/${appt.id}/vitals`,
      headers: { authorization: `Bearer ${strangerToken}` },
      payload: { systolicBp: 120, diastolicBp: 80, heartRate: 72 },
    });
    expect(strangerRes.statusCode).toBe(403);

    // 3. Patient records real biometric telemetry
    const patientRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/consultations/${appt.id}/vitals`,
      headers: { authorization: `Bearer ${patientToken}` },
      payload: {
        systolicBp: 125,
        diastolicBp: 82,
        heartRate: 75,
        spO2: 98.5,
        temperatureF: 98.6,
        bloodGlucose: 110.5,
      },
    });
    expect(patientRes.statusCode).toBe(201);
    const recorded = patientRes.json();
    expect(recorded.appointmentId).toBe(appt.id);
    expect(recorded.systolicBp).toBe(125);
    expect(recorded.heartRate).toBe(75);

    // 4. Doctor queries appointment vitals history
    const doctorGetRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/consultations/${appt.id}/vitals`,
      headers: { authorization: `Bearer ${doctorToken}` },
    });
    expect(doctorGetRes.statusCode).toBe(200);
    const vitalsList = doctorGetRes.json();
    expect(vitalsList.length).toBe(1);
    expect(vitalsList[0].id).toBe(recorded.id);
  });

  it('orders diagnostic lab tests, prevents unauthorized access, and lists active orders', async () => {
    // 1. Seed doctor and patient
    const doctorUser = await ctx.prisma.user.create({
      data: {
        email: `doc_lab_${Date.now()}@medibook.test`,
        passwordHash: 'hashed',
        name: 'Dr. Lab Specialist',
        role: 'DOCTOR',
      },
    });

    const doctor = await ctx.prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        specialty: 'Endocrinology',
        isVerified: true,
      },
    });

    const patientUser = await ctx.prisma.user.create({
      data: {
        email: `patient_lab_${Date.now()}@medibook.test`,
        passwordHash: 'hashed',
        name: 'Patient Diabetes Care',
        role: 'PATIENT',
      },
    });

    const appt = await ctx.prisma.appointment.create({
      data: {
        patientId: patientUser.id,
        doctorId: doctor.id,
        slotTime: new Date(Date.now() + 3600000),
        status: 'CONFIRMED',
      },
    });

    const patientToken = jwt.sign(
      { sub: patientUser.id, email: patientUser.email, role: 'PATIENT' },
      env.JWT_SECRET,
    );
    const doctorToken = jwt.sign(
      { sub: doctorUser.id, email: doctorUser.email, role: 'DOCTOR' },
      env.JWT_SECRET,
    );

    // 2. Patient cannot order diagnostic labs for themselves -> 403 Forbidden
    const patientOrderRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/consultations/${appt.id}/lab-orders`,
      headers: { authorization: `Bearer ${patientToken}` },
      payload: {
        testName: 'Complete Blood Count (CBC)',
        testCode: 'CBC-001',
      },
    });
    expect(patientOrderRes.statusCode).toBe(403);

    // 3. Treating Doctor orders HbA1c + Lipid Panel
    const docOrderRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/consultations/${appt.id}/lab-orders`,
      headers: { authorization: `Bearer ${doctorToken}` },
      payload: {
        testName: 'Glycated Hemoglobin (HbA1c)',
        testCode: 'HBA1C-FASTING',
        urgency: 'ROUTINE',
        instructions: '12-hour overnight fasting required before sample collection',
      },
    });
    expect(docOrderRes.statusCode).toBe(201);
    const order = docOrderRes.json();
    expect(order.testCode).toBe('HBA1C-FASTING');
    expect(order.status).toBe('ORDERED');

    // 4. Patient reads their lab orders
    const patientGetRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/consultations/${appt.id}/lab-orders`,
      headers: { authorization: `Bearer ${patientToken}` },
    });
    expect(patientGetRes.statusCode).toBe(200);
    const ordersList = patientGetRes.json();
    expect(ordersList.length).toBe(1);
    expect(ordersList[0].id).toBe(order.id);

    // 5. Patient retrieves aggregated Health Passport
    const passportRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/patients/health-passport',
      headers: { authorization: `Bearer ${patientToken}` },
    });
    expect(passportRes.statusCode).toBe(200);
    const passport = passportRes.json();
    expect(passport.patient.id).toBe(patientUser.id);
    expect(passport.labOrders.length).toBe(1);
    expect(passport.labOrders[0].testCode).toBe('HBA1C-FASTING');
  });
});
