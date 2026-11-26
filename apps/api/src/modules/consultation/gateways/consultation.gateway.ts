import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger, Inject } from '@nestjs/common';
import { Namespace, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { z } from 'zod';
import { JwtPayload, UuidSchema } from '@medibook/shared';
import { ChatService } from '../services/chat.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { RealtimeService } from '../../platform/realtime/realtime.service';
import { env } from '../../../common/config/env.schema';
import { isUserActiveCached } from '../../identity/utils/user-active.util';

@WebSocketGateway({
  namespace: '/consultation',
})
export class ConsultationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(ConsultationGateway.name);

  constructor(
    @Inject(ChatService) private readonly chatService: ChatService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Namespace) {
    this.realtime.registerConsultationServer(server);
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
    this.logger.log(
      `Client connected to consultation namespace: ${user.sub}`,
    );

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
        // Ignore transient check failure
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
      this.logger.log(
        `Client disconnected from consultation namespace: ${user.sub}`,
      );
    }
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { appointmentId: string },
  ) {
    const user = (client as any).user as JwtPayload | undefined;
    if (!user?.sub || !data?.appointmentId) {
      return { error: 'Unauthorized' };
    }

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: data.appointmentId },
      include: { doctor: true },
    });

    if (!appointment) {
      return { error: 'Appointment not found' };
    }

    const isPatient = appointment.patientId === user.sub;
    const isDoctor = appointment.doctor.userId === user.sub;

    if (!isPatient && !isDoctor) {
      this.logger.warn(
        `Unauthorized consultation join_room attempt by ${user.sub} (role: ${user.role}) for ${data.appointmentId}`,
      );
      return { error: 'Forbidden: Not a participant in this consultation' };
    }

    const roomName = `consult:${data.appointmentId}`;
    await client.join(roomName);
    return { joined: roomName };
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: unknown,
  ) {
    const user = (client as any).user as JwtPayload | undefined;
    if (!user?.sub) return { error: 'Unauthorized' };

    const schema = z
      .object({
        appointmentId: UuidSchema,
        content: z.string().max(4000).default(''),
        attachmentUrl: z.string().max(500).optional(),
        attachmentType: z.string().max(100).optional(),
      })
      .refine(
        (val) =>
          (val.content && val.content.trim().length > 0) || !!val.attachmentUrl,
        { message: 'Content or attachmentUrl is required' },
      );

    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || 'Invalid message payload' };
    }

    const validData = parsed.data;

    try {
      const message = await this.chatService.sendMessage({
        appointmentId: validData.appointmentId,
        senderId: user.sub,
        content: validData.content,
        attachmentUrl: validData.attachmentUrl,
        attachmentType: validData.attachmentType,
      });

      const roomName = `consult:${validData.appointmentId}`;
      this.server.to(roomName).emit('new_message', message);

      return { success: true, messageId: message.id, message };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { appointmentId: string; isTyping: boolean },
  ) {
    const user = (client as any).user as JwtPayload | undefined;
    if (!user?.sub || !data?.appointmentId) return;

    const roomName = `consult:${data.appointmentId}`;
    if (!client.rooms.has(roomName)) return;

    client.to(roomName).emit('user_typing', {
      userId: user.sub,
      isTyping: data.isTyping,
    });
  }
}
