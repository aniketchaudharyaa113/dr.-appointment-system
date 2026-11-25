import { env } from './common/config/env.schema';
import { logger } from './common/logger/pino-logger.service';
import { createConfiguredApp } from './common/app.bootstrap';

async function bootstrap() {
  const app = await createConfiguredApp();

  await app.listen(env.PORT, env.HOST);
  logger.info(
    `🚀 MediBook API running on http://${env.HOST}:${env.PORT}/api (Docs: http://${env.HOST}:${env.PORT}/api/docs)`,
  );
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start MediBook API');
  process.exit(1);
});
