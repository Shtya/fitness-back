import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationAudience, User } from 'entities/global.entity';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: true, credentials: true },
})
@Injectable()
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationGateway.name);

  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '') ||
        client.handshake.headers?.token;

      if (!token) {
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET!,
      });

      const user = await this.userRepo.findOne({ where: { id: decoded.id } });
      if (!user) {
        client.disconnect();
        return;
      }

      const current = this.connectedUsers.get(user.id) ?? new Set<string>();
      current.add(client.id);
      this.connectedUsers.set(user.id, current);

      client.join(`user_${user.id}`);
      this.logger.log(`User ${user.id} connected to notifications gateway`);
    } catch (error) {
      this.logger.error(`Notification gateway connection error`, error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketIds] of this.connectedUsers.entries()) {
      if (socketIds.has(client.id)) {
        socketIds.delete(client.id);
        if (!socketIds.size) this.connectedUsers.delete(userId);
        break;
      }
    }
  }

  sendToUser(userId: string, notification: Notification) {
    this.server.to(`user_${userId}`).emit('notification', notification);
  }

  broadcastAdmin(notification: Notification) {
    this.server.emit('notification_admin', notification);
  }

  broadcastNew(notification: Notification) {
    if (notification.user?.id) {
      this.sendToUser(notification.user.id, notification);
      return;
    }

    if (notification.audience === NotificationAudience.ADMIN) {
      this.broadcastAdmin(notification);
    }
  }
}