import {
	BadRequestException,
	ForbiddenException,
	NotFoundException,
} from '@nestjs/common';
import { WhatsAppStatusService } from './whatsapp-status.service';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OWN_ID = '22222222-2222-4222-8222-222222222222';
const THEIRS_ID = '33333333-3333-4333-8333-333333333333';

function statusRow(overrides: Record<string, any> = {}) {
	return {
		id: OWN_ID,
		accountId: ACCOUNT,
		providerStatusId: 'true_status@broadcast_STORYOWN_201000000000@c.us',
		senderWaId: '201000000000@c.us',
		type: 'image',
		caption: 'Sunset',
		isOwn: true,
		publishedAt: new Date(),
		expiresAt: new Date(Date.now() + 60 * 60_000),
		mediaPath: null,
		...overrides,
	};
}

function createService(options: {
	active?: any[];
	history?: any[];
	viewers?: any[];
	reactions?: any[];
	contacts?: any[];
	lidPhones?: Record<string, string>;
} = {}) {
	const active = options.active ?? [statusRow()];
	const history = options.history ?? [];
	const queries: Array<{ sql: string; params: any[] }> = [];
	const query = jest.fn(async (sql: string, params: any[] = []) => {
		queries.push({ sql, params });
		if (/FROM whatsapp_status_viewers\s+WHERE account_id = \$1 AND status_message_id = \$2/.test(sql)) {
			return options.viewers ?? [];
		}
		if (/SELECT actor_key, emoji, reacted_at FROM whatsapp_status_reactions/.test(sql)) {
			return options.reactions ?? [];
		}
		if (/SELECT status_message_id, actor_key, emoji, message_id, reacted_at/.test(sql)) {
			const [, statusMessageId, actorKey] = params;
			const hit = (options.reactions ?? []).find(
				row => row.actor_key === actorKey && (row.status_message_id ?? statusMessageId) === statusMessageId,
			);
			return hit ? [{ status_message_id: statusMessageId, message_id: null, ...hit }] : [];
		}
		if (/COUNT\(DISTINCT actor\)/.test(sql)) {
			return [{ status_message_id: params[1][0], viewer_count: 2, reaction_count: 1 }];
		}
		if (/SELECT status_message_id, actor_key, emoji FROM whatsapp_status_reactions/.test(sql)) {
			return [
				{ status_message_id: 'STORYTHEIRS', actor_key: 'me', emoji: '🔥' },
				{ status_message_id: 'STORYTHEIRS', actor_key: 'me:like', emoji: '💚' },
			];
		}
		return [];
	});
	const findIn = (rows: any[]) => async ({ where }: any) =>
		rows.find(
			row =>
				row.accountId === where.accountId &&
				((where.id && row.id === where.id) ||
					(where.providerStatusId && row.providerStatusId === where.providerStatusId)),
		) || null;
	const repo = { findOne: jest.fn(findIn(active)), manager: { query } };
	const historyRepo = { findOne: jest.fn(findIn(history)) };
	const contactRepo = {
		findOne: jest.fn(async ({ where }: any) =>
			(options.contacts ?? []).find(contact => contact.waId === where.waId) || null,
		),
		find: jest.fn(async () => options.contacts ?? []),
		update: jest.fn().mockResolvedValue(undefined),
	};
	const access = { assertAccountPermission: jest.fn().mockResolvedValue(undefined) };
	const provider = {
		getState: () => 'connected',
		resolveContactIdentity: jest.fn(async (jid: string) =>
			options.lidPhones?.[jid] ? { phoneNumber: options.lidPhones[jid] } : null,
		),
	};
	const providers = { getProvider: jest.fn(() => provider) };
	const gateway = { emitAccountEvent: jest.fn() };
	const service = new WhatsAppStatusService(
		repo as any,
		historyRepo as any,
		contactRepo as any,
		{} as any,
		access as any,
		providers as any,
		{} as any,
		gateway as any,
	);
	return { service, query, queries, access, gateway, contactRepo, provider };
}

const user = { id: 'user-1' } as any;

