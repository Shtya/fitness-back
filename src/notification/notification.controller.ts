 
// notification/notification.controller.ts (updated)
import { Controller, Get, Patch, Param, Query, Post, Request, UseGuards } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'common/guards/roles.guard';
import { UserRole } from 'entities/global.entity';
import { Roles } from 'common/decorators/roles.decorator';
 
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationController {
  constructor(private readonly svc: NotificationService) {}

  @Get('admin')
  @Roles(UserRole.ADMIN)
  async listAdmin(
    @Query('page') page = '1', 
    @Query('limit') limit = '20', 
    @Query('isRead') isRead?: string
  ) {
    const isReadBool = typeof isRead === 'string' ? 
      (isRead.toLowerCase() === 'true' ? true : isRead.toLowerCase() === 'false' ? false : undefined) : 
      undefined;

    return this.svc.listAdmin(Number(page), Number(limit), isReadBool);
  }

  @Get()
  async list(
    @Request() req,
    @Query('page') page?: string, 
    @Query('limit') limit?: string, 
    @Query('isRead') isRead?: string
  ) {
    const isReadBool = typeof isRead === 'string' ? 
      isRead.toLowerCase() === 'true' : 
      undefined;

    // For clients, only show their own notifications
    // For coaches/admins, they can see admin notifications + their own
    const userId = req.user.role === UserRole.CLIENT ? req.user.id : undefined;

    return this.svc.list(page, limit, isReadBool, userId);
  }

  @Get('unread-count')
  async unreadCount(@Request() req) {
    const userId = req.user.role === UserRole.CLIENT ? req.user.id : undefined;
    return this.svc.unreadCount(userId);
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string) {
    return this.svc.markRead(+id);
  }

  @Patch('read-all')
  async markAllRead(@Request() req) {
    const userId = req.user.role === UserRole.CLIENT ? req.user.id : undefined;
    return this.svc.markAllRead(userId);
  }
}