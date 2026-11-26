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
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        (client.handshake.headers['authorization'] as string)?.replace(
          /^Bearer\s+/i,
          '',
        ) ||
        (client.handshake.query?.token as string);

      if (!token) {
        client.disconnect(true);
        return;
      }

      const decoded = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
      }) as JwtPayload;
      if (!decoded?.sub) {
        client.disconnect(true);
        return;
      }
      const active = await isUserActiveCached(this.prisma, this.redis, decoded.sub);
      if (!active) {
        client.disconnect(true);
        return;
      }

      (client as any).user = decoded;
      await client.join(`user:${decoded.sub}`);
      this.logger.log(`Ambulance client connected: ${decoded.sub}`);
    } catch {
      client.disconnect(true);
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
