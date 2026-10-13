jest.mock('./whatsapp-sync.service', () => ({ WhatsAppSyncService: class {} }));
jest.mock('./whatsapp-provider-manager.service', () => ({ WhatsAppProviderManagerService: class {} }));
jest.mock('./whatsapp-access.service', () => ({ WhatsAppAccessService: class {} }));
jest.mock('./whatsapp-audit.service', () => ({ WhatsAppAuditService: class {} }));

import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	HttpException,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { WhatsAppContactsService } from './whatsapp-contacts.service';
import { WhatsAppProviderUnavailableError } from '../providers/whatsapp-provider';
import { resetSendRateLimit } from '../utils/whatsapp-send-rate-limit';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT = '22222222-2222-4222-8222-222222222222';
const owner = { id: 'user-owner' } as any;
const viewer = { id: 'user-viewer' } as any;

function matches(row: any, where: Record<string, any>) {
	return Object.entries(where).every(([key, expected]) => {
		if (expected && typeof expected === 'object' && Array.isArray(expected._value)) {
			return expected._value.includes(row[key]);
		}
		return row[key] === expected;
	});
}

function chain(result: { execute?: any; getOne?: any; getMany?: any }) {
	const qb: any = new Proxy(
		{},
		{
			get(_target, prop) {
				if (prop === 'execute') return async () => result.execute ?? { affected: 1 };
				if (prop === 'getOne') return async () => result.getOne ?? null;
				if (prop === 'getMany') return async () => result.getMany ?? [];
				if (prop === 'getManyAndCount') return async () => [result.getMany ?? [], 0];
				if (prop === 'then') return undefined;
				return () => qb;
			},
		},
	);
	return qb;
}

function setup(options: { provider?: any; conversations?: any[] } = {}) {
	const rows = new Map<string, any>();
	let nextId = 1;
	const claim = { affected: 1 };
	const contactRepo: any = {
		rows,
		claim,
		create: (data: any) => ({
			isSaved: false,
			localName: null,
			notes: null,
			source: 'whatsapp',
			waRegistration: null,
			waCheckedAt: null,
			waSyncStatus: 'not_requested',
			waSyncOp: null,
			waSyncError: null,
			waSyncAttempts: 0,
			waSyncNextAt: null,
			waSyncedAt: null,
			deleted_at: null,
			...data,
		}),
		save: jest.fn(async (row: any) => {
			const saved = { ...row, id: row.id || `contact-${nextId++}`, created_at: new Date() };
			rows.set(saved.id, saved);
			return saved;
		}),
		findOne: async ({ where }: any) => [...rows.values()].find((row) => matches(row, where)) || null,
		findOneOrFail: async ({ where }: any) => {
			const row = [...rows.values()].find((r) => matches(r, where));
			if (!row) throw new Error('not found');
			return { ...row };
		},
		find: async ({ where }: any) => [...rows.values()].filter((row) => matches(row, where)),
		update: jest.fn(async (criteria: any, patch: any) => {
			const targets =
				typeof criteria === 'string'
					? [rows.get(criteria)].filter(Boolean)
					: [...rows.values()].filter((row) => matches(row, criteria));
			for (const row of targets) Object.assign(row, patch);
			return { affected: targets.length };
		}),
		delete: jest.fn(async (criteria: any) => {
			for (const row of [...rows.values()]) if (matches(row, criteria)) rows.delete(row.id);
		}),
		restore: jest.fn(),
		createQueryBuilder: () => chain({ execute: claim }),
	};
	const conversations = options.conversations || [];
	const conversationRepo: any = {
		find: async ({ where }: any) =>
			conversations.filter(
				(c) => c.accountId === where.accountId && where.contactId._value.includes(c.contactId),
			),
		createQueryBuilder: () => chain({}),
	};
	const accessFor: Record<string, any> = {
		[`${owner.id}:${ACCOUNT}`]: { canView: true, canUse: true, canManage: true },
		[`${viewer.id}:${ACCOUNT}`]: { canView: true, canUse: false, canManage: false },
	};
	const access: any = {
		getAccountAccess: jest.fn(async (user: any, accountId: string) => {
			const grant = accessFor[`${user.id}:${accountId}`];
			if (!grant) throw new ForbiddenException('WhatsApp account access denied');
			return { account: { id: accountId, phoneNumber: '97455500000' }, ...grant };
		}),
		canSeeAllConversations: (_user: any, grant: any) => Boolean(grant.canManage),
	};
	const providers: any = {
		getProvider: jest.fn(() => options.provider ?? null),
		connect: jest.fn(),
		providerForManualSync: jest.fn(),
	};
	const sync: any = {
		openConversationByChatId: jest.fn(async (_user: any, _account: string, chatId: string, opts: any) => ({
			id: 'conv-1',
			providerChatId: chatId,
			title: opts?.title ?? null,
		})),
	};
	const audit: any = { write: jest.fn(async () => undefined) };
	const service = new WhatsAppContactsService(contactRepo, conversationRepo, access, providers, sync, audit);
	(service as any).logger = { log: jest.fn(), warn: jest.fn() };
	(service as any).findByDigits = async (accountId: string, digits: string) =>
		[...rows.values()]
			.filter(
				(row) =>
					row.accountId === accountId &&
					(String(row.phoneNumber || '').replace(/\D/g, '') === digits ||
						[`${digits}@c.us`, `${digits}@s.whatsapp.net`].includes(row.waId)),
			)
			.sort((a, b) => Number(b.isSaved) - Number(a.isSaved));
	(service as any).existingDirectConversation = async (accountId: string, digits: string) =>
		conversations.find(
			(c) => c.accountId === accountId && c.providerChatId === `${digits}@c.us`,
		) || null;
	return { service, rows, contactRepo, providers, sync, audit, access };
}

