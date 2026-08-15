import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import { WhatsAppAccountStatus } from '../../whatsapp/entities/whatsapp.entity';
import { WhatsAppAccountsService } from '../../whatsapp/services/whatsapp-accounts.service';
import { WhatsAppProviderManagerService } from '../../whatsapp/services/whatsapp-provider-manager.service';
import {
	EmailMemoWhatsAppConnection,
	EmailMemoWhatsAppStatus,
} from '../entities/email-memo.entity';
import { normalizeWhatsAppChatId } from '../utils/email-memo.utils';

const MEMO_LABEL = 'Email Memo';
const MAX_MEMO_ACCOUNTS = 5;

type ListedAccount = Record<string, unknown>;

type MemoAccountView = {
	id: string;
	label: string;
	phoneNumber: string | null;
	status: EmailMemoWhatsAppStatus;
	connected: boolean;
	online: boolean;
	sending: boolean;
	lastError: string | null;
};

@Injectable()
export class EmailMemoWhatsAppService {
	private readonly logger = new Logger(EmailMemoWhatsAppService.name);

	constructor(
		@InjectRepository(EmailMemoWhatsAppConnection)
		private readonly connections: Repository<EmailMemoWhatsAppConnection>,
		@InjectRepository(User)
		private readonly users: Repository<User>,
		private readonly accounts: WhatsAppAccountsService,
		private readonly providers: WhatsAppProviderManagerService,
	) {}

	private async ensureRow(userId: string) {
		let row = await this.connections.findOne({ where: { userId } });
		if (!row) {
			row = this.connections.create({
				userId,
				status: EmailMemoWhatsAppStatus.DISCONNECTED,
				dedicatedAccount: true,
			});
			row = await this.connections.save(row);
		}
		return row;
	}

	private mapStatus(raw: string): EmailMemoWhatsAppStatus {
		if (raw === 'connected') return EmailMemoWhatsAppStatus.CONNECTED;
		if (raw === 'qr_pending') return EmailMemoWhatsAppStatus.QR_PENDING;
		if (raw === 'connecting') return EmailMemoWhatsAppStatus.CONNECTING;
		if (raw === 'error') return EmailMemoWhatsAppStatus.ERROR;
		return EmailMemoWhatsAppStatus.DISCONNECTED;
	}

	private isDedicatedLabel(label: unknown) {
		const value = String(label || '');
		return value === MEMO_LABEL || value.startsWith(`${MEMO_LABEL} `);
	}

	private isMemoAccount(item: ListedAccount, connectionAccountId?: string | null) {
		if (this.isDedicatedLabel(item.label)) return true;
		return Boolean(connectionAccountId && String(item.id) === String(connectionAccountId));
	}

	private memoAccounts(listed: ListedAccount[], connectionAccountId?: string | null) {
		return listed.filter((item) => this.isMemoAccount(item, connectionAccountId));
	}

	private liveStatus(item: ListedAccount) {
		const id = String(item.id || '');
		const live = id ? this.providers.getProviderState(id) : 'disconnected';
		return this.mapStatus(String(item.status || live));
	}

	private isLinkingStatus(status: EmailMemoWhatsAppStatus) {
		return status === EmailMemoWhatsAppStatus.QR_PENDING || status === EmailMemoWhatsAppStatus.CONNECTING;
	}

	private nextMemoLabel(memoList: ListedAccount[]) {
		const labels = new Set(memoList.map((item) => String(item.label || '')));
		if (!labels.has(MEMO_LABEL)) return MEMO_LABEL;
		let n = 2;
		while (labels.has(`${MEMO_LABEL} ${n}`)) n += 1;
		return `${MEMO_LABEL} ${n}`;
	}

	private toAccountView(item: ListedAccount, sendingId: string | null): MemoAccountView {
		const id = String(item.id || '');
		const live = id ? this.providers.getProviderState(id) : 'disconnected';
		const status = this.mapStatus(String(item.status || live));
		return {
			id,
			label: String(item.label || MEMO_LABEL),
			phoneNumber: (item.phoneNumber as string) || null,
			status,
			connected: status === EmailMemoWhatsAppStatus.CONNECTED,
			online: live === 'connected',
			sending: Boolean(sendingId && id === sendingId),
			lastError: (item.lastError as string) || null,
		};
	}

