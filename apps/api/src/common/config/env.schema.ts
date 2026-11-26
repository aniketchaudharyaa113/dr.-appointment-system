import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(4000),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().default('15m'),
    REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().default(7),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    COOKIE_SECRET: z.string().min(16, 'COOKIE_SECRET must be at least 16 characters'),
    CLINIC_TIMEZONE: z.string().default('Asia/Kolkata'),
    // Payments (fail-fast: no hardcoded secret defaults)
    PAYMENT_PROVIDER: z.enum(['RAZORPAY', 'STRIPE', 'FAKE']).default('FAKE'),
    PAYMENT_WEBHOOK_SECRET: z.string().min(8).optional(),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().min(8).optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(8).optional(),
    // LiveKit (no hardcoded secret defaults)
    LIVEKIT_API_KEY: z.string().min(3, 'LIVEKIT_API_KEY is required'),
    LIVEKIT_API_SECRET: z.string().min(16, 'LIVEKIT_API_SECRET must be at least 16 characters'),
    LIVEKIT_URL: z.string().default('ws://localhost:7880'),
    // MinIO / S3 (no hardcoded secret defaults)
    MINIO_ENDPOINT: z.string().default('localhost'),
    MINIO_PORT: z.coerce.number().default(9000),
    MINIO_USE_SSL: z
      .string()
      .transform((v) => v === 'true')
      .default('false'),
    MINIO_ACCESS_KEY: z.string().min(3, 'MINIO_ACCESS_KEY is required'),
    MINIO_SECRET_KEY: z.string().min(3, 'MINIO_SECRET_KEY is required'),
    MINIO_BUCKET: z.string().default('medibook-records'),
    MINIO_PUBLIC_URL: z.string().optional(),
    // SMTP / Mailpit
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    // AI Service
    AI_SERVICE_URL: z.string().default('http://localhost:8000'),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      if (data.PAYMENT_PROVIDER === 'FAKE') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PAYMENT_PROVIDER'],
          message: 'PAYMENT_PROVIDER=FAKE is forbidden when NODE_ENV=production',
        });
      }

      const weakSecrets: Array<[keyof typeof data, string[]]> = [
        ['JWT_SECRET', ['medibook-production-jwt-secret-key-32chars-min', 'changeme']],
        ['COOKIE_SECRET', ['medibook-super-secure-cookie-secret-32-chars', 'changeme']],
        ['LIVEKIT_API_KEY', ['devkey']],
        ['LIVEKIT_API_SECRET', ['secret_32_characters_minimum_len', 'secret']],
        ['MINIO_ACCESS_KEY', ['minioadmin']],
        ['MINIO_SECRET_KEY', ['minioadmin']],
        ['RAZORPAY_WEBHOOK_SECRET', ['webhook_secret_123']],
        ['PAYMENT_WEBHOOK_SECRET', ['fake_webhook_secret_for_testing_123', 'dev_webhook_secret_key_for_hmac_verification']],
      ];

      for (const [key, forbidden] of weakSecrets) {
        const val = data[key];
        if (typeof val === 'string' && forbidden.includes(val)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${String(key)} must not use a known weak/default value in production`,
          });
        }
      }
    }
    if (data.PAYMENT_PROVIDER === 'FAKE' && !data.PAYMENT_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_WEBHOOK_SECRET'],
        message: 'PAYMENT_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=FAKE',
      });
    }
    if (
      data.PAYMENT_PROVIDER === 'RAZORPAY' &&
      (!data.RAZORPAY_KEY_ID || !data.RAZORPAY_KEY_SECRET || !data.RAZORPAY_WEBHOOK_SECRET)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RAZORPAY_WEBHOOK_SECRET'],
        message: 'RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET are required',
      });
    }
  });

export type EnvConfig = z.infer<typeof EnvSchema>;

export function validateEnv(): EnvConfig {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.format();
    console.error('❌ Environment validation failed:', JSON.stringify(errors, null, 2));
    throw new Error('Invalid environment configuration');
  }
  return result.data;
}

export const env = validateEnv();