function liveProvider(overrides: Record<string, any> = {}) {
	return {
		getState: () => 'connected',
		connect: jest.fn(),
		checkWhatsAppNumbers: jest.fn(async (digits: string[]) =>
			digits.map((d) => ({ phoneDigits: d, exists: true, chatId: `${d}@c.us` })),
		),
		getNumberProfile: jest.fn(async () => ({
			picture: { status: 'available', url: 'https://pps.whatsapp.net/pic.jpg' },
			about: { status: 'hidden', text: null, setAt: null },
			business: { status: 'not_business' },
			pushName: 'Profile Name',
			savedName: null,
		})),
		saveContactToWhatsApp: jest.fn(async () => undefined),
		removeContactFromWhatsApp: jest.fn(async () => undefined),
		...overrides,
	};
}

async function expectError(promise: Promise<unknown>, type: any, code?: string) {
	const error: any = await promise.then(
		() => null,
		(e) => e,
	);
	expect(error).toBeInstanceOf(type);
	if (code) expect(error.getResponse().code).toBe(code);
	return error;
}

beforeEach(() => resetSendRateLimit());

describe('contacts: add and validate', () => {
	it('saves a valid international number in canonical form', async () => {
		const { service, rows, audit } = setup();
		const contact = await service.create(owner, ACCOUNT, {
			phone: '+974 5550 0101',
			name: '  Ali  ',
			notes: 'Supplier',
		});
		expect(contact.phone?.e164).toBe('+97455500101');
		expect(contact.displayName).toBe('Ali');
		expect(contact.isSaved).toBe(true);
		expect(contact.source).toBe('manual');
		expect(contact.sync.status).toBe('not_requested');
		const row = [...rows.values()][0];
		expect(row.waId).toBe('97455500101@c.us');
		expect(row.phoneNumber).toBe('97455500101');
		const metadata = JSON.stringify(audit.write.mock.calls[0][0]);
		expect(metadata).not.toContain('97455500101');
		expect(metadata).not.toContain('Ali');
	});

	it('accepts 00 prefixes, Arabic digits and the account country for local numbers', async () => {
		const { service } = setup();
		const a = await service.create(owner, ACCOUNT, { phone: '00974 5550 0102', name: 'A' });
		const b = await service.create(owner, ACCOUNT, { phone: '٥٥٥٠٠١٠٣', name: 'B' });
		expect(a.phone?.digits).toBe('97455500102');
		expect(b.phone?.digits).toBe('97455500103');
	});

	it('rejects invalid numbers with a specific reason', async () => {
		const { service, rows } = setup();
		await expectError(service.create(owner, ACCOUNT, { phone: '+974 12', name: 'X' }), BadRequestException, 'PHONE_INVALID');
		await expectError(service.create(owner, ACCOUNT, { phone: 'abc', name: 'X' }), BadRequestException);
		await expectError(service.create(owner, ACCOUNT, { phone: '+97455500104', name: '   ' }), BadRequestException, 'NAME_REQUIRED');
		expect(rows.size).toBe(0);
	});
});