	private linkingOf(accounts: MemoAccountView[]) {
		return accounts.find((item) => this.isLinkingStatus(item.status)) || null;
	}

	private phoneFromProvider(provider: unknown) {
		const id = (provider as { socket?: { user?: { id?: string } } })?.socket?.user?.id;
		return id ? String(id).split(':')[0] : null;
	}

	private activeIsConnected(row: EmailMemoWhatsAppConnection, memoList: ListedAccount[]) {
		const activeId = String(row.whatsappAccountId || '');
		if (!activeId) return false;
		const active = memoList.find((item) => String(item.id) === activeId);
		return Boolean(active && this.liveStatus(active) === EmailMemoWhatsAppStatus.CONNECTED);
	}

	async getConnection(userId: string) {
		const row = await this.ensureRow(userId);
		const user = await this.users.findOne({ where: { id: userId } });
		const listed = user ? await this.accounts.list(user) : [];
		const memoList = this.memoAccounts(listed, row.whatsappAccountId);
		let activeId = String(row.whatsappAccountId || '');
		const activeItem = memoList.find((item) => String(item.id) === activeId);
		const firstConnected = memoList.find((item) => this.liveStatus(item) === EmailMemoWhatsAppStatus.CONNECTED);
		if ((!activeItem || this.liveStatus(activeItem) !== EmailMemoWhatsAppStatus.CONNECTED) && firstConnected) {
			activeId = String(firstConnected.id);
			if (row.whatsappAccountId !== activeId) {
				row.whatsappAccountId = activeId;
				row.dedicatedAccount = this.isDedicatedLabel(firstConnected.label);
				row.phoneNumber = (firstConnected.phoneNumber as string) || row.phoneNumber;
				row.deviceName = String(firstConnected.label || row.deviceName || MEMO_LABEL);
				row.status = EmailMemoWhatsAppStatus.CONNECTED;
				await this.connections.save(row);
			}
		} else if (activeItem && row.whatsappAccountId !== String(activeItem.id)) {
			row.whatsappAccountId = String(activeItem.id);
			await this.connections.save(row);
		}

		const accounts = memoList.map((item) => this.toAccountView(item, activeId || null));
		const linking = this.linkingOf(accounts);
		const linkingAccountId = linking?.id || null;
		const qrSourceId = linkingAccountId || activeId || '';
		const activeView = accounts.find((item) => item.id === activeId) || null;
		const status = linking?.status || activeView?.status || row.status;
		if (activeView?.phoneNumber && row.phoneNumber !== activeView.phoneNumber) {
			row.phoneNumber = activeView.phoneNumber;
			row.deviceName = activeView.label || row.deviceName;
			row.dedicatedAccount = this.isDedicatedLabel(activeView.label);
			row.status = activeView.connected ? EmailMemoWhatsAppStatus.CONNECTED : row.status;
			await this.connections.save(row);
		}

		return {
			status,
			connected: Boolean(activeView?.connected),
			online: Boolean(activeView?.online),
			deviceName: activeView?.label || row.deviceName,
			phoneNumber: activeView?.phoneNumber || row.phoneNumber,
			jid: row.jid,
			qr: qrSourceId ? this.providers.getQr(qrSourceId) : null,
			pairingCode: qrSourceId ? this.providers.getPairingCode(qrSourceId) : null,
			accountId: activeId || null,
			lastError: activeView?.lastError || row.lastError,
			dedicatedAccount: activeView ? this.isDedicatedLabel(activeView.label) : row.dedicatedAccount,
			accounts,
			maxAccounts: MAX_MEMO_ACCOUNTS,
			linkingAccountId,
		};
	}

