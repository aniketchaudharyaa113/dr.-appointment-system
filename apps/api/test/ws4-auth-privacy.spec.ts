import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import * as argon2 from 'argon2';
import {
  bootTestApp,
  resetDatabaseAndRedis,
  seedVerifiedDoctor,
  seedPatient,
  signJwtForUser,
  TestContext,
} from './helpers/test-app';
import { EnvSchema } from '../src/common/config/env.schema';
import { LoginRateLimitGuard } from '../src/modules/identity/rate-limit/login-rate-limit.guard';
import { AmbulanceService } from '../src/modules/ambulance/services/ambulance.service';

describe('WS4: Auth, Privacy, Env & Ambulance Hardening (B5, B15, B20, B23)', () => {
  let ctx: TestContext;
  let ambulanceService: AmbulanceService;

  beforeAll(async () => {
    ctx = await bootTestApp();
    ambulanceService = ctx.app.get(AmbulanceService);
  });

  afterAll(async () => {
    if (ctx) await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabaseAndRedis(ctx.prisma, ctx.redisClient);
  });

  it('B5: parses ENABLE_DEV_ENDPOINTS="false"/"0" as false and enforces ownership on simulate-trip', async () => {
    const baseProd = {
      NODE_ENV: 'production',
      PORT: '4000',
      DATABASE_URL: 'postgresql://postgres:password@localhost:5432/medibook',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'a_very_long_production_secret_32_chars_ok',
      COOKIE_SECRET: 'a_very_long_production_cookie_secret_ok',
      PAYMENT_PROVIDER: 'RAZORPAY',
      RAZORPAY_KEY_ID: 'rzp_live_123',
      RAZORPAY_KEY_SECRET: 'rzp_live_secret_123',
      RAZORPAY_WEBHOOK_SECRET: 'rzp_live_whsec_123',
      LIVEKIT_API_KEY: 'livekit_live_key',
      LIVEKIT_API_SECRET: 'livekit_live_secret_32_characters_minimum',
      MINIO_ACCESS_KEY: 'minio_real_access_key',
      MINIO_SECRET_KEY: 'minio_real_secret_key',
    };

    const parsedFalse = EnvSchema.safeParse({
      ...baseProd,
      ENABLE_DEV_ENDPOINTS: 'false',
    });
    expect(parsedFalse.success).toBe(true);
    if (parsedFalse.success) {
      expect(parsedFalse.data.ENABLE_DEV_ENDPOINTS).toBe(false);
    }

    const parsedZero = EnvSchema.safeParse({
      ...baseProd,
      ENABLE_DEV_ENDPOINTS: '0',
    });
    expect(parsedZero.success).toBe(true);
    if (parsedZero.success) {
      expect(parsedZero.data.ENABLE_DEV_ENDPOINTS).toBe(false);
    }

    // Ownership check on simulate-trip
    const owner = await seedPatient(ctx.prisma, 'amb-owner');
    const intruder = await seedPatient(ctx.prisma, 'amb-intruder');
    const driverUser = await ctx.prisma.user.create({
      data: {
        email: 'sim-drv@medibook.test',
        passwordHash: await argon2.hash('Driver123!'),
        name: 'Sim Driver',
        role: 'DRIVER',
      },
    });
    await ctx.prisma.ambulanceDriverProfile.create({
      data: {
        userId: driverUser.id,
        vehicleNumber: 'WB-01-SIM',
        isOnline: true,
        lastLat: 22.55,
        lastLng: 88.35,
      },
    });

    const { request } = await ambulanceService.createRequest(
      owner.id,
      22.5512,
      88.3524,
      'Park Street',
      15000,
    );

    const intruderRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/ambulance/dev/requests/${request.id}/simulate-trip`,
      headers: { authorization: `Bearer ${signJwtForUser(intruder)}` },
    });
    expect(intruderRes.statusCode).toBe(403);
  });

  it('B15: public doctor search omits doctor email addresses', async () => {
    await seedVerifiedDoctor(ctx.prisma, {
      email: 'private-doctor-email@medibook.test',
      name: 'Dr. Privacy',
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/doctors',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].email).toBeUndefined();
    expect(body.data[0].userEmail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('private-doctor-email@medibook.test');
  });

  it('B20: logout does not nuke other sessions, deactivation revokes tokens, register hides enumeration, password & verification flows work, rate limit fails closed', async () => {
    // 1. Register new patient (no 409 enumeration on duplicate)
    const reg1 = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'b20user@medibook.test',
        password: 'StrongPassword123!',
        name: 'B20 User',
        role: 'PATIENT',
      },
    });
    expect(reg1.statusCode).toBe(201);
    const userId = reg1.json().user.id;
    const access1 = reg1.json().accessToken;
    const refresh1 = (reg1.headers['set-cookie'] as string).match(/refreshToken=([^;]+)/)?.[1]!;

    // Duplicate registration must NOT return 409 or reveal account existence
    const regDup = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'b20user@medibook.test',
        password: 'AnotherPassword123!',
        name: 'Probe User',
        role: 'PATIENT',
      },
    });
    expect(regDup.statusCode).not.toBe(409);
    expect(JSON.stringify(regDup.json()).toLowerCase()).not.toContain('already exists');

    // Second independent login session
    const login2 = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.10' },
      payload: {
        email: 'b20user@medibook.test',
        password: 'StrongPassword123!',
      },
    });
    expect(login2.statusCode).toBe(200);
    const refresh2 = (login2.headers['set-cookie'] as string).match(/refreshToken=([^;]+)/)?.[1]!;

    // Logout session 1 -> replaying refresh1 returns 401 WITHOUT revoking session 2 (refresh2)!
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken: refresh1 },
    });

    const replayLoggedOut = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: refresh1 },
    });
    expect(replayLoggedOut.statusCode).toBe(401);

    const refresh2StillValid = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: refresh2 },
    });
    expect(refresh2StillValid.statusCode).toBe(200);
    const refresh2b = (refresh2StillValid.headers['set-cookie'] as string).match(/refreshToken=([^;]+)/)?.[1]!;

    // 2. Email verification + change password + forgot/reset password
    const verifyTokenRaw = 'verify-token-test-123456';
    const verifyHash = createHash('sha256').update(verifyTokenRaw).digest('hex');
    await (ctx.prisma as any).userSecurityToken.create({
      data: {
        userId,
        type: 'EMAIL_VERIFY',
        tokenHash: verifyHash,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const verifyRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: verifyTokenRaw },
    });
    expect(verifyRes.statusCode).toBe(200);

    const meVerified = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${access1}` },
    });
    expect(meVerified.json().emailVerified).toBe(true);

    // Change password
    const changePwRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${access1}` },
      payload: {
        currentPassword: 'StrongPassword123!',
        newPassword: 'EvenStrongerPassword456!',
      },
    });
    expect(changePwRes.statusCode).toBe(200);

    // Forgot & reset password
    const forgotRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'b20user@medibook.test' },
    });
    expect(forgotRes.statusCode).toBe(200);

    const resetTokenRaw = 'reset-token-test-789012';
    const resetHash = createHash('sha256').update(resetTokenRaw).digest('hex');
    await (ctx.prisma as any).userSecurityToken.create({
      data: {
        userId,
        type: 'PASSWORD_RESET',
        tokenHash: resetHash,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const resetRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {
        token: resetTokenRaw,
        newPassword: 'ResetPassword789!',
      },
    });
    expect(resetRes.statusCode).toBe(200);

    // Refresh token issued before password reset MUST be revoked
    const afterResetRefresh = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: refresh2b },
    });
    expect(afterResetRefresh.statusCode).toBe(401);

    // Login with new password succeeds
    const loginNewRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.20' },
      payload: {
        email: 'b20user@medibook.test',
        password: 'ResetPassword789!',
      },
    });
    expect(loginNewRes.statusCode).toBe(200);
    const activeRefresh = (loginNewRes.headers['set-cookie'] as string).match(/refreshToken=([^;]+)/)?.[1]!;

    // 3. Admin deactivation revokes all refresh tokens immediately
    const adminUser = await ctx.prisma.user.create({
      data: {
        email: 'admin-b20@medibook.test',
        passwordHash: 'hash',
        name: 'Admin B20',
        role: 'ADMIN',
      },
    });
    const deactRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/deactivate`,
      headers: { authorization: `Bearer ${signJwtForUser(adminUser)}` },
    });
    expect(deactRes.statusCode).toBe(200);

    const revokedTokens = await ctx.prisma.refreshToken.count({
      where: { userId, isRevoked: false },
    });
    expect(revokedTokens).toBe(0);

    const refreshAfterDeact = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: activeRefresh },
    });
    expect(refreshAfterDeact.statusCode).toBe(401);

    // 4. Cross-IP per-account credential stuffing limit (>10 across different IPs)
    for (let i = 1; i <= 10; i++) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': `198.51.100.${i}` },
        payload: { email: 'stuffing-target@medibook.test', password: 'WrongPassword1!' },
      });
    }
    const stuffed = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '198.51.100.99' },
      payload: { email: 'stuffing-target@medibook.test', password: 'WrongPassword1!' },
    });
    expect(stuffed.statusCode).toBe(429);

    // 5. Redis-down login rate limiter fallback does NOT fail open
    const brokenRedisService = {
      getClient: () => ({
        eval: async () => {
          throw new Error('Redis connection refused');
        },
      }),
    };
    const guard = new LoginRateLimitGuard(brokenRedisService as any);
    const makeCtx = (ip: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            ip,
            body: { email: 'redisdown@medibook.test' },
          }),
        }),
      }) as any;

    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(makeCtx('192.0.2.1'))).resolves.toBe(true);
    }
    await expect(guard.canActivate(makeCtx('192.0.2.1'))).rejects.toMatchObject({
      status: 429,
    });
  });

  it('B23: protects driver PII in /ambulance/drivers/online and enforces DB unique active request per patient', async () => {
    const patient = await seedPatient(ctx.prisma, 'b23-patient');
    const admin = await ctx.prisma.user.create({
      data: {
        email: 'b23-admin@medibook.test',
        passwordHash: 'hash',
        name: 'Admin B23',
        role: 'ADMIN',
      },
    });
    const driverUser = await ctx.prisma.user.create({
      data: {
        email: 'b23-drv@medibook.test',
        passwordHash: 'hash',
        name: 'Sensitive Driver Name',
        role: 'DRIVER',
      },
    });
    await ctx.prisma.ambulanceDriverProfile.create({
      data: {
        userId: driverUser.id,
        vehicleNumber: 'WB-02-SECRET-PLATE',
        isOnline: true,
        lastLat: 22.551234,
        lastLng: 88.352456,
      },
    });

    await ambulanceService.updateDriverLocation(
      driverUser.id,
      22.551234,
      88.352456,
      true,
    );

    const patientRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/ambulance/drivers/online?lat=22.55&lng=88.35',
      headers: { authorization: `Bearer ${signJwtForUser(patient)}` },
    });
    expect(patientRes.statusCode).toBe(200);
    const patientUnits = patientRes.json();
    expect(patientUnits).toHaveLength(1);
    expect(patientUnits[0].driverName).toBeUndefined();
    expect(patientUnits[0].vehicleNumber).toBeUndefined();

    const adminRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/ambulance/drivers/online?lat=22.55&lng=88.35',
      headers: { authorization: `Bearer ${signJwtForUser(admin)}` },
    });
    expect(adminRes.statusCode).toBe(200);
    const adminUnits = adminRes.json();
    expect(adminUnits[0].driverName).toBe('Sensitive Driver Name');
    expect(adminUnits[0].vehicleNumber).toBe('WB-02-SECRET-PLATE');

    // Partial unique index prevents 2 concurrent active ambulance requests at DB level
    const dbInserts = await Promise.allSettled([
      ctx.prisma.ambulanceRequest.create({
        data: {
          patientId: patient.id,
          pickupLat: 22.55,
          pickupLng: 88.35,
          pickupAddress: 'Loc 1',
          status: 'REQUESTED',
        },
      }),
      ctx.prisma.ambulanceRequest.create({
        data: {
          patientId: patient.id,
          pickupLat: 22.56,
          pickupLng: 88.36,
          pickupAddress: 'Loc 2',
          status: 'REQUESTED',
        },
      }),
    ]);
    const okCount = dbInserts.filter((r) => r.status === 'fulfilled').length;
    const failCount = dbInserts.filter((r) => r.status === 'rejected').length;
    expect(okCount).toBe(1);
    expect(failCount).toBe(1);
  });
});
