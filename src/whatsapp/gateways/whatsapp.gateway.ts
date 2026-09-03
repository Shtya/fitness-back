import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
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
import { WhatsAppAccessService } from '../services/whatsapp-access.service';

/**
 * Who, inside an account's inbox room, is allowed to receive an event about one
 * conversation. Omit it to broadcast to the whole room (events that carry no
 * conversation content, e.g. sync progress or avatar hydration).
 */
export interface ConversationEventScope {
	assignedUserId?: string | null;
	/** Conversations every `canView` member may read, e.g. the email-memo AI chat. */
	shared?: boolean;
}

function resolveWhatsAppGatewayCorsOrigin(): boolean | string | string[] {
	const raw =
		process.env.WHATSAPP_WS_CORS_ORIGIN ||
		process.env.CORS_ORIGIN ||
		process.env.FRONTEND_URL ||
		'';
	const trimmed = String(raw).trim();
	if (!trimmed || trimmed === '*') {
		// Dev default: reflect request origin. Production should set CORS_ORIGIN.
		if (process.env.NODE_ENV === 'production') {
			return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
		}
		return true;
	}
	if (trimmed.includes(',')) {
		return trimmed.split(',').map((part) => part.trim()).filter(Boolean);
	}
	return trimmed;
}

@WebSocketGateway({
	namespace: '/whatsapp',
	cors: {
		origin: resolveWhatsAppGatewayCorsOrigin(),
		credentials: true,
	},
})
@Injectable()
export class WhatsAppGateway implements OnGatewayConnection, OnGatewayDisconnect {
	private readonly logger = new Logger(WhatsAppGateway.name);
	/** userId → live sockets currently in the WhatsApp workspace */
	private readonly presence = new Map<
		string,
		{
			userId: string;
			name: string;
			role: string | null;
			socketIds: Set<string>;
			lastSeenAt: number;
		}
	>();

	@WebSocketServer()
	server: Server;

