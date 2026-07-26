import {
	Injectable,
	Logger,
	OnApplicationBootstrap,
	OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import {
	NotificationAudience,
	NotificationType,
} from '../../../entities/global.entity';
import { NotificationService } from '../../notification/notification.service';
import { RedisService } from '../../redis/redis.service';
import {
	WhatsAppAccount,
	WhatsAppAccountAccess,
	WhatsAppAccountStatus,
	WhatsAppConnectionLog,
	WhatsAppMessage,
	WhatsAppMessageStatus,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import { WhatsAppProvider, WhatsAppProviderEvent } from '../providers/whatsapp-provider';
import { WppConnectProvider } from '../providers/wppconnect.provider';
import { WhatsAppSessionService } from './whatsapp-session.service';

@Injectable()
export class WhatsAppProviderManagerService
	implements OnApplicationBootstrap, OnApplicationShutdown
{
	private readonly logger = new Logger(WhatsAppProviderManagerService.name);
	private readonly providers = new Map<string, WhatsAppProvider>();
	private readonly connecting = new Map<string, Promise<WhatsAppProvider>>();
	private readonly connectStartedAt = new Map<string, number>();
	private readonly listeners = new Set<
		(accountId: string, event: WhatsAppProviderEvent) => void | Promise<void>
	>();

	// Distributed lock so at most one backend process/instance ever holds a live
	// Puppeteer/WhatsApp session for a given account — running more than one
	// simultaneously looks like multi-device abuse to WhatsApp and risks a ban.
	private readonly instanceId = randomUUID();
	private readonly lockTtlSeconds = 45;
	private readonly lockRenewTimers = new Map<string, NodeJS.Timeout>();
	private redisUnavailableWarned = false;

	constructor(
		@InjectRepository(WhatsAppAccount)
		private readonly accountRepo: Repository<WhatsAppAccount>,
		@InjectRepository(WhatsAppConnectionLog)
		private readonly logRepo: Repository<WhatsAppConnectionLog>,
		@InjectRepository(WhatsAppAccountAccess)
		private readonly accessRepo: Repository<WhatsAppAccountAccess>,
		@InjectRepository(WhatsAppMessage)
		private readonly messageRepo: Repository<WhatsAppMessage>,
		private readonly sessions: WhatsAppSessionService,
		private readonly gateway: WhatsAppGateway,
		private readonly notifications: NotificationService,
		private readonly redis: RedisService,
	) {}

	private lockKey(accountId: string) {
		return `whatsapp:conn-lock:${accountId}`;
	}

	private warnRedisUnavailableOnce() {
		if (this.redisUnavailableWarned) return;
		this.redisUnavailableWarned = true;
		this.logger.warn(
			'Redis unavailable — WhatsApp connection locks disabled; allowing connect/disconnect without distributed locks',
		);
	}

	private async acquireLock(accountId: string): Promise<boolean> {
		if (!(await this.redis.isAvailable())) {
			this.warnRedisUnavailableOnce();
			return true;
		}
		try {
			const client = this.redis.getClient();
			const key = this.lockKey(accountId);
			const result = await client.set(key, this.instanceId, {
				NX: true,
				EX: this.lockTtlSeconds,
			});
			if (result === 'OK') return true;
			// Already ours (e.g. reconnecting before the renewal tick caught up)?
			const current = await client.get(key);
			return current === this.instanceId;
		} catch (error) {
			// Redis being unreachable must not block WhatsApp entirely on a
			// single-instance deployment — fail open, but log loudly.
			this.logger.error(
				`Could not acquire WhatsApp connection lock for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return true;
		}
	}

	private async releaseLock(accountId: string) {
		if (!(await this.redis.isAvailable())) {
			this.warnRedisUnavailableOnce();
			return;
		}
		try {
			const client = this.redis.getClient();
			const key = this.lockKey(accountId);
			const current = await client.get(key);
			if (current === this.instanceId) {
				await client.del(key);
			}
		} catch (error) {
			this.logger.warn(
				`Could not release WhatsApp connection lock for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	/** Always delete the lock — used for user-initiated disconnect/reconnect recovery. */
	private async forceReleaseLock(accountId: string) {
		if (!(await this.redis.isAvailable())) {
			this.warnRedisUnavailableOnce();
			return;
		}
		try {
			await this.redis.getClient().del(this.lockKey(accountId));
		} catch (error) {
			this.logger.warn(
				`Could not force-release WhatsApp connection lock for ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	private startLockRenewal(accountId: string) {
		this.stopLockRenewal(accountId);
		const timer = setInterval(async () => {
			if (!(await this.redis.isAvailable())) {
				this.warnRedisUnavailableOnce();
				return;
			}
			try {
				const client = this.redis.getClient();
				const key = this.lockKey(accountId);
				const current = await client.get(key);
				if (current === this.instanceId) {
					await client.expire(key, this.lockTtlSeconds);
				}
			} catch (error) {
				this.logger.warn(
					`Could not renew WhatsApp connection lock for ${accountId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		}, Math.floor((this.lockTtlSeconds * 1000) / 3));
		timer.unref?.();
		this.lockRenewTimers.set(accountId, timer);
	}

	private stopLockRenewal(accountId: string) {
		const timer = this.lockRenewTimers.get(accountId);
		if (timer) clearInterval(timer);
		this.lockRenewTimers.delete(accountId);
	}

	onProviderEvent(
		listener: (accountId: string, event: WhatsAppProviderEvent) => void | Promise<void>,
	) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getProvider(accountId: string) {
		return this.providers.get(accountId) || null;
	}

	async connect(accountId: string, phoneNumber?: string) {
		const pending = this.connecting.get(accountId);
		if (pending) return pending;

		const active = this.providers.get(accountId);
		if (active?.getState() === 'connected') {
			return active;
		}

		const stuckMs = Math.min(
			Math.max(Number(process.env.WHATSAPP_CONNECT_STUCK_MS) || 90_000, 15_000),
			10 * 60 * 1000,
		);
		const startedAt = this.connectStartedAt.get(accountId) || 0;
		const isInFlight = active && ['connecting', 'qr_pending'].includes(active.getState());
		const isStuck = isInFlight && Date.now() - startedAt > stuckMs;
		const isBroken = active && active.getState() === 'error';

		// Reuse an in-flight browser session instead of starting a second Chromium,
		// unless the caller is switching modes, the session is stuck, or it failed.
		if (isInFlight && !phoneNumber && !isStuck) {
			return active;
		}
		if (active && (phoneNumber || isStuck || isBroken || isInFlight)) {
			this.providers.delete(accountId);
			this.connectStartedAt.delete(accountId);
			await active.disconnect().catch(() => undefined);
			this.stopLockRenewal(accountId);
			await this.releaseLock(accountId).catch(() => undefined);
		}

		const promise = this.connectExclusive(accountId, phoneNumber);
		this.connecting.set(accountId, promise);
		try {
			return await promise;
		} finally {
			this.connecting.delete(accountId);
		}
	}

	private async connectExclusive(accountId: string, phoneNumber?: string) {
		let locked = await this.acquireLock(accountId);
		if (!locked) {
			// Stale/foreign locks are common after overlapping local backends or a
			// shared Redis with another environment. User-initiated connect should
			// reclaim ownership instead of staying blocked forever.
			this.logger.warn(
				`Reclaiming WhatsApp connection lock for ${accountId} from another instance`,
			);
			this.stopLockRenewal(accountId);
			await this.forceReleaseLock(accountId);
			locked = await this.acquireLock(accountId);
		}
		if (!locked) {
			throw new Error(
				'This WhatsApp account is already being managed by another server instance. Try again shortly.',
			);
		}
		const account = await this.accountRepo.findOneByOrFail({ id: accountId });
		// Keep CONNECTED in the DB while we restore the in-memory browser session.
		if (account.status !== WhatsAppAccountStatus.CONNECTED) {
			await this.accountRepo.update(accountId, {
				status: WhatsAppAccountStatus.CONNECTING,
				lastError: null,
			});
		}
		const provider = this.createProvider(account);
		provider.onEvent(event => this.handleEvent(accountId, event));
		this.providers.set(accountId, provider);
		this.connectStartedAt.set(accountId, Date.now());
		try {
			await provider.connect(phoneNumber);
			this.startLockRenewal(accountId);
			await this.log(accountId, 'connect_started', 'WhatsApp provider started');
			return provider;
		} catch (error) {
			this.providers.delete(accountId);
			this.connectStartedAt.delete(accountId);
			this.stopLockRenewal(accountId);
			await this.releaseLock(accountId);
			const message = error instanceof Error ? error.message : String(error);
			await this.accountRepo.update(accountId, {
				status: WhatsAppAccountStatus.ERROR,
				lastError: message,
			});
			await this.log(accountId, 'connection_error', message);
			this.gateway.emitAccountEvent(accountId, 'connection_error', { message });
			throw error;
		}
	}

	private createProvider(account: WhatsAppAccount): WhatsAppProvider {
		if (account.providerName === 'wppconnect') {
			return new WppConnectProvider(
				account.id,
				this.sessions.createWppTokenStore(account.id),
			);
		}
		throw new Error(`Unsupported WhatsApp provider: ${account.providerName}`);
	}

	private async handleEvent(accountId: string, event: WhatsAppProviderEvent) {
		if (event.type === 'connection') {
			const status = event.status as WhatsAppAccountStatus;
			const provider = this.providers.get(accountId);
			if (
				[WhatsAppAccountStatus.QR_PENDING, WhatsAppAccountStatus.CONNECTING].includes(
					status,
				) &&
				provider?.getState() === 'connected'
			) {
				return;
			}
			await this.accountRepo.update(accountId, {
				status,
				phoneNumber: event.phoneNumber || undefined,
				lastConnectedAt: status === WhatsAppAccountStatus.CONNECTED ? new Date() : undefined,
				lastError:
					status === WhatsAppAccountStatus.ERROR
						? event.error || 'WhatsApp connection failed'
						: null,
			});
			if (
				[
					WhatsAppAccountStatus.CONNECTED,
					WhatsAppAccountStatus.DISCONNECTED,
					WhatsAppAccountStatus.ERROR,
				].includes(status)
			) {
				this.connectStartedAt.delete(accountId);
			}
			if (status === WhatsAppAccountStatus.ERROR) {
				// Provider already closed itself; do not call disconnect() or it
				// would emit "disconnected" and overwrite the error status.
				this.providers.delete(accountId);
				this.stopLockRenewal(accountId);
				await this.releaseLock(accountId).catch(() => undefined);
			}
			await this.log(accountId, 'connection_state_changed', event.error || null, {
				status,
			});
			if (
				[
					WhatsAppAccountStatus.CONNECTED,
					WhatsAppAccountStatus.DISCONNECTED,
					WhatsAppAccountStatus.ERROR,
				].includes(status)
			) {
				const recipients = await this.accessRepo.find({
					where: { accountId, canManage: true },
				});
				await Promise.allSettled(
					recipients.map(recipient =>
						this.notifications.create({
							type: NotificationType.WHATSAPP_CONNECTION,
							title: 'WhatsApp connection changed',
							message: `WhatsApp account is now ${status}`,
							data: { accountId, status, type: 'whatsapp_connection' },
							audience: NotificationAudience.USER,
							userId: recipient.userId,
						}),
					),
				);
			}
		}
		if (event.type === 'qr') {
			const provider = this.providers.get(accountId);
			if (provider?.getState() === 'connected') {
				return;
			}
			const account = await this.accountRepo.findOne({ where: { id: accountId } });
			if (account?.status === WhatsAppAccountStatus.CONNECTED) {
				return;
			}
			await this.accountRepo.update(accountId, { status: WhatsAppAccountStatus.QR_PENDING });
			await this.log(accountId, 'qr_updated');
		}
		if (event.type === 'pairing_code') {
			const provider = this.providers.get(accountId);
			if (provider?.getState() === 'connected') {
				return;
			}
			const account = await this.accountRepo.findOne({ where: { id: accountId } });
			if (account?.status === WhatsAppAccountStatus.CONNECTED) {
				return;
			}
			await this.accountRepo.update(accountId, { status: WhatsAppAccountStatus.QR_PENDING });
			await this.log(accountId, 'pairing_code_updated');
		}
		if (event.type === 'message_status') {
			const rank: Record<string, number> = {
				pending: 0,
				sent: 1,
				delivered: 2,
				read: 3,
				played: 4,
				failed: 1,
			};
			const message = await this.messageRepo.findOne({
				where: { accountId, providerMessageId: event.providerMessageId },
			});
			if (
				message &&
				(rank[event.status] ?? -1) >= (rank[message.status] ?? -1)
			) {
				message.status = event.status as WhatsAppMessageStatus;
				message.statusUpdatedAt = new Date();
				await this.messageRepo.save(message);
			}
		}

		// Account rooms are visible to staff with canView. Never broadcast QR codes,
		// message content, raw provider payloads, or status receipts to that room.
		if (event.type === 'connection') {
			this.gateway.emitAccountEvent(accountId, 'connection', {
				status: event.status,
			});
		}
		for (const listener of this.listeners) {
			await listener(accountId, event);
		}
	}

	async disconnect(accountId: string, logout = false) {
		const provider = this.providers.get(accountId);
		if (provider) {
			if (logout) await provider.logout();
			else await provider.disconnect();
			this.providers.delete(accountId);
		} else if (logout) {
			const account = await this.accountRepo.findOneByOrFail({ id: accountId });
			await this.sessions.clear(accountId, account.providerName);
		}
		this.connectStartedAt.delete(accountId);
		this.stopLockRenewal(accountId);
		// User-initiated disconnect must clear foreign/stale locks too, otherwise
		// a later connect keeps failing with "another server instance".
		await this.forceReleaseLock(accountId);
		await this.accountRepo.update(accountId, {
			status: WhatsAppAccountStatus.DISCONNECTED,
			phoneNumber: logout ? null : undefined,
			lastError: null,
		});
		await this.log(accountId, logout ? 'logged_out' : 'disconnected');
		return { ok: true };
	}

	async destroySession(accountId: string, providerName = 'wppconnect') {
		const provider = this.providers.get(accountId);
		try {
			if (provider) await provider.logout();
		} catch (error) {
			this.logger.warn(
				`WhatsApp provider logout failed while clearing ${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			try {
				if (provider) await provider.disconnect();
			} catch {
				// The provider is being discarded and its persisted token is cleared below.
			}
		} finally {
			this.providers.delete(accountId);
			this.connecting.delete(accountId);
			this.stopLockRenewal(accountId);
			await this.forceReleaseLock(accountId);
			await this.sessions.clear(accountId, providerName);
		}
		return { ok: true };
	}

	getQr(accountId: string) {
		return this.providers.get(accountId)?.getQr() || null;
	}

	getPairingCode(accountId: string) {
		return this.providers.get(accountId)?.getPairingCode() || null;
	}

	getProviderState(accountId: string) {
		return this.providers.get(accountId)?.getState() || 'disconnected';
	}

	async waitUntilConnected(accountId: string, timeoutMs = 60000) {
		const started = Date.now();
		while (Date.now() - started < timeoutMs) {
			const provider = this.providers.get(accountId);
			if (provider?.getState() === 'connected') return true;
			await new Promise(resolve => setTimeout(resolve, 1500));
		}
		return this.providers.get(accountId)?.getState() === 'connected';
	}

	private async log(
		accountId: string,
		event: string,
		message: string | null = null,
		metadata: any = null,
	) {
		await this.logRepo.save(
			this.logRepo.create({ accountId, event, message, metadata }),
		);
	}

	async onApplicationBootstrap() {
		const accounts = await this.accountRepo.find({
			where: {
				status: In([
					WhatsAppAccountStatus.CONNECTED,
					WhatsAppAccountStatus.CONNECTING,
					WhatsAppAccountStatus.QR_PENDING,
				]),
			},
		});
		for (const account of accounts) {
			this.connect(account.id).catch(error =>
				this.logger.error(`Failed to restore WhatsApp account ${account.id}`, error),
			);
		}
	}

	async onApplicationShutdown() {
		await Promise.allSettled(
			[...this.providers.values()].map(provider => provider.disconnect()),
		);
		for (const accountId of this.lockRenewTimers.keys()) {
			this.stopLockRenewal(accountId);
		}
		await Promise.allSettled(
			[...this.providers.keys()].map(accountId => this.releaseLock(accountId)),
		);
		this.providers.clear();
	}
}
