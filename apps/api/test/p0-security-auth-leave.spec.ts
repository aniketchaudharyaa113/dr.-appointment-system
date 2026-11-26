import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedPatient,
  seedVerifiedDoctor,
  signJwtForUser,
  TestContext,
} from './helpers/test-app';
import { getIstDateString } from '../src/common/utils/ist-time';

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

  it('P0-2: prevents IDOR on doctor leave preview/apply and rejects past or overlapping leaves', async () => {
    const docA = await seedVerifiedDoctor(ctx.prisma, { email: 'doca@medibook.test', name: 'Dr. A' });
    const docB = await seedVerifiedDoctor(ctx.prisma, { email: 'docb@medibook.test', name: 'Dr. B' });

    const docAToken = signJwtForUser(docA.user);
    const docBToken = signJwtForUser(docB.user);

    const tomorrow = new Date(Date.now() + 86400_000);
    const dayAfter = new Date(Date.now() + 2 * 86400_000);
    const startDate = getIstDateString(tomorrow);
    const endDate = getIstDateString(dayAfter);

    // Doctor B cannot preview Doctor A's leave (IDOR + PII leak)
    const previewIdor = await ctx.app.inject({
      method: 'POST',
      url: `/api/doctors/${docA.doctor.id}/leaves/preview`,
      headers: { authorization: `Bearer ${docBToken}` },
      payload: { startDate, endDate },
    });
    expect(previewIdor.statusCode).toBe(403);

    // Doctor B cannot apply leave for Doctor A
    const applyIdor = await ctx.app.inject({
      method: 'POST',
      url: `/api/doctors/${docA.doctor.id}/leaves`,
      headers: { authorization: `Bearer ${docBToken}` },
      payload: { startDate, endDate, reason: 'IDOR attempt' },
    });
    expect(applyIdor.statusCode).toBe(403);

    // Past start date rejected
    const pastRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/doctors/${docA.doctor.id}/leaves`,
      headers: { authorization: `Bearer ${docAToken}` },
      payload: { startDate: '2020-01-01', endDate: '2020-01-02', reason: 'Past' },
    });
    expect(pastRes.statusCode).toBe(400);

    // Doctor A applies valid leave
    const okRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/doctors/${docA.doctor.id}/leaves`,
      headers: { authorization: `Bearer ${docAToken}` },
      payload: { startDate, endDate, reason: 'Medical Conference' },
    });
    expect(okRes.statusCode).toBe(201);

    // Overlapping leave rejected with 409 Conflict
    const overlapRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/doctors/${docA.doctor.id}/leaves`,
      headers: { authorization: `Bearer ${docAToken}` },
      payload: { startDate: endDate, endDate, reason: 'Overlap' },
    });
    expect(overlapRes.statusCode).toBe(409);
  });

  it('P0-13: enforces isActive check, concurrent refresh grace window, safe logout on revoked token, and password strength', async () => {
    // Weak password without digit rejected
    const weakReg = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'weakpw@medibook.test',
        password: 'OnlyLettersPassword',
        name: 'Weak Pw',
        role: 'PATIENT',
      },
    });
    expect(weakReg.statusCode).toBe(400);

    // Register valid patient
    const reg = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'activecheck@medibook.test',
        password: 'StrongPassword123!',
        name: 'Active User',
        role: 'PATIENT',
      },
    });
    expect(reg.statusCode).toBe(201);
    const { accessToken, user } = reg.json();
    const refresh1 = (reg.headers['set-cookie'] as string).match(/refreshToken=([^;]+)/)?.[1]!;

    // Concurrent refresh: two requests with refresh1 -> one succeeds (200), one gets 401 within 10s grace window WITHOUT revoking refresh2
    const [r1, r2] = await Promise.all([
      ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: refresh1 } }),
      ctx.app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: refresh1 } }),
    ]);
    const statuses = [r1.statusCode, r2.statusCode].sort();
    expect(statuses).toEqual([200, 401]);
    const winner = r1.statusCode === 200 ? r1 : r2;
    const refresh2 = (winner.headers['set-cookie'] as string).match(/refreshToken=([^;]+)/)?.[1]!;

    // refresh2 must still be valid (no false-positive family revocation)
    const afterGraceCheck = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: refresh2 },
    });
    expect(afterGraceCheck.statusCode).toBe(200);
    const refresh3 = (afterGraceCheck.headers['set-cookie'] as string).match(/refreshToken=([^;]+)/)?.[1]!;

    // Logout with already-revoked refresh1 is safe and does not revoke refresh3
    const logoutRevoked = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken: refresh1 },
    });
    expect(logoutRevoked.statusCode).toBe(200);

    const refresh3Valid = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: refresh3 },
    });
    expect(refresh3Valid.statusCode).toBe(200);

    // Deactivate user and clear cached active flag -> JwtAuthGuard rejects accessToken
    await ctx.prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await ctx.redisClient.del(`user:active:${user.id}`);

    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(meRes.statusCode).toBe(401);
  });
});