	async connect(userId: string, opts: { extra?: boolean; accountId?: string } = {}) {
		const user = await this.users.findOne({ where: { id: userId } });
		if (!user) throw new BadRequestException('User not found');
		const row = await this.ensureRow(userId);
		const listed = await this.accounts.list(user);
		const memoList = this.memoAccounts(listed, row.whatsappAccountId);
		const extra = Boolean(opts.extra);
		const reconnectId = String(opts.accountId || '').trim();
		let accountId = '';
		let dedicated = true;
		let changeSender = true;

		if (reconnectId) {
			const target = memoList.find((item) => String(item.id) === reconnectId);
			if (!target) throw new BadRequestException('WhatsApp account not found');
			accountId = reconnectId;
			dedicated = this.isDedicatedLabel(target.label);
			if (this.activeIsConnected(row, memoList) && reconnectId !== String(row.whatsappAccountId || '')) {
				changeSender = false;
			}
		} else if (extra) {
			if (memoList.some((item) => this.isLinkingStatus(this.liveStatus(item)))) {
				return this.getConnection(userId);
			}
			if (memoList.length >= MAX_MEMO_ACCOUNTS) {
				throw new BadRequestException('Maximum WhatsApp devices reached');
			}
			const created = await this.accounts.create(user, { label: this.nextMemoLabel(memoList) });
			accountId = created.id;
			dedicated = true;
			if (this.activeIsConnected(row, memoList)) changeSender = false;
		} else if (!memoList.length) {
			const reusable = listed.find((item) => item.status === WhatsAppAccountStatus.CONNECTED);
			if (reusable) {
				accountId = String(reusable.id);
				dedicated = this.isDedicatedLabel(reusable.label);
			} else {
				const created = await this.accounts.create(user, { label: MEMO_LABEL });
				accountId = created.id;
				dedicated = true;
			}
		} else {
			if (
				memoList.some((item) => this.liveStatus(item) === EmailMemoWhatsAppStatus.CONNECTED) ||
				memoList.some((item) => this.isLinkingStatus(this.liveStatus(item)))
			) {
				return this.getConnection(userId);
			}
			const disconnected = memoList.find(
				(item) => !this.isLinkingStatus(this.liveStatus(item)) && this.liveStatus(item) !== EmailMemoWhatsAppStatus.CONNECTED,
			);
			if (!disconnected) return this.getConnection(userId);
			accountId = String(disconnected.id);
			dedicated = this.isDedicatedLabel(disconnected.label);
		}

		if (changeSender) {
			row.whatsappAccountId = accountId;
			row.dedicatedAccount = dedicated;
			row.status = EmailMemoWhatsAppStatus.CONNECTING;
			row.lastError = null;
		}
		row.lastQrAt = new Date();
		await this.connections.save(row);
		try {
			const provider = await this.providers.connect(accountId);
			const live = provider.getState();
			if (changeSender) {
				row.status = this.mapStatus(live);
				row.phoneNumber = this.phoneFromProvider(provider) || row.phoneNumber;
				const linked = memoList.find((item) => String(item.id) === accountId);
				row.deviceName = String(linked?.label || (dedicated ? MEMO_LABEL : row.deviceName || MEMO_LABEL));
				await this.connections.save(row);
			}
			return this.getConnection(userId);
		} catch (error) {
			if (changeSender) {
				row.status = EmailMemoWhatsAppStatus.ERROR;
				row.lastError = error instanceof Error ? error.message : String(error);
				await this.connections.save(row);
			}
			throw error;
		}
	}

	async useAccount(userId: string, accountId: string) {
		const user = await this.users.findOne({ where: { id: userId } });
		if (!user) throw new BadRequestException('User not found');
		const row = await this.ensureRow(userId);
		const listed = await this.accounts.list(user);
		const memoList = this.memoAccounts(listed, row.whatsappAccountId);
		const target = memoList.find((item) => String(item.id) === String(accountId));
		if (!target) throw new BadRequestException('WhatsApp account not found');
		row.whatsappAccountId = String(target.id);
		row.dedicatedAccount = this.isDedicatedLabel(target.label);
		row.phoneNumber = (target.phoneNumber as string) || row.phoneNumber;
		row.deviceName = String(target.label || row.deviceName || MEMO_LABEL);
		row.status = this.liveStatus(target);
		row.lastError = (target.lastError as string) || null;
		await this.connections.save(row);
		return this.getConnection(userId);
	}

