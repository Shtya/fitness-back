import * as bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from 'entities/global.entity';
import { AuthService } from './auth.service';

function createService(users: any[]) {
	const builder = (rows: any[]) => {
		let where = '';
		let params: any = {};
		const qb: any = {
			addSelect: () => qb,
			where: (clause: string, values: any) => {
				where = clause;
				params = values;
				return qb;
			},
			take: () => qb,
			getOne: async () => rows.find(u => (where.includes('LOWER') ? u.email.trim().toLowerCase() === params.email.toLowerCase() : u.email === params.email)) || null,
			getMany: async () => rows.filter(u => u.email.trim().toLowerCase() === params.email.toLowerCase()),
		};
		return qb;
	};
	const userRepo = {
		findOne: jest.fn(async ({ where }: any) => users.find(u => u.id === where.id) || null),
		save: jest.fn(async (u: any) => u),
		createQueryBuilder: jest.fn(() => builder(users)),
	};
	const service = new AuthService(
		userRepo as any,
		{} as any,
		{} as any,
		{} as any,
		{} as any,
		{ sign: jest.fn(() => 'token'), verify: jest.fn() } as any,
		{ get: jest.fn(() => 'secret') } as any,
		{} as any,
		{ forUser: jest.fn(async () => ({})) } as any,
	);
	return { service, userRepo };
}

const superAdmin = { id: 'sa', role: UserRole.SUPER_ADMIN };

describe('super admin sets a password', () => {
	it('hashes the chosen password and voids a pending reset link', async () => {
		const target = { id: 'u1', email: 'admin@gmail.com', password: 'old', resetPasswordToken: 'tok', resetPasswordExpires: new Date() };
		const { service } = createService([target]);
		const out = await service.superAdminSetPassword('u1', 'NewPass#2026', superAdmin);
		expect(out).toMatchObject({ userId: 'u1', email: 'admin@gmail.com' });
		expect(await bcrypt.compare('NewPass#2026', target.password)).toBe(true);
		expect(target.resetPasswordToken).toBeNull();
		expect(target.resetPasswordExpires).toBeNull();
	});

	it('is refused for anyone but a super admin, and for weak input', async () => {
		const target = { id: 'u1', email: 'a@b.co', password: 'old' };
		const { service } = createService([target]);
		await expect(service.superAdminSetPassword('u1', 'NewPass#2026', { id: 'x', role: UserRole.ADMIN })).rejects.toThrow(/super admin/);
		await expect(service.superAdminSetPassword('u1', 'short', superAdmin)).rejects.toThrow(/8 characters/);
		await expect(service.superAdminSetPassword('u1', ' padded-pass ', superAdmin)).rejects.toThrow(/space/);
		await expect(service.superAdminSetPassword('missing', 'NewPass#2026', superAdmin)).rejects.toThrow(/not found/);
		expect(target.password).toBe('old');
	});
});

describe('sign-in email matching', () => {
	const hashed = bcrypt.hashSync('right-password', 4);

	it('finds the account whatever the case of the email, but not when two accounts differ only by case', async () => {
		const active = { status: UserStatus.ACTIVE, role: UserRole.ADMIN, password: hashed };
		const { service } = createService([{ ...active, id: 'u1', email: 'Admin@Gmail.com' }]);
		const attempt = service.login({ email: 'admin@gmail.com', password: 'wrong-password' } as any);
		await expect(attempt).rejects.toThrow('Incorrect email or password');
		// Found despite the case difference: the sign-in goes through.
		const found = await service.login({ email: 'admin@gmail.com', password: 'right-password' } as any).catch(e => e);
		expect(String(found?.message || '')).not.toContain('Incorrect email or password');
		expect(found?.accessToken).toBe('token');

		const twins = createService([
			{ ...active, id: 'a', email: 'Admin@gmail.com' },
			{ ...active, id: 'b', email: 'admin@Gmail.com' },
		]).service;
		await expect(twins.login({ email: 'ADMIN@gmail.com', password: 'right-password' } as any)).rejects.toThrow(
			'Incorrect email or password',
		);
	});
});
