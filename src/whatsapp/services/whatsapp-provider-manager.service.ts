import {
	Injectable,
	Logger,
	OnApplicationBootstrap,
	OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
	NotificationAudience,
	NotificationType,
} from '../../../entities/global.entity';
import { NotificationService } from '../../notification/notification.service';
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
	private readonly listeners = new Set<
		(accountId: string, event: WhatsAppProviderEvent) => void | Promise<void>
	>();

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
	) {}

	onProviderEvent(
		listener: (accountId: string, event: WhatsAppProviderEvent) => void | Promise<void>,
	) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getProvider(accountId: string) {
		return this.providers.get(accountId) || null;
	}

	async connect(accountId: string) {
		const pending = this.connecting.get(accountId);
		if (pending) return pending;

		const active = this.providers.get(accountId);
		if (active?.getState() === 'connected') {
			return active;
		}
		// Reuse an in-flight browser session instead of starting a second Chromium.
		if (active && ['connecting', 'qr_pending'].includes(active.getState())) {
			return active;
		}

		const promise = this.connectExclusive(accountId);
		this.connecting.set(accountId, promise);
		try {
			return await promise;
		} finally {
			this.connecting.delete(accountId);
		}
	}

	private async connectExclusive(accountId: string) {
		const account = await this.accountRepo.findOneByOrFail({ id: accountId });
		await this.accountRepo.update(accountId, {
			status: WhatsAppAccountStatus.CONNECTING,
			lastError: null,
		});
		const provider = this.createProvider(account);
		provider.onEvent(event => this.handleEvent(accountId, event));
		this.providers.set(accountId, provider);
		try {
			await provider.connect();
			await this.log(accountId, 'connect_started', 'WhatsApp provider started');
			return provider;
		} catch (error) {
			this.providers.delete(accountId);
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
			await this.accountRepo.update(accountId, {
				status,
				phoneNumber: event.phoneNumber || undefined,
				lastConnectedAt: status === WhatsAppAccountStatus.CONNECTED ? new Date() : undefined,
				lastError: null,
			});
			await this.log(accountId, 'connection_state_changed', null, { status });
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
			await this.accountRepo.update(accountId, { status: WhatsAppAccountStatus.QR_PENDING });
			await this.log(accountId, 'qr_updated');
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
		await this.accountRepo.update(accountId, {
			status: WhatsAppAccountStatus.DISCONNECTED,
			phoneNumber: logout ? null : undefined,
		});
		await this.log(accountId, logout ? 'logged_out' : 'disconnected');
		return { ok: true };
	}

	getQr(accountId: string) {
		return this.providers.get(accountId)?.getQr() || null;
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
		this.providers.clear();
	}
}
