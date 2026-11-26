import { GenericContainer, Wait } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';

let pgContainer: any;
let redisContainer: any;

export async function setup() {
  // Required for GitHub Actions CI where Ryuk (Testcontainers cleanup daemon) is unavailable
  process.env.TESTCONTAINERS_RYUK_DISABLED = process.env.TESTCONTAINERS_RYUK_DISABLED || 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || 'test-super-secret-jwt-key-32-chars-minimum!';
  process.env.COOKIE_SECRET =
    process.env.COOKIE_SECRET || 'test-super-secret-cookie-key-32chars!';
  process.env.PAYMENT_PROVIDER = 'FAKE';
  process.env.PAYMENT_WEBHOOK_SECRET =
    process.env.PAYMENT_WEBHOOK_SECRET || 'fake_webhook_secret_for_testing_123';
  process.env.RAZORPAY_WEBHOOK_SECRET =
    process.env.RAZORPAY_WEBHOOK_SECRET || 'webhook_secret_123';
  process.env.LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
  process.env.LIVEKIT_API_SECRET =
    process.env.LIVEKIT_API_SECRET || 'test_livekit_secret_32_characters_min';
  process.env.LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
  process.env.MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
  process.env.MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
  process.env.MINIO_BUCKET = process.env.MINIO_BUCKET || 'medibook-records';
  process.env.CLINIC_TIMEZONE = 'Asia/Kolkata';
  process.env.ENABLE_DEV_ENDPOINTS = 'true';

  console.log('🐳 Starting Testcontainers (pgvector/pgvector:pg16 + redis:7-alpine)...');

  pgContainer = await new GenericContainer('pgvector/pgvector:pg16')
    .withEnvironment({
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: 'postgrespassword',
      POSTGRES_DB: 'medibook_test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  const dbHost = pgContainer.getHost();
  const dbPort = pgContainer.getMappedPort(5432);
  const databaseUrl = `postgresql://postgres:postgrespassword@${dbHost}:${dbPort}/medibook_test?schema=public`;

  const redisHost = redisContainer.getHost();
  const redisPort = redisContainer.getMappedPort(6379);
  const redisUrl = `redis://${redisHost}:${redisPort}`;

  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;

  const apiRoot = path.resolve(__dirname, '../..');
  console.log('📦 Running Prisma migrations against Testcontainer Postgres...');
  execSync('npx prisma migrate deploy', {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  console.log(`✅ Testcontainers ready: Postgres=${dbHost}:${dbPort}, Redis=${redisHost}:${redisPort}`);
}

export async function teardown() {
  console.log('🧹 Stopping Testcontainers...');
  if (pgContainer) {
    await pgContainer.stop();
  }
  if (redisContainer) {
    await redisContainer.stop();
  }
}
