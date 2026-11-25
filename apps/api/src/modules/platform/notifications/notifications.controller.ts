import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { JwtAuthGuard } from '../../identity/guards/jwt-auth.guard';
import { CurrentUser } from '../../identity/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtPayload, UuidSchema } from '@medibook/shared';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List in-app notifications for current user' })
  async listMyNotifications(@CurrentUser() user: JwtPayload) {
    return this.prisma.notification.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark an in-app notification as read' })
  async markRead(
    @Param('id', new ZodValidationPipe(UuidSchema)) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const notif = await this.prisma.notification.findUnique({ where: { id } });
    if (!notif) {
      throw new NotFoundException('Notification not found');
    }
    if (notif.userId !== user.sub) {
      throw new ForbiddenException('Not authorized to modify this notification');
    }
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }
}
