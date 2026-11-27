import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createConfiguredApp } from '../../src/common/app.bootstrap';
import { PrismaService } from '../../src/modules/platform/database/prisma.service';
import { RedisService } from '../../src/modules/platform/redis/redis.service';

export interface TestContext {
  app: NestFastifyApplication;
  prisma: PrismaService;
  redis: RedisService;
  redisClient: Redis;
}

export async function bootTestApp(): Promise<TestContext> {
  const app = await createConfiguredApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const redisClient = redis.getClient();

  return { app, prisma, redis, redisClient };
}

export async function resetDatabaseAndRedis(
  prisma: PrismaClient,
  redisClient: Redis,
) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      lab_orders,
      patient_vitals,
      chat_messages,
      prescription_versions,
      prescriptions,
      consultation_sessions,
      ledger_entries,
      refunds,
      payment_events,
      checkout_idempotency_keys,
      payments,
      reviews,
      waitlists,
      appointments,
      doctor_daily_counters,
      doctor_leaves,
      availability,
      doctors,
      ambulance_requests,
      ambulance_driver_profiles,
      refresh_tokens,
      audit_logs,
      notifications,
      outbox_events,
      symptom_specialty_map,
      users
    RESTART IDENTITY CASCADE;
  `);
  await redisClient.flushdb();
}

export async function seedVerifiedDoctor(
  prisma: PrismaClient,
  overrides: Partial<{
    email: string;
    name: string;
    specialty: string;
    consultationFeePaise: number;
  }> = {},
) {
  const passwordHash = await argon2.hash('Password123!', {
    type: argon2.argon2id,
  });

  const user = await prisma.user.create({
    data: {
      email: overrides.email || `doc-${Date.now()}-${Math.random()}@medibook.test`,
      passwordHash,
      name: overrides.name || 'Dr. Subhash Chandra',
      role: 'DOCTOR',
    },
  });

  const doctor = await prisma.doctor.create({
    data: {
      userId: user.id,
      specialty: overrides.specialty || 'Cardiology',
      qualifications: 'MBBS, MD, DM',
      experienceYears: 15,
      consultationFeePaise: overrides.consultationFeePaise ?? 80000,
      licenseNumber: 'WMC-TEST-1234',
      isVerified: true,
      verificationStatus: 'APPROVED',
    },
  });

  // Availability every day 09:00 - 20:00, 15 min slots
  await prisma.availability.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      doctorId: doctor.id,
      dayOfWeek,
      startTime: '09:00:00',
      endTime: '20:00:00',
      slotDurationMinutes: 15,
    })),
  });

  return { user, doctor };
}

export async function seedPatient(
  prisma: PrismaClient,
  emailPrefix = 'patient',
) {
  const passwordHash = await argon2.hash('Password123!', {
    type: argon2.argon2id,
  });
  return prisma.user.create({
    data: {
      email: `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@medibook.test`,
      passwordHash,
      name: 'Test Patient',
      role: 'PATIENT',
    },
  });
}

export async function seedAdmin(prisma: PrismaClient) {
  const passwordHash = await argon2.hash('Password123!', {
    type: argon2.argon2id,
  });
  return prisma.user.create({
    data: {
      email: `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@medibook.test`,
      passwordHash,
      name: 'Test Admin',
      role: 'ADMIN',
    },
  });
}

export function signJwtForUser(user: { id: string; email: string; role: string }) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' },
  );
}
