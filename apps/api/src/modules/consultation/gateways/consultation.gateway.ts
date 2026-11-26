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
import { JwtPayload } from '@medibook/shared';
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
          ) ||
          (client.handshake.query?.token as string);

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
    const user = (client as any).user as JwtPayload | undefined;
    if (!user?.sub) {
      client.disconnect(true);
      return;
    }
    await client.join(`user:${user.sub}`);
    this.logger.log(
      `Client connected to consultation namespace: ${user.sub}`,
    );
  }

  handleDisconnect(client: Socket) {
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
    const isAdmin = user.role === 'ADMIN';

    if (!isPatient && !isDoctor && !isAdmin) {
      this.logger.warn(
        `Unauthorized consultation join_room attempt by ${user.sub} for ${data.appointmentId}`,
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
    data: {
      appointmentId: string;
      content: string;
      attachmentUrl?: string;
      attachmentType?: string;
    },
  ) {
    const user = (client as any).user as JwtPayload | undefined;
    if (!user?.sub) return { error: 'Unauthorized' };

    try {
      const message = await this.chatService.sendMessage({
        appointmentId: data.appointmentId,
        senderId: user.sub,
        content: data.content,
        attachmentUrl: data.attachmentUrl,
        attachmentType: data.attachmentType,
      });

      const roomName = `consult:${data.appointmentId}`;
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