describe('contacts: lookup', () => {
	it('returns registered numbers with only the profile fields WhatsApp shared', async () => {
		const provider = liveProvider();
		const { service } = setup({ provider });
		const result = await service.lookup(owner, ACCOUNT, { phone: '+97455500201' });
		expect(provider.checkWhatsAppNumbers).toHaveBeenCalledWith(['97455500201']);
		expect(result.registration.status).toBe('registered');
		expect(result.canStartChat).toBe(true);
		expect(result.profile?.picture).toEqual({ status: 'available', url: 'https://pps.whatsapp.net/pic.jpg' });
		expect(result.profile?.about.status).toBe('hidden');
		expect(result.profile?.pushName).toBe('Profile Name');
		expect(result.contact).toBeNull();
	});

	it('reports a hidden picture as hidden, not as an error or a fake avatar', async () => {
		const provider = liveProvider({
			getNumberProfile: jest.fn(async () => ({
				picture: { status: 'hidden', url: null },
				about: { status: 'available', text: 'Busy', setAt: null },
				business: { status: 'available', description: 'Shop', category: null, email: null, websites: [], address: null },
				pushName: null,
				savedName: null,
			})),
		});
		const { service } = setup({ provider });
		const result = await service.lookup(owner, ACCOUNT, { phone: '+97455500202' });
		expect(result.profile?.picture).toEqual({ status: 'hidden', url: null });
		expect(result.profile?.business).toMatchObject({ status: 'available', description: 'Shop' });
		expect(result.profile?.pushName).toBeNull();
	});

	it('reports not registered only when WhatsApp says so', async () => {
		const provider = liveProvider({
			checkWhatsAppNumbers: jest.fn(async (d: string[]) => d.map((x) => ({ phoneDigits: x, exists: false, chatId: null }))),
		});
		const { service } = setup({ provider });
		const result = await service.lookup(owner, ACCOUNT, { phone: '+97455500203' });
		expect(result.registration.status).toBe('not_registered');
		expect(result.profile).toBeNull();
		expect(result.canStartChat).toBe(false);
		expect(provider.getNumberProfile).not.toHaveBeenCalled();
	});

	it('returns "unknown" with a reason when the check cannot be completed', async () => {
		const offline = setup({ provider: null });
		const a = await offline.service.lookup(owner, ACCOUNT, { phone: '+97455500204' });
		expect(a.registration).toMatchObject({ status: 'unknown', reason: 'not_connected' });
		expect(a.canStartChat).toBe(false);

		const failing = setup({
			provider: liveProvider({ checkWhatsAppNumbers: jest.fn(async () => Promise.reject(new Error('timed out'))) }),
		});
		const b = await failing.service.lookup(owner, ACCOUNT, { phone: '+97455500205' });
		expect(b.registration).toMatchObject({ status: 'unknown', reason: 'error' });

		const unsupported = setup({ provider: { getState: () => 'connected' } });
		const c = await unsupported.service.lookup(owner, ACCOUNT, { phone: '+97455500206' });
		expect(c.registration).toMatchObject({ status: 'unknown', reason: 'unsupported' });
	});

	it('never connects or restarts the session and caches repeat lookups', async () => {
		const provider = liveProvider();
		const { service, providers } = setup({ provider });
		await Promise.all([
			service.lookup(owner, ACCOUNT, { phone: '+97455500207' }),
			service.lookup(owner, ACCOUNT, { phone: '+97455500207' }),
		]);
		await service.lookup(owner, ACCOUNT, { phone: '+974 5550 0207' });
		expect(provider.checkWhatsAppNumbers).toHaveBeenCalledTimes(1);
		expect(provider.connect).not.toHaveBeenCalled();
		expect(providers.connect).not.toHaveBeenCalled();
		expect(providers.providerForManualSync).not.toHaveBeenCalled();

		const offline = setup({ provider: { getState: () => 'disconnected', connect: jest.fn() } });
		await offline.service.lookup(owner, ACCOUNT, { phone: '+97455500208' });
		expect(offline.providers.getProvider).toHaveBeenCalled();
		expect((offline.providers.getProvider.mock.results[0].value as any).connect).not.toHaveBeenCalled();
	});

	it('rate-limits lookups per user', async () => {
		const previous = process.env.WHATSAPP_ENFORCE_SEND_RATE_LIMIT;
		process.env.WHATSAPP_ENFORCE_SEND_RATE_LIMIT = '1';
		try {
			const { service } = setup({ provider: liveProvider() });
			for (let i = 0; i < 15; i += 1) {
				await service.lookup(owner, ACCOUNT, { phone: `+9745550${String(1000 + i)}` });
			}
			await expectError(service.lookup(owner, ACCOUNT, { phone: '+97455509999' }), HttpException);
		} finally {
			if (previous == null) delete process.env.WHATSAPP_ENFORCE_SEND_RATE_LIMIT;
			else process.env.WHATSAPP_ENFORCE_SEND_RATE_LIMIT = previous;
		}
	});

	it('shows the saved contact for a number that already exists', async () => {
		const { service } = setup({ provider: liveProvider() });
		await service.create(owner, ACCOUNT, { phone: '+97455500209', name: 'Saved Name' });
		const result = await service.lookup(owner, ACCOUNT, { phone: '0097455500209' });
		expect(result.contact).toMatchObject({ displayName: 'Saved Name', isSaved: true });
		// WhatsApp's profile name is reported separately, never as the saved name.
		expect(result.profile?.pushName).toBe('Profile Name');
		expect(result.contact?.avatarUrl).toBe('https://pps.whatsapp.net/pic.jpg');
	});
});

