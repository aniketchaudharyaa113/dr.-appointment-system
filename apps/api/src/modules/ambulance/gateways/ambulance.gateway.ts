import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Logger, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../platform/database/prisma.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/ambulance',
})
export class AmbulanceGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AmbulanceGateway.name);
  private readonly jwtSecret: string;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    this.jwtSecret = process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_secret_key_12345';
  }

  handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        (client.handshake.headers['authorization'] as string)?.replace('Bearer ', '') ||
        (client.handshake.query?.token as string);

      if (!token) {
        client.disconnect();
        return;
      }

      const decoded = jwt.verify(token, this.jwtSecret) as any;
      (client as any).user = decoded;
      this.logger.log(`Ambulance client connected: ${decoded.userId}`);
    } catch {
      client.disconnect();
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
    const user = (client as any).user;
    if (!user || !data.requestId) return { error: 'Unauthorized' };

    const request = await this.prisma.ambulanceRequest.findUnique({
      where: { id: data.requestId },
      include: { driver: true },
    });

    if (!request) return { error: 'Request not found' };

    const isPatient = request.patientId === user.userId;
    const isDriver = request.driver?.userId === user.userId;

    if (!isPatient && !isDriver && user.role !== 'ADMIN') {
      this.logger.warn(
        `Socket isolation violation attempt by ${user.userId} for request ${data.requestId}`,
      );
      return { error: 'Forbidden: You are not authorized to track this emergency request' };
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
    const user = (client as any).user;
    if (!user || user.role !== 'DRIVER') return { error: 'Unauthorized driver' };

    const roomName = `ambulance:${data.requestId}`;
    client.to(roomName).emit('ambulance_location', {
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
