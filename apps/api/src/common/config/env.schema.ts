import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().default(7),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  COOKIE_SECRET: z.string().min(16).default('medibook-cookie-secret-key-32chars'),
  CLINIC_TIMEZONE: z.string().default('Asia/Kolkata'),
  // Razorpay
  RAZORPAY_KEY_ID: z.string().default('rzp_test_mock_key'),
  RAZORPAY_KEY_SECRET: z.string().default('rzp_test_mock_secret'),
  RAZORPAY_WEBHOOK_SECRET: z.string().default('webhook_secret_123'),
  PAYMENT_PROVIDER: z.enum(['RAZORPAY', 'STRIPE', 'FAKE']).default('FAKE'),
  // LiveKit
  LIVEKIT_API_KEY: z.string().default('devkey'),
  LIVEKIT_API_SECRET: z.string().default('secret_32_characters_minimum_len'),
  LIVEKIT_URL: z.string().default('http://localhost:7880'),
  // MinIO / S3
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_USE_SSL: z.string().transform((v) => v === 'true').default('false'),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('medibook-records'),
  // SMTP / Mailpit
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // AI Service
  AI_SERVICE_URL: z.string().default('http://localhost:8000'),
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
