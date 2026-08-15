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

const MEMO_LABEL = 'Email Memo';

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

	async getConnection(userId: string) {
		const row = await this.ensureRow(userId);
		const user = await this.users.findOne({ where: { id: userId } });
		const listed = user ? await this.accounts.list(user) : [];
		const linked =
			listed.find((item) => item.id === row.whatsappAccountId) ||
			listed.find((item) => item.status === WhatsAppAccountStatus.CONNECTED) ||
			listed.find((item) => item.label === MEMO_LABEL);
		const accountId = String(linked?.id || row.whatsappAccountId || '');
		const live = accountId ? this.providers.getProviderState(accountId) : 'disconnected';
		const status = this.mapStatus(String(linked?.status || live || row.status));
		const qr = accountId ? this.providers.getQr(accountId) : null;
		const pairingCode = accountId ? this.providers.getPairingCode(accountId) : null;
		if (linked && row.whatsappAccountId !== linked.id) {
			row.whatsappAccountId = String(linked.id);
			row.dedicatedAccount = String(linked.label) === MEMO_LABEL;
			row.phoneNumber = (linked.phoneNumber as string) || row.phoneNumber;
			row.deviceName = String(linked.label || row.deviceName || MEMO_LABEL);
			row.status = status;
			await this.connections.save(row);
		}
		return {
			status,
			connected: status === EmailMemoWhatsAppStatus.CONNECTED,
			online: live === 'connected',
			deviceName: (linked?.label as string) || row.deviceName,
			phoneNumber: (linked?.phoneNumber as string) || row.phoneNumber,
			jid: row.jid,
			qr,
			pairingCode,
			accountId: accountId || null,
			lastError: (linked?.lastError as string) || row.lastError,
			dedicatedAccount: row.dedicatedAccount,
		};
	}

	async connect(userId: string) {
		const user = await this.users.findOne({ where: { id: userId } });
		if (!user) throw new BadRequestException('User not found');
		const row = await this.ensureRow(userId);
		const listed = await this.accounts.list(user);
		const reusable =
			listed.find((item) => item.status === WhatsAppAccountStatus.CONNECTED) ||
			listed.find((item) => item.id === row.whatsappAccountId) ||
			listed.find((item) => item.label === MEMO_LABEL);
		let accountId = String(reusable?.id || '');
		let dedicated = String(reusable?.label || '') === MEMO_LABEL;
		if (!accountId) {
			const created = await this.accounts.create(user, { label: MEMO_LABEL });
			accountId = created.id;
			dedicated = true;
		}
		row.whatsappAccountId = accountId;
		row.dedicatedAccount = dedicated;
		row.status = EmailMemoWhatsAppStatus.CONNECTING;
		row.lastError = null;
		await this.connections.save(row);
		try {
			const provider = await this.providers.connect(accountId);
			const live = provider.getState();
			row.status = this.mapStatus(live);
			row.phoneNumber = (provider as any)?.socket?.user?.id
				? String((provider as any).socket.user.id).split(':')[0]
				: row.phoneNumber;
			row.deviceName = String(reusable?.label || MEMO_LABEL);
			row.lastQrAt = new Date();
			await this.connections.save(row);
			return {
				status: row.status,
				qr: this.providers.getQr(accountId),
				pairingCode: this.providers.getPairingCode(accountId),
				accountId,
			};
		} catch (error) {
			row.status = EmailMemoWhatsAppStatus.ERROR;
			row.lastError = error instanceof Error ? error.message : String(error);
			await this.connections.save(row);
			throw error;
		}
	}

	async whatsappQr(userId: string) {
		const status = await this.getConnection(userId);
		if (status.accountId && ['connecting', 'disconnected', 'qr_pending', 'error'].includes(status.status)) {
			const qr = this.providers.getQr(status.accountId) || status.qr;
			return {
				qr,
				pairingCode: this.providers.getPairingCode(status.accountId) || status.pairingCode,
				status: this.providers.getProviderState(status.accountId) || status.status,
			};
		}
		return { qr: status.qr, pairingCode: status.pairingCode, status: status.status };
	}

	async listChats(userId: string) {
		const status = await this.getConnection(userId);
		if (!status.accountId) return [];
		const provider = this.providers.getProvider(status.accountId);
		if (!provider || typeof (provider as any).getChats !== 'function') return [];
		try {
			const chats = await (provider as any).getChats(40);
			return (chats || []).map((chat: any) => ({
				id: String(chat?.id?._serialized || chat?.id || ''),
				name: String(chat?.name || chat?.subject || chat?.id?._serialized || 'Chat'),
			})).filter((item: { id: string }) => item.id);
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
		if (preferred) return preferred;
		const status = await this.getConnection(userId);
		if (status.phoneNumber) return `${String(status.phoneNumber).replace(/\D/g, '')}@s.whatsapp.net`;
		const chats = await this.listChats(userId);
		return chats[0]?.id || '';
	}

	async disconnect(userId: string, logout = false) {
		const row = await this.ensureRow(userId);
		const accountId = row.whatsappAccountId;
		if (accountId && row.dedicatedAccount && logout) {
			await this.providers.disconnect(accountId, true).catch((error) => {
				this.logger.warn(
					`WhatsApp logout failed: ${error instanceof Error ? error.message : error}`,
				);
			});
		}
		row.status = EmailMemoWhatsAppStatus.DISCONNECTED;
		row.whatsappAccountId = row.dedicatedAccount ? row.whatsappAccountId : null;
		row.lastError = null;
		await this.connections.save(row);
		return { ok: true };
	}
}
