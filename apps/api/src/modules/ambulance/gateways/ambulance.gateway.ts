import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger, Inject } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { JwtPayload } from '@medibook/shared';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { RealtimeService } from '../../platform/realtime/realtime.service';
import { env } from '../../../common/config/env.schema';
import { isUserActiveCached } from '../../identity/utils/user-active.util';

@WebSocketGateway({
  namespace: '/ambulance',
})
export class AmbulanceGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(AmbulanceGateway.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Namespace) {
    this.realtime.registerAmbulanceServer(server);
    server.use(async (client: Socket, next) => {
      try {
        const token =
          client.handshake.auth?.token ||
          (client.handshake.headers['authorization'] as string)?.replace(
            /^Bearer\s+/i,
            '',
          );

        if (!token) {
          return next(new Error('Unauthorized'));
        }

        const decoded = jwt.verify(token, env.JWT_SECRET, {
          algorithms: ['HS256'],
        }) as JwtPayload;
        if (!decoded?.sub) {
          return next(new Error('Unauthorized'));
        }

        const active = await isUserActiveCached(
          this.prisma,
          this.redis,
          decoded.sub,
        );
        if (!active) {
          return next(new Error('Unauthorized'));
        }

        (client as any).user = decoded;
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  async handleConnection(client: Socket) {
    const user = (client as any).user as (JwtPayload & { exp?: number }) | undefined;
    if (!user?.sub) {
      client.disconnect(true);
      return;
    }
    await client.join(`user:${user.sub}`);
    this.logger.log(`Ambulance client connected: ${user.sub}`);

    // Schedule disconnect upon JWT expiration
    if (user.exp) {
      const msUntilExpiry = user.exp * 1000 - Date.now();
      if (msUntilExpiry <= 0) {
        client.emit('auth_expired', { reason: 'JWT access token expired' });
        client.disconnect(true);
        return;
      }
      (client as any).expiryTimer = setTimeout(() => {
        this.logger.log(`Disconnecting socket ${client.id} for user ${user.sub} due to JWT expiry`);
        client.emit('auth_expired', { reason: 'JWT access token expired' });
        client.disconnect(true);
      }, msUntilExpiry);
    }

    // Periodic re-validation of user active status
    (client as any).activeInterval = setInterval(async () => {
      try {
        const active = await isUserActiveCached(this.prisma, this.redis, user.sub);
        if (!active) {
          this.logger.log(`Disconnecting deactivated user ${user.sub} on socket ${client.id}`);
          client.emit('auth_revoked', { reason: 'Account deactivated' });
          client.disconnect(true);
        }
      } catch {
        // Ignore check failure
      }
    }, 30000);
  }

  handleDisconnect(client: Socket) {
    if ((client as any).expiryTimer) {
      clearTimeout((client as any).expiryTimer);
    }
    if ((client as any).activeInterval) {
      clearInterval((client as any).activeInterval);
    }
    const user = (client as any).user as JwtPayload | undefined;
    if (user?.sub) {
      this.logger.log(`Ambulance client disconnected: ${user.sub}`);
    }
  }

  /**
   * Room join authorization:
   * Guarantees socket isolation. User B can never join or spy on User A's ambulance stream.
   */
  @SubscribeMessage('join_tracking')
  async handleJoinTracking(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { requestId: string },
  ) {
    const user = (client as any).user as JwtPayload | undefined;
    if (!user?.sub || !data?.requestId) return { error: 'Unauthorized' };

    const request = await this.prisma.ambulanceRequest.findUnique({
      where: { id: data.requestId },
      include: { driver: true },
    });

    if (!request) return { error: 'Request not found' };

    const isPatient = request.patientId === user.sub;
    const isDriver = request.driver?.userId === user.sub;

    if (!isPatient && !isDriver && user.role !== 'ADMIN') {
      this.logger.warn(
        `Socket isolation violation attempt by ${user.sub} for request ${data.requestId}`,
      );
      return {
        error:
          'Forbidden: You are not authorized to track this emergency request',
      };
    }

    const roomName = `ambulance:${data.requestId}`;
    await client.join(roomName);
    return { joined: roomName };
  }

  /**
   * Driver streams location; emitted exclusively to room `ambulance:<requestId>`.
   */
  @SubscribeMessage('stream_location')
  async handleStreamLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      requestId: string;
      latitude: number;
      longitude: number;
      bearing?: number;
      speedKmh?: number;
    },
  ) {
    const user = (client as any).user as JwtPayload | undefined;
    if (!user?.sub || user.role !== 'DRIVER') {
      return { error: 'Unauthorized driver' };
    }

    const request = await this.prisma.ambulanceRequest.findUnique({
      where: { id: data.requestId },
      include: { driver: true },
    });

    if (!request || request.driver?.userId !== user.sub) {
      return { error: 'Forbidden: Not the assigned driver for this trip' };
    }

    const roomName = `ambulance:${data.requestId}`;
    this.server.to(roomName).emit('ambulance_location', {
      requestId: data.requestId,
      latitude: data.latitude,
      longitude: data.longitude,
      bearing: data.bearing,
      speedKmh: data.speedKmh,
      timestamp: new Date().toISOString(),
    });

    return { sent: true };
  }
}
