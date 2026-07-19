import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
	ConnectedSocket,
	MessageBody,
	OnGatewayConnection,
	OnGatewayDisconnect,
	SubscribeMessage,
	WebSocketGateway,
	WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import { resolveCorsOrigins } from 'common/cors-origins';
import { WhatsAppConversation } from '../entities/whatsapp.entity';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';

@WebSocketGateway({
	namespace: '/whatsapp',
	cors: {
		origin: resolveCorsOrigins(),
		credentials: true,
	},
})
@Injectable()
export class WhatsAppGateway implements OnGatewayConnection, OnGatewayDisconnect {
	private readonly logger = new Logger(WhatsAppGateway.name);

	@WebSocketServer()
	server: Server;

	constructor(
		private readonly jwtService: JwtService,
		private readonly accessService: WhatsAppAccessService,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
	) {}

	private extractToken(client: Socket): string | null {
		const authToken = client.handshake.auth?.token;
		const headerAuth = client.handshake.headers?.authorization;
		const headerToken = client.handshake.headers?.token;
		if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
		if (typeof headerAuth === 'string' && headerAuth.startsWith('Bearer ')) {
			return headerAuth.slice(7).trim();
		}
		if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim();
		return null;
	}

	private async resolveUser(client: Socket): Promise<User | null> {
		if (client.data?.user?.id) return client.data.user as User;

		const token = this.extractToken(client);
		if (!token) return null;

		try {
			const decoded = this.jwtService.verify(token, {
				secret: process.env.JWT_SECRET,
			});
			const userId = decoded?.id || decoded?.sub;
			if (!userId) return null;
			const user = await this.userRepo.findOne({ where: { id: userId } });
			if (!user) return null;
			client.data.user = user;
			return user;
		} catch (error) {
			this.logger.warn(`WhatsApp socket auth failed for ${client.id}: ${String(error)}`);
			return null;
		}
	}

	async handleConnection(client: Socket) {
		const user = await this.resolveUser(client);
		if (!user) {
			client.disconnect();
			return;
		}
		client.join(`whatsapp:user:${user.id}`);
	}

	handleDisconnect(client: Socket) {
		this.logger.debug(`WhatsApp socket disconnected: ${client.id}`);
	}

	@SubscribeMessage('whatsapp:account:watch')
	async watchAccount(
		@ConnectedSocket() client: Socket,
		@MessageBody() accountId: string,
	) {
		const user = await this.resolveUser(client);
		if (!user) {
			client.disconnect();
			return { ok: false, error: 'Unauthorized' };
		}
		if (!accountId) return { ok: false, error: 'Account id is required' };
		await this.accessService.assertAccountPermission(user, accountId, 'canView');
		await client.join(`whatsapp:account:${accountId}`);
		return { ok: true };
	}

	@SubscribeMessage('whatsapp:account:unwatch')
	async unwatchAccount(
		@ConnectedSocket() client: Socket,
		@MessageBody() accountId: string,
	) {
		await client.leave(`whatsapp:account:${accountId}`);
		return { ok: true };
	}

	@SubscribeMessage('whatsapp:conversation:watch')
	async watchConversation(
		@ConnectedSocket() client: Socket,
		@MessageBody() conversationId: string,
	) {
		const user = await this.resolveUser(client);
		if (!user) {
			client.disconnect();
			return { ok: false, error: 'Unauthorized' };
		}
		if (!conversationId) return { ok: false, error: 'Conversation id is required' };
		const conversation = await this.conversationRepo.findOne({
			where: { id: conversationId },
		});
		if (!conversation) return { ok: false, error: 'Conversation not found' };
		const access = await this.accessService.getAccountAccess(user, conversation.accountId);
		const maySeeConversation =
			access.canManage ||
			access.canAssign ||
			conversation.assignedUserId === user.id;
		if (!maySeeConversation) {
			return { ok: false, error: 'Conversation access denied' };
		}
		await client.join(`whatsapp:conversation:${conversationId}`);
		return { ok: true };
	}

	@SubscribeMessage('whatsapp:conversation:unwatch')
	async unwatchConversation(
		@ConnectedSocket() client: Socket,
		@MessageBody() conversationId: string,
	) {
		await client.leave(`whatsapp:conversation:${conversationId}`);
		return { ok: true };
	}

	emitAccountEvent(accountId: string, event: string, payload: any) {
		this.server
			?.to(`whatsapp:account:${accountId}`)
			.emit('whatsapp:event', { accountId, event, payload, at: new Date().toISOString() });
	}

	emitConversationEvent(conversationId: string, event: string, payload: any) {
		this.server
			?.to(`whatsapp:conversation:${conversationId}`)
			.emit('whatsapp:event', {
				conversationId,
				event,
				payload,
				at: new Date().toISOString(),
			});
	}

	emitToUser(userId: string, event: string, payload: any) {
		this.server?.to(`whatsapp:user:${userId}`).emit(event, payload);
	}
}
