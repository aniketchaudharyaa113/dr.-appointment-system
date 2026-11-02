import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { ChatService } from '../services/chat.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/consultation',
})
export class ConsultationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ConsultationGateway.name);
  private readonly jwtSecret: string;

  constructor(private readonly chatService: ChatService) {
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
      this.logger.log(`Client connected to consultation namespace: ${decoded.userId}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const user = (client as any).user;
    if (user) {
      this.logger.log(`Client disconnected from consultation namespace: ${user.userId}`);
    }
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { appointmentId: string },
  ) {
    const user = (client as any).user;
    if (!user || !data.appointmentId) return { error: 'Unauthorized' };

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
    const user = (client as any).user;
    if (!user) return { error: 'Unauthorized' };

    try {
      const message = await this.chatService.sendMessage({
        appointmentId: data.appointmentId,
        senderId: user.userId,
        content: data.content,
        attachmentUrl: data.attachmentUrl,
        attachmentType: data.attachmentType,
      });

      const roomName = `consult:${data.appointmentId}`;
      this.server.to(roomName).emit('new_message', message);

      return { success: true, messageId: message.id };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { appointmentId: string; isTyping: boolean },
  ) {
    const user = (client as any).user;
    if (!user) return;

    const roomName = `consult:${data.appointmentId}`;
    client.to(roomName).emit('user_typing', {
      userId: user.userId,
      isTyping: data.isTyping,
    });
  }
}
