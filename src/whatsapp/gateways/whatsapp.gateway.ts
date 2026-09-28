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
import { corsOriginDelegate } from 'common/cors-origin';
import { User, UserRole } from '../../../entities/global.entity';
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

/** Every inbox watcher of the account (unscoped events). */
export const accountRoom = (accountId: string) => `whatsapp:account:${accountId}`;
/** Inbox watchers allowed to see every conversation of the account. */
export const accountAllRoom = (accountId: string) => `whatsapp:account:${accountId}:all`;
/** Inbox watchers limited to conversations assigned to `userId`. */
export const accountAssigneeRoom = (accountId: string, userId: string) =>
	`whatsapp:account:${accountId}:assigned:${userId}`;

export function scopeRooms(accountId: string, scope: ConversationEventScope): string[] {
	if (scope.shared) return [accountRoom(accountId)];
	const rooms = [accountAllRoom(accountId)];
	if (scope.assignedUserId) rooms.push(accountAssigneeRoom(accountId, String(scope.assignedUserId)));
	return rooms;
}

/** setTimeout overflows above 2^31-1 ms (~24.8 days). */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

@WebSocketGateway({
	namespace: '/whatsapp',
	cors: {
		origin: corsOriginDelegate('WHATSAPP_WS_CORS_ORIGIN'),
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

	private readonly tokenExpiryTimers = new Map<string, NodeJS.Timeout>();

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

	private isTokenExpired(client: Socket) {
		const expiresAt = client.data?.tokenExpiresAt;
		return typeof expiresAt === 'number' && Date.now() >= expiresAt;
	}

	/** Disconnect the socket when its JWT expires; the client reconnects with a refreshed token. */
	private scheduleTokenExpiry(client: Socket) {
		this.clearTokenExpiry(client);
		const expiresAt = client.data?.tokenExpiresAt;
		if (typeof expiresAt !== 'number') return;
		const delay = Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMER_DELAY_MS);
		const timer = setTimeout(() => {
			this.tokenExpiryTimers.delete(client.id);
			if (!this.isTokenExpired(client)) {
				this.scheduleTokenExpiry(client);
				return;
			}
			client.emit('whatsapp:auth_expired');
			client.disconnect(true);
		}, delay);
		timer.unref?.();
		this.tokenExpiryTimers.set(client.id, timer);
	}

	private clearTokenExpiry(client: Socket) {
		const timer = this.tokenExpiryTimers.get(client.id);
		if (timer) clearTimeout(timer);
		this.tokenExpiryTimers.delete(client.id);
	}

	private async resolveUser(client: Socket): Promise<User | null> {
		if (client.data?.user?.id) {
			return this.isTokenExpired(client) ? null : (client.data.user as User);
		}

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
			client.data.tokenExpiresAt =
				typeof decoded?.exp === 'number' ? decoded.exp * 1000 : null;
			return user;
		} catch (error) {
			this.logger.warn(`WhatsApp socket auth failed for ${client.id}: ${String(error)}`);
			return null;
		}
	}

	/** Staff names, roles, and online times are visible to admins only. */
	private canSeeStaffPresence(user?: User | null) {
		return user?.role === UserRole.ADMIN || user?.role === UserRole.SUPER_ADMIN;
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
		if (this.canSeeStaffPresence(user)) void client.join('whatsapp:presence');
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
		this.scheduleTokenExpiry(client);
	}

	handleDisconnect(client: Socket) {
		this.clearTokenExpiry(client);
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
	async presenceList(@ConnectedSocket() client: Socket) {
		const user = await this.resolveUser(client);
		if (!this.canSeeStaffPresence(user)) {
			return { items: [], at: new Date().toISOString(), forbidden: true };
		}
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
		// Scope is recorded and mapped to a sub-room at watch time, so scoped events
		// are routed by room membership (no per-event fetchSockets / DB lookups).
		if (!client.data.accountScopes) client.data.accountScopes = {};
		const canSeeAll = this.accessService.canSeeAllConversations(user, access);
		const scopeRoom = canSeeAll
			? accountAllRoom(accountId)
			: accountAssigneeRoom(accountId, String(user.id));
		const previousRoom = client.data.accountScopes[accountId]?.room;
		client.data.accountScopes[accountId] = { canSeeAll, room: scopeRoom };
		if (previousRoom && previousRoom !== scopeRoom) await client.leave(previousRoom);
		await client.join([accountRoom(accountId), scopeRoom]);
		return { ok: true };
	}

	@SubscribeMessage('whatsapp:account:unwatch')
	async unwatchAccount(
		@ConnectedSocket() client: Socket,
		@MessageBody() accountId: string,
	) {
		const scopeRoom = client.data?.accountScopes?.[accountId]?.room;
		if (client.data?.accountScopes) delete client.data.accountScopes[accountId];
		await client.leave(accountRoom(accountId));
		if (scopeRoom) await client.leave(scopeRoom);
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
		if (!scope) {
			this.server?.to(accountRoom(accountId)).emit('whatsapp:event', packet);
			return;
		}
		this.server?.to(scopeRooms(accountId, scope)).emit('whatsapp:event', packet);
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

		// Passing rooms as an array delivers the packet once even if the client
		// joined several of them (open-chat room + inbox rooms).
		if (!scope) {
			this.server
				?.to([conversationRoom, accountRoom(resolvedAccountId)])
				.emit('whatsapp:event', packet);
			return;
		}
		// Conversation-room members already passed `assertConversationVisible` at
		// watch time. Inbox members get it by the same rule REST uses: canSeeAll
		// members always, restricted members only for chats assigned to them.
		this.server
			?.to([conversationRoom, ...scopeRooms(resolvedAccountId, scope)])
			.emit('whatsapp:event', packet);
	}

	/**
	 * Account-wide snapshot whose items each belong to one conversation (e.g.
	 * online contacts). Members who cannot see all conversations only receive
	 * the items of chats assigned to them; assignees are resolved only when such
	 * a member is in the room.
	 */
	async emitAccountSnapshotScoped<T extends { conversationId: string }>(
		accountId: string,
		event: string,
		snapshot: { items: T[] } & Record<string, unknown>,
		resolveAssignees: (conversationIds: string[]) => Promise<Map<string, string | null>>,
	) {
		if (!this.server) return;
		const room = accountRoom(accountId);
		const at = new Date().toISOString();
		try {
			this.server
				.to(accountAllRoom(accountId))
				.emit('whatsapp:event', { accountId, event, payload: snapshot, at });
			const sockets = await this.server.in(room).except(accountAllRoom(accountId)).fetchSockets();
			const restricted = sockets.filter((socket) => {
				const entry = socket.data?.accountScopes?.[accountId];
				return Boolean(entry) && !entry.canSeeAll;
			});
			if (!restricted.length) return;
			const assignees = await resolveAssignees(snapshot.items.map((item) => item.conversationId));
			for (const socket of restricted) {
				const userId = String(socket.data?.user?.id || '');
				const items = snapshot.items.filter(
					(item) => Boolean(userId) && assignees.get(String(item.conversationId)) === userId,
				);
				socket.emit('whatsapp:event', {
					accountId,
					event,
					payload: { ...snapshot, items },
					at,
				});
			}
		} catch (error) {
			this.logger.warn(
				`Scoped WhatsApp snapshot fan-out failed for ${room}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	emitToUser(userId: string, event: string, payload: any) {
		this.server?.to(`whatsapp:user:${userId}`).emit(event, payload);
	}
}