describe('contacts: save, duplicates, update', () => {
	it('saves a lookup result with its verified registration', async () => {
		const { service } = setup({ provider: liveProvider() });
		await service.lookup(owner, ACCOUNT, { phone: '+97455500301' });
		const contact = await service.create(owner, ACCOUNT, {
			phone: '+97455500301',
			name: 'From lookup',
			source: 'lookup',
		});
		expect(contact.source).toBe('lookup');
		expect(contact.registration.status).toBe('registered');
	});

	it('refuses a second saved contact for the same number in any format', async () => {
		const { service, rows } = setup();
		await service.create(owner, ACCOUNT, { phone: '+97455500302', name: 'First' });
		const error = await expectError(
			service.create(owner, ACCOUNT, { phone: '00974 5550 0302', name: 'Second' }),
			ConflictException,
			'DUPLICATE_CONTACT',
		);
		expect(error.getResponse().contact.displayName).toBe('First');
		expect(rows.size).toBe(1);
	});

	it('promotes a WhatsApp-synced row instead of creating a duplicate', async () => {
		const { service, rows, contactRepo } = setup();
		rows.set('synced', contactRepo.create({
			id: 'synced',
			accountId: ACCOUNT,
			waId: '97455500303@c.us',
			phoneNumber: '97455500303',
			name: 'Push name',
			source: 'whatsapp',
		}));
		const contact = await service.create(owner, ACCOUNT, { phone: '+97455500303', name: 'My name' });
		expect(contact.id).toBe('synced');
		expect(contact.source).toBe('whatsapp');
		expect(rows.size).toBe(1);
	});

	it('updates name and notes and re-syncs a contact already in WhatsApp', async () => {
		const provider = liveProvider();
		const { service } = setup({ provider });
		const created = await service.create(owner, ACCOUNT, {
			phone: '+97455500304',
			name: 'Old',
			syncToWhatsApp: true,
		});
		expect(created.sync.status).toBe('synced');
		const updated = await service.update(owner, ACCOUNT, created.id, { name: 'New', notes: 'VIP' });
		expect(updated).toMatchObject({ displayName: 'New', notes: 'VIP' });
		expect(provider.saveContactToWhatsApp).toHaveBeenLastCalledWith('97455500304@c.us', { fullName: 'New' });
		const notesOnly = await service.update(owner, ACCOUNT, created.id, { notes: '' });
		expect(notesOnly.notes).toBeNull();
		expect(provider.saveContactToWhatsApp).toHaveBeenCalledTimes(2);
	});
});

