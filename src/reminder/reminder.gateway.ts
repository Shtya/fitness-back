// src/reminder/reminder.gateway.ts
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'entities/global.entity';

@WebSocketGateway({
  namespace: '/reminders',
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
@Injectable()
export class ReminderGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ReminderGateway.name);
  private connectedUsers = new Map<string, string>(); // userId -> socketId

  constructor(
    private jwtService: JwtService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      // Try multiple ways to get the token
      const token = 
        client.handshake.auth?.token || 
        client.handshake.headers?.authorization?.replace('Bearer ', '') ||
        client.handshake.headers?.token;
      
      if (!token) {
        this.logger.warn(`Connection rejected: No token provided for socket ${client.id}`);
        client.disconnect();
        return;
      }

      const decoded = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET!,
      });

      const user = await this.userRepo.findOne({ where: { id: decoded.id } });
      if (!user) {
        this.logger.warn(`Connection rejected: User not found for socket ${client.id}`);
        client.disconnect();
        return;
      }

      this.connectedUsers.set(user.id, client.id);
      client.join(`user_${user.id}`);
      
      this.logger.log(`User ${user.id} connected to reminders gateway (socket: ${client.id})`);
    } catch (error) {
      this.logger.error(`Connection error for socket ${client.id}:`, error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.connectedUsers.delete(userId);
        this.logger.log(`User ${userId} disconnected from reminders gateway`);
        break;
      }
    }
  }

  /**
   * Send reminder notification to a specific user via WebSocket
   * This is called when a reminder is due and the user has an active WebSocket connection
   */
  sendReminderToUser(userId: string, reminder: any) {
    try {
      const socketId = this.connectedUsers.get(userId);
      if (!socketId) {
        this.logger.debug(`User ${userId} not connected, cannot send WebSocket reminder`);
        return false;
      }

      const reminderPayload = {
        id: reminder.id,
        title: reminder.title || 'Reminder',
        notes: reminder.description || reminder.notes || '',
        sound: reminder.soundSettings || reminder.sound || { id: 'chime', volume: 0.8 },
        schedule: reminder.schedule || {},
        type: reminder.type || 'custom',
        priority: reminder.priority || 'normal',
        timestamp: new Date().toISOString(),
      };

      // إرسال إلى room المستخدم
      this.server.to(`user_${userId}`).emit('reminder_due', reminderPayload);
      
      // أيضاً إرسال مباشر إلى socket المحدد (للتأكد)
      const client = this.server.sockets.sockets.get(socketId);
      if (client) {
        client.emit('reminder_due', reminderPayload);
      }

      this.logger.log(`✅ Sent reminder ${reminder.id} to user ${userId} via WebSocket (socket: ${socketId})`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error sending reminder ${reminder.id} to user ${userId} via WebSocket:`, error);
      return false;
    }
  }

  /**
   * Check if a user is currently connected
   */
  isUserConnected(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }
}

