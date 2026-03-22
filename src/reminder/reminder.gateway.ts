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
		origin: true,
		credentials: true,
	},
})
@Injectable()
export class ReminderGateway implements OnGatewayConnection, OnGatewayDisconnect {
	@WebSocketServer()
	server: Server;

	private readonly logger = new Logger(ReminderGateway.name);
	private connectedUsers = new Map<string, Set<string>>();

	constructor(
		private jwtService: JwtService,
		@InjectRepository(User)
		private userRepo: Repository<User>,
	) { }

	async handleConnection(client: Socket) {
		try {
			const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace('Bearer ', '') || client.handshake.headers?.token;

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

			const current = this.connectedUsers.get(user.id) ?? new Set<string>();
			current.add(client.id);
			this.connectedUsers.set(user.id, current);
			client.join(`user_${user.id}`);

			this.logger.log(`User ${user.id} connected to reminders gateway (socket: ${client.id})`);
		} catch (error) {
			this.logger.error(`Connection error for socket ${client.id}:`, error);
			client.disconnect();
		}
	}

	handleDisconnect(client: Socket) {
		for (const [userId, socketIds] of this.connectedUsers.entries()) {
			if (socketIds.has(client.id)) {
				socketIds.delete(client.id);
				if (!socketIds.size) {
					this.connectedUsers.delete(userId);
					this.logger.log(`User ${userId} disconnected from reminders gateway`);
				}
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
			const socketIds = this.connectedUsers.get(userId);
			if (!socketIds?.size) {
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

			this.server.to(`user_${userId}`).emit('reminder_due', reminderPayload);

 
			this.logger.log(`✅ Sent reminder `);
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