describe('contacts: start chat', () => {
	it('opens the existing contact chat with the JID WhatsApp verified', async () => {
		const provider = liveProvider({
			checkWhatsAppNumbers: jest.fn(async (d: string[]) => d.map((x) => ({ phoneDigits: x, exists: true, chatId: `${x}@c.us` }))),
		});
		const conversations = [{ id: 'conv-1', accountId: ACCOUNT, providerChatId: '97455500401@c.us', contactId: 'x' }];
		const { service, sync } = setup({ provider, conversations });
		const contact = await service.create(owner, ACCOUNT, { phone: '+97455500401', name: 'Existing' });
		const result = await service.startChat(owner, ACCOUNT, { contactId: contact.id });
		expect(sync.openConversationByChatId).toHaveBeenCalledWith(owner, ACCOUNT, '97455500401@c.us', { title: 'Existing' });
		expect(result).toMatchObject({ verified: true, created: false });
	});

	it('opens a brand-new chat for a registered number', async () => {
		const { service, sync } = setup({ provider: liveProvider() });
		const result = await service.startChat(owner, ACCOUNT, { phone: '+97455500402' });
		expect(sync.openConversationByChatId).toHaveBeenCalledWith(owner, ACCOUNT, '97455500402@c.us', { title: null });
		expect(result).toMatchObject({ verified: true, created: true });
	});

	it('refuses unregistered numbers and never fabricates a chat', async () => {
		const provider = liveProvider({
			checkWhatsAppNumbers: jest.fn(async (d: string[]) => d.map((x) => ({ phoneDigits: x, exists: false, chatId: null }))),
		});
		const { service, sync } = setup({ provider });
		await expectError(service.startChat(owner, ACCOUNT, { phone: '+97455500403' }), BadRequestException, 'NOT_ON_WHATSAPP');
		expect(sync.openConversationByChatId).not.toHaveBeenCalled();
	});

	it('only reopens an existing thread when the number cannot be verified', async () => {
		const conversations = [{ id: 'conv-9', accountId: ACCOUNT, providerChatId: '97455500404@c.us', contactId: null }];
		const { service, sync } = setup({ provider: null, conversations });
		const reopened = await service.startChat(owner, ACCOUNT, { phone: '+97455500404' });
		expect(reopened).toMatchObject({ verified: false, created: false });
		await expectError(service.startChat(owner, ACCOUNT, { phone: '+97455500405' }), ServiceUnavailableException, 'UNABLE_TO_VERIFY');
		expect(sync.openConversationByChatId).toHaveBeenCalledTimes(1);
	});
});

