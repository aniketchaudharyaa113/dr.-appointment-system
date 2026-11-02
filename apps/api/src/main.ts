import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { env } from './common/config/env.schema';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { logger } from './common/logger/pino-logger.service';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: false,
    genReqId: (req: any) => {
      const incomingId = req.headers['x-request-id'] as string;
      return incomingId || randomUUID();
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
  );

  // Security Headers
  await app.register(fastifyHelmet as any, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  // Strict CORS
  await app.register(fastifyCors as any, {
    origin: [env.CORS_ORIGIN, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'x-request-id',
      'idempotency-key',
    ],
  });

  // Cookie Support for Refresh Tokens
  await app.register(fastifyCookie as any, {
    secret: env.COOKIE_SECRET,
  });

  // Global Exception Filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('MediBook Telehealth API')
    .setDescription(
      'Production-quality modular monolith API for MediBook Telehealth Platform',
    )
    .setVersion('2.0.0')
    .addBearerAuth()
    .addTag('Health', 'System liveness and readiness monitoring')
    .addTag('Identity', 'Authentication, registration, and RBAC')
    .addTag('Scheduling', 'Doctors, slots, holds, availability, and waitlists')
    .addTag('Payments', 'Razorpay integration and double-entry ledger')
    .addTag('Consultation', 'Video sessions, LiveKit tokens, and chat')
    .addTag('Ambulance', 'Emergency dispatch and GPS driver tracking')
    .addTag('AI', 'Triage and clinical assistant gateway')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Graceful shutdown hooks
  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST);
  logger.info(
    `🚀 MediBook API running on http://${env.HOST}:${env.PORT} (Docs: http://${env.HOST}:${env.PORT}/api/docs)`,
  );
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start MediBook API');
  process.exit(1);
});
