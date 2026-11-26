import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedPatient,
  signJwtForUser,
  TestContext,
} from './helpers/test-app';

describe('P0 Security: Registration Privilege Escalation & RBAC', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await bootTestApp();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('P0-1: rejects ADMIN and DRIVER roles on public /api/auth/register', async () => {
    for (const forbiddenRole of ['ADMIN', 'DRIVER']) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: `escalate-${forbiddenRole.toLowerCase()}@medibook.test`,
          password: 'StrongPassword123!',
          name: 'Attacker User',
          role: forbiddenRole,
        },
      });
      expect(res.statusCode).toBe(400);
    }

    const okRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'legit-patient@medibook.test',
        password: 'StrongPassword123!',
        name: 'Legit Patient',
        role: 'PATIENT',
      },
    });
    expect(okRes.statusCode).toBe(201);
    expect(okRes.json().user.role).toBe('PATIENT');
  });

  it('P0-1: allows ADMIN (and forbids PATIENT) to create DRIVER/ADMIN via /api/admin/users', async () => {
    const patient = await seedPatient(ctx.prisma);
    const patientToken = signJwtForUser(patient);

    const patientAttempt = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${patientToken}` },
      payload: {
        email: 'driver-attempt@medibook.test',
        password: 'StrongPassword123!',
        name: 'Attempt Driver',
        role: 'DRIVER',
      },
    });
    expect(patientAttempt.statusCode).toBe(403);

    const adminUser = await ctx.prisma.user.create({
      data: {
        email: 'super-admin@medibook.test',
        passwordHash: 'hashed',
        name: 'Super Admin',
        role: 'ADMIN',
      },
    });
    const adminToken = signJwtForUser(adminUser);

    const driverRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        email: 'real-driver@medibook.test',
        password: 'StrongPassword123!',
        name: 'Real Driver',
        role: 'DRIVER',
        vehicleNumber: 'WB-02-9999',
      },
    });
    expect(driverRes.statusCode).toBe(201);
    expect(driverRes.json().role).toBe('DRIVER');
  });
});