describe('contacts: WhatsApp contact-list sync', () => {
	it('marks synced only after WhatsApp confirms the write', async () => {
		const provider = liveProvider();
		const { service } = setup({ provider });
		const contact = await service.create(owner, ACCOUNT, {
			phone: '+97455500501',
			name: 'Synced',
			syncToWhatsApp: true,
		});
		expect(provider.saveContactToWhatsApp).toHaveBeenCalledWith('97455500501@c.us', { fullName: 'Synced' });
		expect(contact.sync).toMatchObject({ status: 'synced', error: null, attempts: 0 });
		expect(contact.sync.syncedAt).toBeInstanceOf(Date);
	});

	it('records a failure with backoff and succeeds on retry', async () => {
		const save = jest
			.fn()
			.mockRejectedValueOnce(new Error('App state key not present!'))
			.mockResolvedValueOnce(undefined);
		const { service } = setup({ provider: liveProvider({ saveContactToWhatsApp: save }) });
		const failed = await service.create(owner, ACCOUNT, {
			phone: '+97455500502',
			name: 'Retry me',
			syncToWhatsApp: true,
		});
		expect(failed.sync.status).toBe('failed');
		expect(failed.sync.attempts).toBe(1);
		expect(failed.sync.error).toMatch(/contact-sync keys/);
		expect(failed.sync.errorCode).toBe('APP_STATE_KEYS');
		expect(failed.sync.nextRetryAt).toBeInstanceOf(Date);
		expect(failed.sync.syncedAt).toBeNull();

		const retried = await service.retrySync(owner, ACCOUNT, failed.id);
		expect(retried.sync.status).toBe('synced');
	});

	it('keeps the write pending while the account is offline', async () => {
		const { service } = setup({ provider: null });
		const contact = await service.create(owner, ACCOUNT, {
			phone: '+97455500503',
			name: 'Later',
			syncToWhatsApp: true,
		});
		expect(contact.isSaved).toBe(true);
		expect(contact.sync.status).toBe('pending');
		expect(contact.sync.error).toMatch(/not connected/);
		expect(contact.sync.errorCode).toBe('NOT_CONNECTED');
	});

	it('reports unsupported instead of pretending', async () => {
		const noWrite = setup({ provider: { ...liveProvider(), saveContactToWhatsApp: undefined } });
		const a = await noWrite.service.create(owner, ACCOUNT, { phone: '+97455500504', name: 'X', syncToWhatsApp: true });
		expect(a.sync.status).toBe('unsupported');

		const notOnWhatsApp = setup({
			provider: liveProvider({
				checkWhatsAppNumbers: jest.fn(async (d: string[]) => d.map((x) => ({ phoneDigits: x, exists: false, chatId: null }))),
			}),
		});
		const b = await notOnWhatsApp.service.create(owner, ACCOUNT, { phone: '+97455500505', name: 'Y', syncToWhatsApp: true });
		expect(b.sync.status).toBe('unsupported');
		expect(b.sync.error).toMatch(/not on WhatsApp/);
		expect(b.sync.errorCode).toBe('NOT_ON_WHATSAPP');

		const library = setup({
			provider: liveProvider({
				saveContactToWhatsApp: jest.fn(async () => {
					throw new WhatsAppProviderUnavailableError('unsupported', 'cannot write contacts');
				}),
			}),
		});
		const c = await library.service.create(owner, ACCOUNT, { phone: '+97455500506', name: 'Z', syncToWhatsApp: true });
		expect(c.sync.status).toBe('unsupported');
	});

	it('does not run a write another worker already claimed', async () => {
		const provider = liveProvider();
		const { service, contactRepo } = setup({ provider });
		const contact = await service.create(owner, ACCOUNT, { phone: '+97455500507', name: 'Busy' });
		contactRepo.claim.affected = 0;
		await service.retrySync(owner, ACCOUNT, contact.id);
		expect(provider.saveContactToWhatsApp).not.toHaveBeenCalled();
	});

	it('keeps the contact when removing it from WhatsApp fails', async () => {
		const provider = liveProvider({
			removeContactFromWhatsApp: jest.fn(async () => Promise.reject(new Error('timed out'))),
		});
		const { service, rows } = setup({ provider });
		const contact = await service.create(owner, ACCOUNT, { phone: '+97455500508', name: 'Keep' });
		const result = await service.remove(owner, ACCOUNT, contact.id, { removeFromWhatsApp: true });
		expect(result.removed).toBe(false);
		expect(result.contact?.sync.status).toBe('failed');
		expect(rows.has(contact.id)).toBe(true);

		const local = await service.remove(owner, ACCOUNT, contact.id, {});
		expect(local.removed).toBe(true);
		expect(rows.has(contact.id)).toBe(false);
	});

	it('never logs names or phone numbers', async () => {
		const { service } = setup({ provider: liveProvider() });
		await service.create(owner, ACCOUNT, { phone: '+97455500509', name: 'Private Person', syncToWhatsApp: true });
		await service.lookup(owner, ACCOUNT, { phone: '+97455500510' });
		const lines = [
			...(service as any).logger.log.mock.calls,
			...(service as any).logger.warn.mock.calls,
		].map((call: unknown[]) => String(call[0]));
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(line).not.toMatch(/97455500509|97455500510|Private Person/);
		}
	});
});

describe('contacts: tenant isolation and authorization', () => {
	it('hides contacts that belong to another account', async () => {
		const { service, rows, contactRepo } = setup();
		rows.set('foreign', contactRepo.create({ id: 'foreign', accountId: OTHER_ACCOUNT, waId: '97455500601@c.us', isSaved: true }));
		await expectError(service.update(owner, ACCOUNT, 'foreign', { name: 'Hijack' }), NotFoundException);
		await expectError(service.remove(owner, ACCOUNT, 'foreign', {}), NotFoundException);
		await expectError(service.startChat(owner, ACCOUNT, { contactId: 'foreign' }), NotFoundException);
		expect(rows.get('foreign').localName).toBeNull();
	});

	it('requires account access, and send access for changes and lookups', async () => {
		const { service } = setup({ provider: liveProvider() });
		await expectError(service.list(owner, OTHER_ACCOUNT, {}), ForbiddenException);
		await expectError(service.create(viewer, ACCOUNT, { phone: '+97455500602', name: 'X' }), ForbiddenException);
		await expectError(service.lookup(viewer, ACCOUNT, { phone: '+97455500602' }), ForbiddenException);
		await expectError(service.startChat(viewer, ACCOUNT, { phone: '+97455500602' }), ForbiddenException);
	});

	it('limits the full contact list to users who can see every conversation', async () => {
		const { service } = setup();
		await expect(service.list(viewer, ACCOUNT, { scope: 'all' })).resolves.toMatchObject({ scope: 'saved', canListAll: false });
		await expect(service.list(owner, ACCOUNT, { scope: 'all' })).resolves.toMatchObject({ scope: 'all', canListAll: true });
	});
});
