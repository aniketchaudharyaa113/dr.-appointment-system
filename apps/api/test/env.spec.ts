import { describe, it, expect } from 'vitest';
import { EnvSchema } from '../src/common/config/env.schema';

describe('Environment Schema Validation', () => {
  it('validates a complete and correct configuration', () => {
    const validConfig = {
      NODE_ENV: 'test',
      PORT: '4000',
      DATABASE_URL: 'postgresql://postgres:password@localhost:5432/medibook',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'a_very_long_and_secure_jwt_secret_32_characters_minimum',
    };

    const parsed = EnvSchema.safeParse(validConfig);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.PORT).toBe(4000);
      expect(parsed.data.CLINIC_TIMEZONE).toBe('Asia/Kolkata');
      expect(parsed.data.PAYMENT_PROVIDER).toBe('FAKE');
    }
  });

  it('fails when JWT_SECRET is less than 32 characters', () => {
    const invalidConfig = {
      DATABASE_URL: 'postgresql://postgres:password@localhost:5432/medibook',
      JWT_SECRET: 'short_secret',
    };

    const parsed = EnvSchema.safeParse(invalidConfig);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.JWT_SECRET).toBeDefined();
    }
  });

  it('fails when DATABASE_URL is not a valid URL', () => {
    const invalidConfig = {
      DATABASE_URL: 'not-a-valid-url',
      JWT_SECRET: 'a_very_long_and_secure_jwt_secret_32_characters_minimum',
    };

    const parsed = EnvSchema.safeParse(invalidConfig);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors.DATABASE_URL).toBeDefined();
    }
  });
});
