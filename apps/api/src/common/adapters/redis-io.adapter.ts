import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';
import { env } from '../config/env.schema';
import { logger } from '../logger/pino-logger.service';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(appOrHttpServer: INestApplicationContext) {
    super(appOrHttpServer);
  }

  async connectToRedis(): Promise<void> {
    this.pubClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.subClient = this.pubClient.duplicate();

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        this.pubClient!.once('ready', resolve);
        this.pubClient!.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        this.subClient!.once('ready', resolve);
        this.subClient!.once('error', reject);
      }),
    ]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    logger.info('Socket.IO Redis adapter connected');
  }

  override createIOServer(port: number, options?: ServerOptions): any {
    const allowedOrigins = env.CORS_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: allowedOrigins,
        credentials: true,
        methods: ['GET', 'POST'],
      },
    });

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.pubClient?.quit(),
      this.subClient?.quit(),
    ]);
  }
}