describe('WhatsAppStatusService story viewers', () => {
	it('lists viewers with their reaction, merging a LID receipt into the phone contact', async () => {
		const { service } = createService({
			viewers: [
				{ viewer_key: '201111111111@s.whatsapp.net', viewed_at: '2026-10-13T10:00:00Z' },
				{ viewer_key: '987654@lid', viewed_at: '2026-10-13T09:00:00Z' },
			],
			reactions: [
				{ actor_key: '201222222222@s.whatsapp.net', emoji: '😍', reacted_at: '2026-10-13T11:00:00Z' },
			],
			contacts: [
				{ waId: '201111111111@c.us', name: 'Mona', phoneNumber: '201111111111', avatarUrl: 'https://a/m.jpg' },
				{ waId: '987654@lid', name: 'Omar', phoneNumber: null, avatarUrl: null },
				{ waId: '201222222222@c.us', name: 'Omar', phoneNumber: '201222222222', avatarUrl: null },
			],
			lidPhones: { '987654@lid': '201222222222' },
		});

		const result = await service.listStatusViewers(user, ACCOUNT, OWN_ID);

		expect(result.viewerCount).toBe(2);
		expect(result.reactionCount).toBe(1);
		expect(result.viewers.map(viewer => [viewer.name, viewer.phone, viewer.reaction])).toEqual([
			['Omar', '201222222222', '😍'],
			['Mona', '201111111111', null],
		]);
		expect(result.viewers[0].viewedAt).toEqual(new Date('2026-10-13T09:00:00Z'));
		expect(result.viewers[1].avatarUrl).toBe('https://a/m.jpg');
	});

	it('returns an empty list for an own story nobody opened yet', async () => {
		const { service } = createService();
		const result = await service.listStatusViewers(user, ACCOUNT, OWN_ID);
		expect(result).toMatchObject({ viewerCount: 0, reactionCount: 0, viewers: [] });
	});

	it("refuses to reveal viewers of someone else's story", async () => {
		const { service, queries } = createService({
			active: [statusRow({ id: THEIRS_ID, isOwn: false, providerStatusId: 'false_status@broadcast_X_2019@c.us' })],
		});
		await expect(service.listStatusViewers(user, ACCOUNT, THEIRS_ID)).rejects.toBeInstanceOf(
			ForbiddenException,
		);
		expect(queries.some(item => /whatsapp_status_viewers/.test(item.sql))).toBe(false);
	});

	it('checks account access before touching data and 404s unknown stories', async () => {
		const denied = createService();
		denied.access.assertAccountPermission.mockRejectedValueOnce(new ForbiddenException('nope'));
		await expect(denied.service.listStatusViewers(user, ACCOUNT, OWN_ID)).rejects.toBeInstanceOf(
			ForbiddenException,
		);
		expect(denied.query).not.toHaveBeenCalled();

		const { service } = createService({ active: [] });
		await expect(service.listStatusViewers(user, ACCOUNT, OWN_ID)).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it('still lets the owner see viewers of an archived story', async () => {
		const { service } = createService({
			active: [],
			history: [statusRow()],
			viewers: [{ viewer_key: '201111111111@s.whatsapp.net', viewed_at: '2026-10-13T10:00:00Z' }],
		});
		const result = await service.listStatusViewers(user, ACCOUNT, OWN_ID);
		expect(result.viewerCount).toBe(1);
	});

	it('reposts a text story with edited copy', async () => {
		const { service } = createService({
			active: [statusRow({ type: 'text', caption: 'Original line' })],
		});
		const publish = jest.spyOn(service, 'publish').mockResolvedValue({ ok: true, items: [] } as any);
		await service.repost(user, ACCOUNT, OWN_ID, { text: 'My version' });
		expect(publish).toHaveBeenCalledWith(user, ACCOUNT, {
			type: 'text',
			content: 'My version',
		});
	});

	it('keeps the original text when a text repost has no new copy', async () => {
		const { service } = createService({
			active: [statusRow({ type: 'text', caption: 'Keep me' })],
		});
		const publish = jest.spyOn(service, 'publish').mockResolvedValue({ ok: true, items: [] } as any);
		await service.repost(user, ACCOUNT, OWN_ID, {});
		expect(publish).toHaveBeenCalledWith(user, ACCOUNT, {
			type: 'text',
			content: 'Keep me',
		});
	});

	it('persists viewers already on the live status message before listing', async () => {
		const { service, queries, provider } = createService({
			viewers: [{ viewer_key: '201111111111@s.whatsapp.net', viewed_at: '2026-10-13T10:00:00Z' }],
		});
		(provider as any).getOwnStatusReceipts = jest.fn(async () => [
			{ participantJid: '201555555555@s.whatsapp.net', readAt: new Date('2026-04-20T20:07:00Z') },
			{ participantJid: '201666666666@s.whatsapp.net', readAt: new Date('2026-04-20T20:08:00Z') },
		]);
		await service.listStatusViewers(user, ACCOUNT, OWN_ID);
		const insert = queries.find(item => /INSERT INTO whatsapp_status_viewers/.test(item.sql));
		expect(insert?.params).toEqual([
			ACCOUNT,
			'STORYOWN',
			'201555555555@s.whatsapp.net',
			new Date('2026-04-20T20:07:00Z'),
			ACCOUNT,
			'STORYOWN',
			'201666666666@s.whatsapp.net',
			new Date('2026-04-20T20:08:00Z'),
		]);
	});
});

describe('WhatsAppStatusService recording interactions', () => {
	it('upserts one row per viewer, keeps the earliest view and emits totals only', async () => {
		const { service, queries, gateway } = createService({ lidPhones: { '555@lid': '201333333333' } });
		await service.recordStatusViewers(ACCOUNT, 'true_status@broadcast_STORYOWN_201000000000@c.us', [
			{ participantJid: '201111111111@s.whatsapp.net', readAt: new Date('2026-10-13T10:05:00Z') },
			{ participantJid: '201111111111:4@s.whatsapp.net', readAt: new Date('2026-10-13T10:00:00Z') },
			{ participantJid: '555@lid', readAt: new Date('2026-10-13T10:01:00Z') },
			{ participantJid: '201444444444@s.whatsapp.net', deliveredAt: new Date() },
		]);
		const insert = queries.find(item => /INSERT INTO whatsapp_status_viewers/.test(item.sql))!;
		expect(insert.params).toEqual([
			ACCOUNT,
			'STORYOWN',
			'201111111111@s.whatsapp.net',
			new Date('2026-10-13T10:00:00Z'),
			ACCOUNT,
			'STORYOWN',
			'201333333333@s.whatsapp.net',
			new Date('2026-10-13T10:01:00Z'),
		]);
		expect(insert.sql).toMatch(/ON CONFLICT \(account_id, status_message_id, viewer_key\)/);
		expect(gateway.emitAccountEvent).toHaveBeenCalledWith(ACCOUNT, 'status_interactions_updated', {
			statusMessageId: 'STORYOWN',
			viewerCount: 2,
			reactionCount: 1,
		});
		const payload = JSON.stringify(gateway.emitAccountEvent.mock.calls);
		expect(payload).not.toMatch(/201111111111|201333333333/);
	});

	it('folds rows stored under a LID onto the phone key once the number is known', async () => {
		const { service, queries } = createService({ lidPhones: { '555@lid': '201333333333' } });
		await service.recordStatusViewers(ACCOUNT, 'STORYOWN', [
			{ participantJid: '555@lid', readAt: new Date('2026-10-13T10:01:00Z') },
		]);
		const moves = queries.filter(item => /SELECT account_id, status_message_id, \$3/.test(item.sql));
		expect(moves).toHaveLength(2);
		for (const move of moves) {
			expect(move.params).toEqual([ACCOUNT, '555@lid', '201333333333@s.whatsapp.net']);
		}
		const removals = queries.filter(item => /^UPDATE whatsapp_status_(viewers|reactions) SET deleted_at/.test(item.sql.trim()));
		expect(removals).toHaveLength(2);

		queries.length = 0;
		await service.recordStatusViewers(ACCOUNT, 'STORYOWN', [
			{ participantJid: '555@lid', readAt: new Date('2026-10-13T10:02:00Z') },
		]);
		expect(queries.some(item => /SELECT account_id, status_message_id, \$3/.test(item.sql))).toBe(false);
	});

	it('does nothing when no receipt is a view', async () => {
		const { service, query, gateway } = createService();
		await service.recordStatusViewers(ACCOUNT, 'STORYOWN', [
			{ participantJid: '201111111111@s.whatsapp.net', deliveredAt: new Date() },
		]);
		expect(query).not.toHaveBeenCalled();
		expect(gateway.emitAccountEvent).not.toHaveBeenCalled();
	});

	it('stores our own reaction under actor "me" and reports it back', async () => {
		const { service, queries, gateway } = createService({
			reactions: [{ actor_key: 'me', emoji: '🔥', status_message_id: 'STORYTHEIRS', reacted_at: new Date() }],
		});
		const row = await service.saveStatusReaction(ACCOUNT, 'STORYTHEIRS', 'me', '🔥', null, new Date());
		const insert = queries.find(item => /INSERT INTO whatsapp_status_reactions/.test(item.sql))!;
		expect(insert.params.slice(0, 4)).toEqual([ACCOUNT, 'STORYTHEIRS', 'me', '🔥']);
		expect(insert.sql).toMatch(/ON CONFLICT \(account_id, status_message_id, actor_key\)/);
		expect(row?.emoji).toBe('🔥');
		expect(gateway.emitAccountEvent.mock.calls[0][2]).toMatchObject({ myReaction: '🔥' });
	});
});

describe('WhatsAppStatusService reply/react targets', () => {
	const theirs = (overrides: Record<string, any> = {}) =>
		statusRow({
			id: THEIRS_ID,
			isOwn: false,
			providerStatusId: 'false_status@broadcast_STORYTHEIRS_201555555555@c.us',
			senderWaId: '201555555555@c.us',
			...overrides,
		});

	it('requires send permission and returns the poster chat plus the story quote', async () => {
		const { service, access } = createService({
			active: [theirs()],
			contacts: [{ waId: '201555555555@c.us', name: 'Sara', phoneNumber: '201555555555' }],
		});
		const target = await service.resolveStatusInteractionTarget(user, ACCOUNT, THEIRS_ID);
		expect(access.assertAccountPermission).toHaveBeenCalledWith(user, ACCOUNT, 'canUse');
		expect(target).toEqual({
			statusId: THEIRS_ID,
			ownerJid: '201555555555@c.us',
			title: 'Sara',
			statusQuote: {
				statusMessageId: 'STORYTHEIRS',
				providerStatusId: 'false_status@broadcast_STORYTHEIRS_201555555555@c.us',
				ownerJid: '201555555555@c.us',
				type: 'image',
				caption: 'Sunset',
			},
		});
	});

	it('answers a LID poster in their phone chat when the number is known', async () => {
		const { service } = createService({
			active: [theirs({ senderWaId: '777@lid' })],
			lidPhones: { '777@lid': '201666666666' },
		});
		const target = await service.resolveStatusInteractionTarget(user, ACCOUNT, THEIRS_ID);
		expect(target.ownerJid).toBe('201666666666@c.us');
		expect(target.statusQuote.ownerJid).toBe('777@lid');
	});

	it('rejects own, expired and archived stories', async () => {
		await expect(
			createService().service.resolveStatusInteractionTarget(user, ACCOUNT, OWN_ID),
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			createService({ active: [theirs({ expiresAt: new Date(Date.now() - 1000) })] }).service
				.resolveStatusInteractionTarget(user, ACCOUNT, THEIRS_ID),
		).rejects.toThrow('This story has expired');
		await expect(
			createService({ active: [], history: [theirs()] }).service.resolveStatusInteractionTarget(
				user,
				ACCOUNT,
				THEIRS_ID,
			),
		).rejects.toThrow('This story has expired');
	});
});

describe('WhatsAppStatusService list totals', () => {
	it('adds view totals to own stories and my reaction to others', async () => {
		const { service } = createService();
		const items = await (service as any).withStatusInteractions(ACCOUNT, [
			{ providerStatusId: 'true_status@broadcast_STORYOWN_2010@c.us', isOwn: true },
			{ providerStatusId: 'false_status@broadcast_STORYTHEIRS_2015@c.us', isOwn: false },
		]);
		expect(items[0]).toMatchObject({ viewerCount: 2, reactionCount: 1 });
		expect(items[0].myReaction).toBeUndefined();
		expect(items[1]).toMatchObject({ myReaction: '🔥', myLiked: true });
		expect(items[1].viewerCount).toBeUndefined();
	});

	it('never fails the story list when totals cannot be read', async () => {
		const { service, query } = createService();
		query.mockRejectedValue(new Error('relation does not exist'));
		const input = [{ providerStatusId: 'true_status@broadcast_A_1@c.us', isOwn: true }];
		await expect((service as any).withStatusInteractions(ACCOUNT, input)).resolves.toEqual(input);
	});
});
