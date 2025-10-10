import { Controller, Get, Patch, Param, Query, Post } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly svc: NotificationService) {}

  @Get('admin')
  async listAdmin(@Query('page') page = '1', @Query('limit') limit = '20', @Query('isRead') isRead?: string) {
    const isReadBool = typeof isRead === 'string' ? (isRead.toLowerCase() === 'true' ? true : isRead.toLowerCase() === 'false' ? false : undefined) : undefined;

    return this.svc.listAdmin(Number(page), Number(limit), isReadBool);
  }

  // notifications.controller.ts
  @Get()
  list(@Query('page') page?: string, @Query('limit') limit?: string, @Query('isRead') isRead?: string) {
    const isReadBool = typeof isRead === 'string' ? isRead.toLowerCase() === 'true' : undefined;

    return this.svc.list(page, limit, isReadBool);
  }

  @Get('unread-count')
  unreadCount() {
    return this.svc.unreadCount();
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.svc.markRead(+id);
  }

  @Patch('read-all')
  markAllRead() {
    return this.svc.markAllRead();
  }
}
