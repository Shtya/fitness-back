import { BaileysProvider } from '../providers/baileys.provider';
import { WhatsAppStatusService } from './whatsapp-status.service';
import { WhatsAppSyncService } from './whatsapp-sync.service';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const POSTER = '201000000001@s.whatsapp.net';

function storyRaw(id: string) {
	return {
		key: { remoteJid: 'status@broadcast', id, fromMe: false, participant: POSTER },
		messageTimestamp: Math.floor(Date.now() / 1000) - 60,
		message: { imageMessage: { mimetype: 'image/jpeg' } },
	};
}

function revokeRaw(targetId: string) {
	return {
		key: { remoteJid: 'status@broadcast', id: 'REVOKE-ENVELOPE', fromMe: false, participant: POSTER },
		messageTimestamp: Math.floor(Date.now() / 1000),
		message: { protocolMessage: { type: 0, key: { id: targetId, remoteJid: 'status@broadcast' } } },
	};
}

describe('a story deleted by its poster', () => {
	it('provider: drops it from the story cache and emits status_deleted', async () => {
		const provider = new BaileysProvider('account-revoke') as any;
		provider.state = 'connected';
		provider.socket = { user: { id: '201099999999:1@s.whatsapp.net' } };
		provider.rememberStatus(storyRaw('STORY-A'));
		provider.rememberStatus(storyRaw('STORY-B'));
		const events: any[] = [];
		provider.onEvent((event: any) => events.push(event));

		expect(provider.ingestRevoke(revokeRaw('STORY-A'))).toBe(true);

		const ids = (await provider.getStatuses()).map((s: any) => s.messageId);
		expect(ids).toEqual(['STORY-B']);
		const deleted = events.find(event => event.type === 'status_deleted');
		expect(deleted).toMatchObject({ statusMessageId: 'STORY-A' });
		expect(deleted.at).toBeInstanceOf(Date);
		// not treated as a chat message deletion
		expect(events.some(event => event.type === 'message_deleted')).toBe(false);
	});

	it('service: removes the live row and marks the history copy deleted', async () => {
		const live = {
			id: 'row-a',
			accountId: ACCOUNT,
			providerStatusId: `false_status@broadcast_STORY-A_${POSTER}`,
			senderWaId: POSTER,
			type: 'image',
			caption: null,
			isOwn: false,
			publishedAt: new Date(),
			expiresAt: new Date(Date.now() + 3_600_000),
			mediaPath: '/m/a.jpg',
		};
		// A LIKE match can also return another story whose id merely contains this one.
		const lookalike = { ...live, id: 'row-b', providerStatusId: `false_status@broadcast_STORY-AB_${POSTER}` };
		const qb: any = {
			where: jest.fn(() => qb),
			andWhere: jest.fn(() => qb),
			getMany: jest.fn(async () => [live, lookalike]),
		};
		const repo = { createQueryBuilder: jest.fn(() => qb), delete: jest.fn(async () => undefined) };
		const updateQb: any = {
			update: jest.fn(() => updateQb),
			set: jest.fn(() => updateQb),
			where: jest.fn(() => updateQb),
			andWhere: jest.fn(() => updateQb),
			execute: jest.fn(async () => ({ affected: 1 })),
		};
		const historyRepo = { upsert: jest.fn(async () => undefined), createQueryBuilder: jest.fn(() => updateQb) };
		const service = new WhatsAppStatusService(
			repo as any,
			historyRepo as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{ emitAccountEvent: jest.fn() } as any,
		);
		const at = new Date('2026-11-12T10:00:00Z');

		const removed = await service.markStatusDeletedByPoster(ACCOUNT, 'STORY-A', at);

		expect(removed).toBe(1);
		expect(historyRepo.upsert).toHaveBeenCalledWith(
			[expect.objectContaining({ providerStatusId: live.providerStatusId })],
			['accountId', 'providerStatusId'],
		);
		expect(repo.delete).toHaveBeenCalledWith(['row-a']);
		expect(updateQb.set).toHaveBeenCalledWith({ revokedAt: at });
	});

	it('sync: hands the deletion to the status service and tells the web', async () => {
		const statusService = { markStatusDeletedByPoster: jest.fn(async () => 1) };
		const gateway = { emitAccountEvent: jest.fn() };
		const self: any = Object.create(WhatsAppSyncService.prototype);
		Object.assign(self, {
			statusService,
			gateway,
			logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
			enqueuePersist: jest.fn((task: () => Promise<void>) => task()),
		});
		const at = new Date();

		await (WhatsAppSyncService.prototype as any).handleProviderEvent.call(self, ACCOUNT, {
			type: 'status_deleted',
			statusMessageId: 'STORY-A',
			at,
		});
		await new Promise(resolve => setImmediate(resolve));

		expect(statusService.markStatusDeletedByPoster).toHaveBeenCalledWith(ACCOUNT, 'STORY-A', at);
		expect(gateway.emitAccountEvent).toHaveBeenCalledWith(ACCOUNT, 'statuses_updated', {
			reason: 'status_deleted',
			statusMessageId: 'STORY-A',
			removed: 1,
		});
	});
});