	async whatsappQr(userId: string) {
		const status = await this.getConnection(userId);
		const sourceId = status.linkingAccountId || status.accountId;
		return {
			qr: sourceId ? this.providers.getQr(sourceId) || status.qr : status.qr,
			pairingCode: sourceId ? this.providers.getPairingCode(sourceId) || status.pairingCode : status.pairingCode,
			status: sourceId ? this.mapStatus(this.providers.getProviderState(sourceId) || status.status) : status.status,
			connected: status.connected,
			accounts: status.accounts,
			linkingAccountId: status.linkingAccountId,
			accountId: status.accountId,
		};
	}

	async listChats(userId: string) {
		const status = await this.getConnection(userId);
		if (!status.accountId) return [];
		const provider = this.providers.getProvider(status.accountId);
		if (!provider || typeof (provider as any).getChats !== 'function') return [];
		try {
			const chats = await (provider as any).getChats(40);
			return (chats || [])
				.map((chat: any) => ({
					id: String(chat?.id?._serialized || chat?.id || ''),
					name: String(chat?.name || chat?.subject || chat?.id?._serialized || 'Chat'),
				}))
				.filter((item: { id: string }) => item.id);
		} catch (error) {
			this.logger.warn(`listChats failed: ${error instanceof Error ? error.message : error}`);
			return [];
		}
	}

	async sendText(userId: string, chatId: string, text: string) {
		const status = await this.getConnection(userId);
		if (!status.accountId || !status.connected) {
			throw new Error('WhatsApp is not connected');
		}
		const provider = this.providers.getProvider(status.accountId);
		if (!provider) throw new Error('WhatsApp is not connected');
		const result = await provider.sendText(chatId, text);
		return {
			id: String(result?.key?.id || result?.id || ''),
			chatId,
		};
	}

	async resolveTargetChat(userId: string, preferred?: string | null) {
		const normalized = normalizeWhatsAppChatId(preferred);
		if (normalized) return normalized;
		const status = await this.getConnection(userId);
		const digits = String(status.phoneNumber || '').replace(/\D/g, '');
		if (digits) return `${digits}@s.whatsapp.net`;
		const chats = await this.listChats(userId);
		return chats[0]?.id || '';
	}

	async disconnect(userId: string, logout = true, accountId?: string) {
		const user = await this.users.findOne({ where: { id: userId } });
		const row = await this.ensureRow(userId);
		const listed = user ? await this.accounts.list(user) : [];
		const memoList = this.memoAccounts(listed, row.whatsappAccountId);
		const targetId = String(accountId || row.whatsappAccountId || '');
		if (!targetId) return { ok: true };

		const target =
			memoList.find((item) => String(item.id) === targetId) ||
			listed.find((item) => String(item.id) === targetId);
		if (!target) return { ok: true };
		const dedicated = this.isDedicatedLabel(target.label);
		if (dedicated && logout) {
			await this.providers.disconnect(targetId, true).catch((error) => {
				this.logger.warn(`WhatsApp logout failed: ${error instanceof Error ? error.message : error}`);
			});
		}

		const remainingConnected = memoList.find(
			(item) =>
				String(item.id) !== targetId && this.liveStatus(item) === EmailMemoWhatsAppStatus.CONNECTED,
		);
		if (String(row.whatsappAccountId || '') === targetId) {
			if (remainingConnected) {
				row.whatsappAccountId = String(remainingConnected.id);
				row.dedicatedAccount = this.isDedicatedLabel(remainingConnected.label);
				row.phoneNumber = (remainingConnected.phoneNumber as string) || row.phoneNumber;
				row.deviceName = String(remainingConnected.label || row.deviceName || MEMO_LABEL);
				row.status = EmailMemoWhatsAppStatus.CONNECTED;
			} else {
				row.status = EmailMemoWhatsAppStatus.DISCONNECTED;
				row.whatsappAccountId = dedicated ? targetId : null;
			}
		}
		row.lastError = null;
		await this.connections.save(row);
		return { ok: true };
	}
}