	constructor(
		private readonly jwtService: JwtService,
		private readonly accessService: WhatsAppAccessService,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
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

	private presenceEntryFromUser(user: User) {
		return {
			userId: String(user.id),
			name: String(user.name || user.email || 'User').trim() || 'User',
			role: user.role ? String(user.role) : null,
			socketIds: new Set<string>(),
			lastSeenAt: Date.now(),
		};
	}

	private listOnlinePresence(maxAgeMs = 15_000) {
		const now = Date.now();
		const items: Array<{
			userId: string;
			name: string;
			role: string | null;
			online: true;
			lastSeenAt: number;
		}> = [];
		for (const entry of this.presence.values()) {
			if (!entry.socketIds.size) continue;
			if (now - entry.lastSeenAt > maxAgeMs) continue;
			items.push({
				userId: entry.userId,
				name: entry.name,
				role: entry.role,
				online: true,
				lastSeenAt: entry.lastSeenAt,
			});
		}
		items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
		return items;
	}

	private broadcastPresence() {
		const items = this.listOnlinePresence();
		this.server?.to('whatsapp:presence').emit('whatsapp:presence', {
			items,
			at: new Date().toISOString(),
		});
	}

	private registerPresence(client: Socket, user: User) {
		const userId = String(user.id);
		let entry = this.presence.get(userId);
		if (!entry) {
			entry = this.presenceEntryFromUser(user);
			this.presence.set(userId, entry);
		} else {
			entry.name = String(user.name || user.email || entry.name).trim() || entry.name;
			entry.role = user.role ? String(user.role) : entry.role;
		}
		entry.socketIds.add(client.id);
		entry.lastSeenAt = Date.now();
		client.data.presenceUserId = userId;
		void client.join('whatsapp:presence');
		this.broadcastPresence();
	}

	private unregisterPresence(client: Socket) {
		const userId = String(client.data?.presenceUserId || client.data?.user?.id || '');
		if (!userId) return;
		const entry = this.presence.get(userId);
		if (!entry) return;
		entry.socketIds.delete(client.id);
		if (!entry.socketIds.size) {
			this.presence.delete(userId);
		} else {
			entry.lastSeenAt = Date.now();
		}
		this.broadcastPresence();
	}

	/** Snapshot for REST polling / initial paint. */
	getOnlinePresence() {
		return {
			items: this.listOnlinePresence(),
			at: new Date().toISOString(),
		};
	}

	async handleConnection(client: Socket) {
		const user = await this.resolveUser(client);
		if (!user) {
			client.disconnect();
			return;
		}
		client.data.accountScopes = {};
		client.join(`whatsapp:user:${user.id}`);
		this.registerPresence(client, user);
	}

	handleDisconnect(client: Socket) {
		this.unregisterPresence(client);
		this.logger.debug(`WhatsApp socket disconnected: ${client.id}`);
	}

	@SubscribeMessage('whatsapp:presence:ping')
	presencePing(@ConnectedSocket() client: Socket) {
		const userId = String(client.data?.presenceUserId || client.data?.user?.id || '');
		const entry = userId ? this.presence.get(userId) : null;
		if (entry && entry.socketIds.has(client.id)) {
			entry.lastSeenAt = Date.now();
		}
		return { ok: true, at: Date.now() };
	}

	@SubscribeMessage('whatsapp:presence:list')
	presenceList() {
		return this.getOnlinePresence();
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
		const access = await this.accessService.getAccountAccess(user, accountId);
		if (!access.canView) {
			throw new ForbiddenException('WhatsApp account permission denied: canView');
		}
		// Recorded before the join so every socket in the room carries a scope.
		// `emitConversationEvent` relies on that invariant to decide who may see a
		// conversation without hitting the database on every inbound message.
		if (!client.data.accountScopes) client.data.accountScopes = {};
		client.data.accountScopes[accountId] = {
			canSeeAll: this.accessService.canSeeAllConversations(user, access),
		};
		await client.join(`whatsapp:account:${accountId}`);
		return { ok: true };
	}

	@SubscribeMessage('whatsapp:account:unwatch')
	async unwatchAccount(
		@ConnectedSocket() client: Socket,
		@MessageBody() accountId: string,
	) {
		if (client.data?.accountScopes) delete client.data.accountScopes[accountId];
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
		// Must mirror the REST visibility rule exactly. A stricter check here left
		// users who can open a chat over HTTP without live message events in it.
		try {
			await this.accessService.assertConversationVisible(user, conversationId);
		} catch {
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

	emitAccountEvent(
		accountId: string,
		event: string,
		payload: any,
		scope?: ConversationEventScope,
	) {
		const packet = { accountId, event, payload, at: new Date().toISOString() };
		const room = `whatsapp:account:${accountId}`;
		if (!scope) {
			this.server?.to(room).emit('whatsapp:event', packet);
			return;
		}
		void this.emitScopedToAccount(room, null, accountId, packet, scope);
	}

	emitConversationEvent(
		conversationId: string,
		event: string,
		payload: any,
		accountId?: string | null,
		scope?: ConversationEventScope,
	) {
		const resolvedAccountId = accountId || payload?.accountId || null;
		const packet = {
			conversationId,
			accountId: resolvedAccountId,
			event,
			payload,
			at: new Date().toISOString(),
		};
		const conversationRoom = `whatsapp:conversation:${conversationId}`;
		if (!resolvedAccountId) {
			this.server?.to(conversationRoom).emit('whatsapp:event', packet);
			return;
		}

		const accountRoom = `whatsapp:account:${resolvedAccountId}`;
		if (!scope) {
			// Passing rooms as an array delivers the packet once even if the client
			// joined both the inbox room and the open-chat room.
			this.server?.to([conversationRoom, accountRoom]).emit('whatsapp:event', packet);
			return;
		}

		// Members of the conversation room already passed `assertConversationVisible`
		// at watch time, so they are always allowed. `except` keeps them out of the
		// scoped fan-out below so nobody receives the packet twice.
		this.server?.to(conversationRoom).emit('whatsapp:event', packet);
		void this.emitScopedToAccount(
			accountRoom,
			conversationRoom,
			resolvedAccountId,
			packet,
			scope,
		);
	}

	/**
	 * Inbox-room delivery filtered by the same rule REST uses
	 * (`WhatsAppAccessService.assertConversationVisible`): a member who cannot see
	 * all conversations only receives events for chats assigned to them. Without
	 * this, `canView`-only staff received full message payloads for conversations
	 * the REST inbox deliberately hides from them.
	 */
	private async emitScopedToAccount(
		accountRoom: string,
		excludeRoom: string | null,
		accountId: string,
		packet: Record<string, unknown>,
		scope: ConversationEventScope,
	) {
		if (!this.server) return;
		try {
			const target = excludeRoom
				? this.server.in(accountRoom).except(excludeRoom)
				: this.server.in(accountRoom);
			const sockets = await target.fetchSockets();
			for (const socket of sockets) {
				if (this.socketMaySeeConversation(socket, accountId, scope)) {
					socket.emit('whatsapp:event', packet);
				}
			}
		} catch (error) {
			this.logger.warn(
				`Scoped WhatsApp fan-out failed for ${accountRoom}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private socketMaySeeConversation(
		socket: { data?: any },
		accountId: string,
		scope: ConversationEventScope,
	) {
		if (scope.shared) return true;
		const entry = socket.data?.accountScopes?.[accountId];
		if (!entry) {
			// Every join goes through `watchAccount`, which records the scope first.
			// Reaching this means a new join path skipped it; drop the packet rather
			// than leak, and make the bug visible.
			this.logger.warn(
				`WhatsApp socket in ${accountId} inbox room has no recorded scope; dropping event`,
			);
			return false;
		}
		if (entry.canSeeAll) return true;
		const userId = socket.data?.user?.id;
		return Boolean(scope.assignedUserId) && String(scope.assignedUserId) === String(userId);
	}

	emitToUser(userId: string, event: string, payload: any) {
		this.server?.to(`whatsapp:user:${userId}`).emit(event, payload);
	}
}
