import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, StartedRedisContainer } from "@testcontainers/redis";
import { Pool } from "pg";
import Redis from "ioredis";
import { runner } from "node-pg-migrate";
import path from "path";
import { setPool, getPool } from "../src/db/pool";
import { setRedisClient } from "../src/cache/redis";

let pgContainer: StartedPostgreSqlContainer | null = null;
let redisContainer: StartedRedisContainer | null = null;
let testPool: Pool | null = null;
let testRedis: Redis | null = null;

export async function startTestEnvironment() {
  process.env.JWT_SECRET = "test-jwt-secret-key-32-characters-minimum";
  process.env.NODE_ENV = "test";

  // 1. Start Postgres Container
  pgContainer = await new PostgreSqlContainer("postgres:16-alpine").start();
  const dbUrl = pgContainer.getConnectionUri();
  process.env.DATABASE_URL = dbUrl;

  testPool = new Pool({ connectionString: dbUrl });
  setPool(testPool);

  // 2. Start Redis Container
  redisContainer = await new RedisContainer("redis:7-alpine").start();
  const redisUrl = redisContainer.getConnectionUrl();
  process.env.REDIS_URL = redisUrl;

  testRedis = new Redis(redisUrl);
  setRedisClient(testRedis);

  // 3. Run node-pg-migrate
  await runner({
    databaseUrl: dbUrl,
    dir: path.resolve(__dirname, "../migrations"),
    direction: "up",
    migrationsTable: "pgmigrations",
    verbose: false,
  });

  return {
    pgContainer,
    redisContainer,
    dbUrl,
    redisUrl,
    pool: testPool,
    redis: testRedis,
  };
}

export async function stopTestEnvironment() {
  if (testRedis) {
    await testRedis.quit();
    testRedis = null;
  }
  setRedisClient(null);

  if (testPool) {
    await testPool.end();
    testPool = null;
  }

  if (redisContainer) {
    await redisContainer.stop();
    redisContainer = null;
  }

  if (pgContainer) {
    await pgContainer.stop();
    pgContainer = null;
  }
}
