import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { Notification } from 'entities/global.entity';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: '*', credentials: false },
})
@Injectable()
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: any) {
    this.logger.debug(`Client connected: ${client.id}`);
  }
  handleDisconnect(client: any) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  // Broadcast a new notification to all clients (or filter by audience/user later)
  broadcastNew(notification: Notification) {
    this.server.emit('notification', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      created_at: notification.created_at,
      isRead: notification.isRead,
    });
  }
}
