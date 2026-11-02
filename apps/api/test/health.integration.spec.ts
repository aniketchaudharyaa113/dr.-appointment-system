import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { HealthController } from '../src/modules/platform/health/health.controller';
import { PrismaService } from '../src/modules/platform/database/prisma.service';
import { RedisService } from '../src/modules/platform/redis/redis.service';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';

describe('Health Endpoints (Integration)', () => {
  let app: NestFastifyApplication;
  const mockPrisma = {
    $queryRaw: async () => [{ '?column?': 1 }],
  };
  const mockRedis = {
    ping: async () => true,
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live returns 200 OK with liveness metrics', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('uptime');
  });

  it('GET /health/ready returns 200 OK when DB and Redis are healthy', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.db).toBe(true);
    expect(body.redis).toBe(true);
  });

  it('GET /health/ready returns 503 Service Unavailable when DB fails', async () => {
    mockPrisma.$queryRaw = async () => {
      throw new Error('Database connection failed');
    };

    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('degraded');
    expect(body.db).toBe(false);

    // restore
    mockPrisma.$queryRaw = async () => [{ '?column?': 1 }];
  });
});
