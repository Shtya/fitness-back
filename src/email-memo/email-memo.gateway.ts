import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
	OnGatewayConnection,
	OnGatewayDisconnect,
	WebSocketGateway,
	WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/global.entity';

@WebSocketGateway({
	namespace: '/email-memo',
	cors: { origin: true, credentials: true },
})
@Injectable()
export class EmailMemoGateway implements OnGatewayConnection, OnGatewayDisconnect {
	private readonly logger = new Logger(EmailMemoGateway.name);

	@WebSocketServer()
	server: Server;

	constructor(
		private readonly jwtService: JwtService,
		@InjectRepository(User)
		private readonly users: Repository<User>,
	) {}

	private extractToken(client: Socket): string | null {
		const authToken = client.handshake.auth?.token;
		const headerAuth = client.handshake.headers?.authorization;
		if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
		if (typeof headerAuth === 'string' && headerAuth.startsWith('Bearer ')) {
			return headerAuth.slice(7).trim();
		}
		return null;
	}

	async handleConnection(client: Socket) {
		const token = this.extractToken(client);
		if (!token) {
			client.disconnect();
			return;
		}
		try {
			const decoded = this.jwtService.verify(token, { secret: process.env.JWT_SECRET });
			const userId = decoded?.id || decoded?.sub;
			if (!userId) {
				client.disconnect();
				return;
			}
			const user = await this.users.findOne({ where: { id: userId } });
			if (!user) {
				client.disconnect();
				return;
			}
			client.data.userId = user.id;
			client.join(`email-memo:user:${user.id}`);
		} catch (error) {
			this.logger.warn(`Email memo socket auth failed: ${String(error)}`);
			client.disconnect();
		}
	}

	handleDisconnect(client: Socket) {
		this.logger.debug(`Email memo socket disconnected: ${client.id}`);
	}

	emitToUser(userId: string, event: string, payload: unknown) {
		this.server?.to(`email-memo:user:${userId}`).emit(event, payload);
	}
}
