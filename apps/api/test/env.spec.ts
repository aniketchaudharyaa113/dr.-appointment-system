import { describe, it, expect } from 'vitest';
import { EnvSchema } from '../src/common/config/env.schema';

describe('Environment Schema Validation (Fail-Fast)', () => {
  const baseValid = {
    NODE_ENV: 'test',
    PORT: '4000',
    DATABASE_URL: 'postgresql://postgres:password@localhost:5432/medibook',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a_very_long_and_secure_jwt_secret_32_characters_minimum',
    COOKIE_SECRET: 'a_very_secure_cookie_secret_16_plus',
    PAYMENT_PROVIDER: 'FAKE',
    PAYMENT_WEBHOOK_SECRET: 'fake_webhook_secret_123',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'livekit_secret_32_characters_minimum',
    MINIO_ACCESS_KEY: 'minioadmin',
    MINIO_SECRET_KEY: 'minioadmin',
  };

  it('validates a complete and correct configuration', () => {
    const parsed = EnvSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.PORT).toBe(4000);
      expect(parsed.data.CLINIC_TIMEZONE).toBe('Asia/Kolkata');
      expect(parsed.data.PAYMENT_PROVIDER).toBe('FAKE');
    }
  });

  it('fails fast when JWT_SECRET or COOKIE_SECRET or LIVEKIT_API_SECRET is missing or too short', () => {
    expect(
      EnvSchema.safeParse({ ...baseValid, JWT_SECRET: 'short_secret' }).success,
    ).toBe(false);

    const noCookie = { ...baseValid } as any;
    delete noCookie.COOKIE_SECRET;
    expect(EnvSchema.safeParse(noCookie).success).toBe(false);

    const noLivekitSecret = { ...baseValid } as any;
    delete noLivekitSecret.LIVEKIT_API_SECRET;
    expect(EnvSchema.safeParse(noLivekitSecret).success).toBe(false);
  });

  it('fails when DATABASE_URL is not a valid URL', () => {
    const parsed = EnvSchema.safeParse({
      ...baseValid,
      DATABASE_URL: 'not-a-valid-url',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects known-weak default secrets when NODE_ENV=production', () => {
    const weakProd = EnvSchema.safeParse({
      ...baseValid,
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'RAZORPAY',
      RAZORPAY_KEY_ID: 'rzp_live_123',
      RAZORPAY_KEY_SECRET: 'rzp_live_secret_123',
      RAZORPAY_WEBHOOK_SECRET: 'rzp_live_whsec_123',
      JWT_SECRET: 'medibook-production-jwt-secret-key-32chars-min',
      MINIO_ACCESS_KEY: 'minioadmin',
      LIVEKIT_API_KEY: 'devkey',
    });
    expect(weakProd.success).toBe(false);
    if (!weakProd.success) {
      const paths = weakProd.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('JWT_SECRET');
      expect(paths).toContain('MINIO_ACCESS_KEY');
      expect(paths).toContain('LIVEKIT_API_KEY');
    }
  });
});
