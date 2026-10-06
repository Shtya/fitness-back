import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../entities/global.entity';
import { DEFAULT_LOCKED_PAGE_IDS, effectiveLockedPages, PageAccessService } from './page-access.service';

function makeService(opts: { user?: any; roleRows?: any[]; override?: any; overrideRows?: any[]; findError?: any } = {}) {
	const roleRepo = {
		find: jest.fn(async () => {
			if (opts.findError) throw opts.findError;
			return opts.roleRows ?? [];
		}),
		delete: jest.fn(),
		insert: jest.fn(),
	};
	const overrideRepo = {
		findOne: jest.fn(async () => opts.override ?? null),
		find: jest.fn(async () => {
			if (opts.findError) throw opts.findError;
			return opts.overrideRows ?? [];
		}),
		upsert: jest.fn(),
		delete: jest.fn(),
	};
	const userRepo = { findOne: jest.fn(async () => opts.user ?? null), update: jest.fn() };
	const manager = {
		getRepository: jest.fn((entity: { name: string }) =>
			entity.name === 'RolePageSetting' ? roleRepo : entity.name === 'UserPageOverride' ? overrideRepo : userRepo),
	};
	const dataSource = { transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)) };
	const service = new PageAccessService(roleRepo as any, overrideRepo as any, userRepo as any, dataSource as any);
	return { service, roleRepo, overrideRepo, userRepo };
}

describe('effectiveLockedPages', () => {
	it('merges defaults, role and user locks, and extra pages win', () => {
		const roleModes = { tasks: 'locked', reports: 'locked', chat: 'optional', calendar: 'default', money: 'default' } as const;
		expect(effectiveLockedPages(roleModes, ['reports'], ['calendar'])).toEqual(
			[...DEFAULT_LOCKED_PAGE_IDS.filter((id) => id !== 'money'), 'calendar', 'chat', 'tasks'].sort(),
		);
	});

	it('starts from store-admin defaults when role modes are empty', () => {
		expect(effectiveLockedPages({}, [], [])).toEqual([...DEFAULT_LOCKED_PAGE_IDS].sort());
	});
});

describe('PageAccessService', () => {
	const client = { id: 'u1', role: UserRole.CLIENT };

	it('does not apply store-tool defaults to super admin', async () => {
		const { service, roleRepo } = makeService();
		await expect(service.forUser({ id: 's1', role: UserRole.SUPER_ADMIN })).resolves.toMatchObject({ locked: [], granted: [] });
		expect(roleRepo.find).toHaveBeenCalled();
	});

	it('computes access from role rows and user override', async () => {
		const { service } = makeService({
			roleRows: [{ pageId: 'tasks', mode: 'locked' }, { pageId: 'chat', mode: 'optional' }],
			override: { extraPages: ['tasks'], lockedPages: ['reports'] },
		});
		await expect(service.forUser(client)).resolves.toEqual({
			roleModes: { tasks: 'locked', chat: 'optional' },
			extraPages: ['tasks'],
			lockedPages: ['reports'],
			granted: ['tasks'],
			locked: [...DEFAULT_LOCKED_PAGE_IDS, 'chat', 'reports'].sort(),
		});
	});

	it('falls back to no restrictions when the tables are missing', async () => {
		const { service } = makeService({ findError: Object.assign(new Error('missing'), { code: '42P01' }) });
		await expect(service.forUser(client)).resolves.toMatchObject({ locked: [], roleModes: {} });
	});

	it('rethrows other database errors', async () => {
		const { service } = makeService({ findError: Object.assign(new Error('down'), { code: '08006' }) });
		await expect(service.forUser(client)).rejects.toThrow('down');
	});

	it('summarises overrides per user and tolerates missing tables', async () => {
		const { service } = makeService({ overrideRows: [{ userId: 'u1', extraPages: ['a', 'b'], lockedPages: ['c'] }] });
		await expect(service.overrideSummaries(['u1', 'u2'])).resolves.toEqual({ u1: { extra: 2, locked: 1 } });
		await expect(service.overrideSummaries([])).resolves.toEqual({});

		const missing = makeService({ findError: Object.assign(new Error('missing'), { code: '42P01' }) });
		await expect(missing.service.overrideSummaries(['u1'])).resolves.toEqual({});
	});

	it('rejects unmanaged roles and invalid modes', async () => {
		const { service } = makeService();
		await expect(service.replaceRole('guest', {}, 'a1')).rejects.toBeInstanceOf(BadRequestException);
		await expect(service.replaceRole('client', { tasks: 'hidden' }, 'a1')).rejects.toBeInstanceOf(BadRequestException);
		await expect(service.replaceRole('client', { 'bad id': 'locked' }, 'a1')).rejects.toBeInstanceOf(BadRequestException);
	});

	it('replaces role modes in one transaction', async () => {
		const { service, roleRepo } = makeService();
		await service.replaceRole('coach', { tasks: 'locked', chat: 'optional' }, 'a1');
		expect(roleRepo.delete).toHaveBeenCalledWith({ role: 'coach' });
		expect(roleRepo.insert).toHaveBeenCalledWith([
			{ role: 'coach', pageId: 'tasks', mode: 'locked', updatedBy: 'a1' },
			{ role: 'coach', pageId: 'chat', mode: 'optional', updatedBy: 'a1' },
		]);
	});

	it('refuses to restrict a super admin', async () => {
		const { service } = makeService({ user: { id: 's1', role: UserRole.SUPER_ADMIN } });
		await expect(service.setUser('s1', { extraPages: [], lockedPages: [] }, 'a1')).rejects.toBeInstanceOf(ForbiddenException);
	});

	it('rejects a page that is both shown and locked', async () => {
		const { service } = makeService({ user: client });
		await expect(service.setUser('u1', { extraPages: ['tasks'], lockedPages: ['tasks'] }, 'a1'))
			.rejects.toBeInstanceOf(BadRequestException);
	});

	it('rejects a locked login landing page', async () => {
		const { service } = makeService({ user: client, roleRows: [{ pageId: 'tasks', mode: 'locked' }] });
		await expect(service.setUser('u1', { extraPages: [], lockedPages: [], loginLandingPage: 'tasks' }, 'a1'))
			.rejects.toThrow('locked');
	});

	it('saves overrides and clears legacy allowedPages', async () => {
		const { service, overrideRepo, userRepo } = makeService({ user: client });
		await service.setUser('u1', { extraPages: ['chat'], lockedPages: ['tasks'], loginLandingPage: 'chat' }, 'a1');
		expect(overrideRepo.upsert).toHaveBeenCalledWith(
			{ userId: 'u1', extraPages: ['chat'], lockedPages: ['tasks'], updatedBy: 'a1' },
			['userId'],
		);
		expect(userRepo.update).toHaveBeenCalledWith({ id: 'u1' }, { allowedPages: null, loginLandingPage: 'chat' });
	});

	it('deletes the override row when both lists are empty', async () => {
		const { service, overrideRepo } = makeService({ user: client });
		await service.setUser('u1', { extraPages: [], lockedPages: [] }, 'a1');
		expect(overrideRepo.delete).toHaveBeenCalledWith({ userId: 'u1' });
		expect(overrideRepo.upsert).not.toHaveBeenCalled();
	});
});
