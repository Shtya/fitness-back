import {
	Injectable,
	Logger,
	OnApplicationBootstrap,
	OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Not, Repository } from 'typeorm';
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
import { BaileysProvider } from '../providers/baileys.provider';
import {
	forceReleaseWppBrowserProfile,
	purgeWppBrowserProfile,
	resolveWppUserDataDir,
} from '../utils/whatsapp-browser-profile';
import { promises as fs } from 'fs';
import * as path from 'path';
import { WhatsAppSessionService } from './whatsapp-session.service';

@Injectable()
export class WhatsAppProviderManagerService
	implements OnApplicationBootstrap, OnApplicationShutdown
{
	private readonly logger = new Logger(WhatsAppProviderManagerService.name);
	private readonly providers = new Map<string, WhatsAppProvider>();
	private readonly invalidatingSessions = new Set<string>();
	private readonly lastSessionInvalidation = new Map<string, number>();
	private readonly sessionInvalidationCooldownMs = 10 * 60 * 1000;
	/** Space out relaunches after a repeat wipe without stranding the account. */
	private readonly sessionRelaunchBackoffMs = 30 * 1000;
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

		const desiredProvider = this.configuredProviderName();
		const active = this.providers.get(accountId);
		const wrongProvider = Boolean(active && active.name !== desiredProvider);
		if (active?.getState() === 'connected' && !wrongProvider) {
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
		if (isInFlight && !phoneNumber && !isStuck && !wrongProvider) {
			return active;
		}
		if (active && (phoneNumber || isStuck || isBroken || isInFlight || wrongProvider)) {
			this.providers.delete(accountId);
			this.connectStartedAt.delete(accountId);
			await active.disconnect().catch(() => undefined);
			this.stopLockRenewal(accountId);
			await this.releaseLock(accountId).catch(() => undefined);
			if (active.name === 'wppconnect' || desiredProvider === 'baileys') {
				await forceReleaseWppBrowserProfile(accountId).catch(error =>
					this.logger.warn(
						`Could not release Chromium profile for ${accountId}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					),
				);
			}
		}

		const promise = this.connectExclusive(accountId, phoneNumber);
		this.connecting.set(accountId, promise);
		try {
			return await promise;
		} finally {
			this.connecting.delete(accountId);
		}
	}

	private configuredProviderName() {
		const env = String(process.env.WHATSAPP_PROVIDER || 'baileys').trim().toLowerCase();
		return env === 'wppconnect' ? 'wppconnect' : 'baileys';
	}

	private resolveProviderName(account: WhatsAppAccount) {
		// Env wins so stale DB rows (created under WPP) cannot keep Chromium forever.
		void account;
		return this.configuredProviderName();
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
		const providerName = this.resolveProviderName(account);
		// Keep CONNECTED in the DB while we restore the in-memory session.
		if (account.status !== WhatsAppAccountStatus.CONNECTED) {
			await this.accountRepo.update(accountId, {
				status: WhatsAppAccountStatus.CONNECTING,
				lastError: null,
				providerName,
			});
		} else if (account.providerName !== providerName) {
			await this.accountRepo.update(accountId, { providerName });
		}
		account.providerName = providerName;
		const provider = this.createProvider(account);
		provider.onEvent(event => this.handleEvent(accountId, event));
		this.providers.set(accountId, provider);
		this.connectStartedAt.set(accountId, Date.now());
		try {
			await provider.connect(phoneNumber);
			if (
				!phoneNumber &&
				typeof provider.getQr === 'function' &&
				provider.getState?.() !== 'connected' &&
				!provider.getQr() &&
				!(typeof provider.getPairingCode === 'function' && provider.getPairingCode())
			) {
				await this.waitForLinkMaterial(accountId, 20_000);
			}
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
		const providerName = this.resolveProviderName(account);
		if (providerName === 'baileys') {
			return new BaileysProvider(account.id);
		}
		if (providerName === 'wppconnect') {
			return new WppConnectProvider(
				account.id,
				this.sessions.createWppTokenStore(account.id),
			);
		}
		throw new Error(`Unsupported WhatsApp provider: ${providerName}`);
	}

	/**
	 * Stale rows still say wppconnect even when .env switched to baileys — that is
	 * why the dashboard kept opening Chromium and an empty ChatStore.
	 */
	private async migrateAccountsToConfiguredProvider() {
		const target = this.configuredProviderName();
		const stale = await this.accountRepo.find({
			where: { providerName: Not(target) },
			select: ['id', 'providerName', 'label'],
		});
		if (!stale.length) return;
		this.logger.warn(
			`Migrating ${stale.length} WhatsApp account(s) to provider "${target}" (WHATSAPP_PROVIDER)`,
		);
		for (const account of stale) {
			await this.accountRepo.update(account.id, { providerName: target });
			if (target === 'baileys') {
				await this.sessions.clear(account.id, 'wppconnect').catch(() => undefined);
				await purgeWppBrowserProfile(account.id).catch(error =>
					this.logger.warn(
						`Could not purge Chromium profile while migrating ${account.id}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					),
				);
			}
		}
	}

	/**
	 * WhatsApp dropped the pairing, so the stored Chromium profile is dead weight:
	 * keeping it only loops the QR screen forever. Wipe it, tell the managers what
	 * happened, then start a clean client so a scannable QR shows up immediately.
	 */
	private async handleSessionInvalid(accountId: string, reason: string) {
		if (this.invalidatingSessions.has(accountId)) return;
		this.invalidatingSessions.add(accountId);
		// A profile we failed to delete authenticates with the same dead keys and
		// unpairs again seconds later, so a repeat wipe earns a backoff before the
		// next relaunch instead of burning CPU on an instant retry loop.
		const lastAttempt = this.lastSessionInvalidation.get(accountId) || 0;
		const isRepeat = Date.now() - lastAttempt < this.sessionInvalidationCooldownMs;
		this.lastSessionInvalidation.set(accountId, Date.now());
		let purgeFailed = false;
		try {
			this.logger.error(`Wiping WhatsApp session for ${accountId}: ${reason}`);
			this.providers.delete(accountId);
			this.connectStartedAt.delete(accountId);
			this.connecting.delete(accountId);
			this.stopLockRenewal(accountId);
			await this.releaseLock(accountId).catch(() => undefined);
			await purgeWppBrowserProfile(accountId).catch(error => {
				purgeFailed = true;
				this.logger.error(
					`Could not purge Chromium profile for ${accountId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			});
			await this.sessions.clear(accountId, 'wppconnect').catch(() => undefined);
			const message = purgeFailed
				? `${reason} (the stored browser profile could not be deleted automatically — delete tokens/${accountId} and reconnect)`
				: reason;
			await this.accountRepo.update(accountId, {
				status: WhatsAppAccountStatus.ERROR,
				lastError: message,
			});
			await this.log(accountId, 'session_invalidated', message);
			this.gateway.emitAccountEvent(accountId, 'session_invalid', {
				message,
				requiresScan: true,
			});
			const recipients = await this.accessRepo.find({
				where: { accountId, canManage: true },
			});
			await Promise.allSettled(
				recipients.map(recipient =>
					this.notifications.create({
						type: NotificationType.WHATSAPP_CONNECTION,
						title: 'WhatsApp needs a new QR scan',
						message: reason,
						data: { accountId, type: 'whatsapp_connection', requiresScan: true },
						audience: NotificationAudience.USER,
						userId: recipient.userId,
					}),
				),
			);
		} finally {
			this.invalidatingSessions.delete(accountId);
		}

		if (purgeFailed) {
			this.logger.error(
				`Not relaunching WhatsApp for ${accountId}: the Chromium profile could not be deleted. Remove tokens/${accountId} and reconnect.`,
			);
			return;
		}

		// A repeat wipe means something keeps unpairing us; relaunching instantly
		// would spin. Back off, but always come back with a scannable QR — leaving
		// the account in ERROR strands the dashboard on an empty QR poll forever.
		const delayMs = isRepeat ? this.sessionRelaunchBackoffMs : 0;
		if (delayMs) {
			this.logger.warn(
				`WhatsApp for ${accountId} was invalidated again — waiting ${Math.round(
					delayMs / 1000,
				)}s before offering a fresh QR.`,
			);
		}
		const relaunch = () =>
			this.connect(accountId).catch(error =>
				this.logger.error(
					`Could not start a fresh WhatsApp session for ${accountId}`,
					error,
				),
			);
		if (!delayMs) {
			// Fresh profile → the new provider starts from "never linked", so an
			// UNPAIRED state while waiting for the scan cannot retrigger this path.
			void relaunch();
			return;
		}
		setTimeout(relaunch, delayMs).unref?.();
	}

	private async handleEvent(accountId: string, event: WhatsAppProviderEvent) {
		if (event.type === 'session_invalid') {
			await this.handleSessionInvalid(accountId, event.reason);
			return;
		}
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
			// Live provider already authenticated — ignore a late QR from Chromium.
			if (provider?.getState() === 'connected') {
				return;
			}
			// Stale DB "connected" with no live waiter must not flip back to QR.
			// A live connecting/qr_pending provider means the link is being rebuilt.
			if (!provider || !['connecting', 'qr_pending'].includes(provider.getState())) {
				const account = await this.accountRepo.findOne({ where: { id: accountId } });
				if (account?.status === WhatsAppAccountStatus.CONNECTED) {
					return;
				}
			}
			await this.accountRepo.update(accountId, { status: WhatsAppAccountStatus.QR_PENDING });
			await this.log(accountId, 'qr_updated');
		}
		if (event.type === 'pairing_code') {
			const provider = this.providers.get(accountId);
			if (provider?.getState() === 'connected') {
				return;
			}
			if (!provider || !['connecting', 'qr_pending'].includes(provider.getState())) {
				const account = await this.accountRepo.findOne({ where: { id: accountId } });
				if (account?.status === WhatsAppAccountStatus.CONNECTED) {
					return;
				}
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
				reason: event.reason || undefined,
				message: event.error || undefined,
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
			await this.sessions.remove(accountId, account.providerName).catch(() =>
				this.sessions.clear(accountId, account.providerName),
			);
		}
		this.connectStartedAt.delete(accountId);
		this.connecting.delete(accountId);
		if (logout) {
			this.invalidatingSessions.delete(accountId);
			this.lastSessionInvalidation.delete(accountId);
		}
		this.stopLockRenewal(accountId);
		// User-initiated disconnect must clear foreign/stale locks too, otherwise
		// a later connect keeps failing with "another server instance".
		await this.forceReleaseLock(accountId);
		if (logout) {
			// Full unlink: wipe Chromium profile so the next scan cannot collide
			// with stale multi-device keys from this account.
			await purgeWppBrowserProfile(accountId).catch(error =>
				this.logger.warn(
					`Could not purge Chromium profile for ${accountId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				),
			);
		} else {
			// Soft disconnect: keep the linked-device keys, only free the lock.
			await forceReleaseWppBrowserProfile(accountId).catch(error =>
				this.logger.warn(
					`Could not release Chromium profile for ${accountId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				),
			);
		}
		await this.accountRepo.update(accountId, {
			status: WhatsAppAccountStatus.DISCONNECTED,
			phoneNumber: logout ? null : undefined,
			lastError: null,
		});
		await this.log(accountId, logout ? 'logged_out' : 'disconnected');
		return { ok: true };
	}

	/**
	 * Tear down every live and persisted artifact for an account so the next
	 * link starts from a blank session — no leftover Chromium profile, Baileys
	 * creds, Redis lock, or soft-deleted session row.
	 */
	async destroySession(accountId: string, providerName = 'baileys') {
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
			this.connectStartedAt.delete(accountId);
			this.invalidatingSessions.delete(accountId);
			this.lastSessionInvalidation.delete(accountId);
			this.stopLockRenewal(accountId);
			await this.forceReleaseLock(accountId);
			await purgeWppBrowserProfile(accountId).catch(error =>
				this.logger.warn(
					`Could not purge Chromium profile for ${accountId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				),
			);
			const baileysRoot = path.resolve(
				process.env.WHATSAPP_BAILEYS_DIR ||
					process.env.WHATSAPP_TOKEN_FOLDER ||
					path.join(process.cwd(), 'tokens', 'baileys'),
			);
			await fs.rm(path.join(baileysRoot, accountId), { recursive: true, force: true }).catch(() => undefined);
			await this.sessions.remove(accountId, providerName).catch(() =>
				this.sessions.clear(accountId, providerName),
			);
			await this.sessions.remove(accountId, 'baileys').catch(() => undefined);
			await this.sessions.remove(accountId, 'wppconnect').catch(() => undefined);
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

	/** Give catchQR / catchLinkCode time to populate before /connect responds. */
	private async waitForLinkMaterial(accountId: string, timeoutMs = 20000) {
		const started = Date.now();
		while (Date.now() - started < timeoutMs) {
			const provider = this.providers.get(accountId);
			if (!provider) return;
			const state = provider.getState?.() || 'disconnected';
			if (state === 'connected' || state === 'error') return;
			const qr = typeof provider.getQr === 'function' ? provider.getQr() : null;
			const code =
				typeof provider.getPairingCode === 'function' ? provider.getPairingCode() : null;
			if (qr || code) return;
			await new Promise(resolve => setTimeout(resolve, 400));
		}
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

	/**
	 * Delete Chromium profiles left behind by accounts that no longer exist.
	 * Without this, deleted accounts keep multi-device keys on disk and can
	 * confuse later links / eat disk for months.
	 */
	private async purgeOrphanBrowserProfiles() {
		const tokensRoot = path.dirname(resolveWppUserDataDir('_'));
		let entries: string[] = [];
		try {
			entries = await fs.readdir(tokensRoot);
		} catch {
			return;
		}
		const accounts = await this.accountRepo.find({ select: ['id'] });
		const alive = new Set(accounts.map(account => account.id));
		for (const name of entries) {
			if (!/^[0-9a-f-]{36}$/i.test(name)) continue;
			if (alive.has(name)) continue;
			this.logger.warn(`Purging orphan WhatsApp browser profile ${name}`);
			await purgeWppBrowserProfile(name).catch(error =>
				this.logger.warn(
					`Could not purge orphan profile ${name}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				),
			);
		}
	}

	async onApplicationBootstrap() {
		await this.migrateAccountsToConfiguredProvider().catch(error =>
			this.logger.warn(
				`WhatsApp provider migration failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			),
		);
		await this.purgeOrphanBrowserProfiles().catch(error =>
			this.logger.warn(
				`Orphan WhatsApp profile cleanup failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			),
		);
		const accounts = await this.accountRepo.find({
			where: {
				status: In([
					WhatsAppAccountStatus.CONNECTED,
					WhatsAppAccountStatus.CONNECTING,
					WhatsAppAccountStatus.QR_PENDING,
					// Session tokens often survive while DB status flips to disconnected
					// after a Chromium crash — restore those too so users do not need
					// a manual "reset connection" to come back online.
					WhatsAppAccountStatus.DISCONNECTED,
					WhatsAppAccountStatus.ERROR,
				]),
			},
		});
		for (const account of accounts) {
			const providerName = this.resolveProviderName(account);
			const shouldRestore =
				[
					WhatsAppAccountStatus.CONNECTED,
					WhatsAppAccountStatus.CONNECTING,
					WhatsAppAccountStatus.QR_PENDING,
				].includes(account.status) ||
				(await this.sessions.hasActiveSession(account.id, providerName));
			if (!shouldRestore) continue;
			this.connect(account.id).catch(error =>
				this.logger.error(`Failed to restore WhatsApp account ${account.id}`, error),
			);
		}
	}

	async onApplicationShutdown() {
		// Chromium needs a clean close to flush the linked-device keys, but a hung
		// browser must not block process exit either.
		await Promise.allSettled(
			[...this.providers.values()].map(provider =>
				Promise.race([
					provider.disconnect(),
					new Promise(resolve => setTimeout(resolve, 8000)),
				]),
			),
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
