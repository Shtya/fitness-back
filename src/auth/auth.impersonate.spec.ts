import { UserRole, UserStatus } from 'entities/global.entity';
import { AuthService } from './auth.service';

function createService(users: any[]) {
	const userRepo = {
		findOne: jest.fn(async ({ where }: any) => users.find(u => u.id === where.id) || null),
		save: jest.fn(async (u: any) => u),
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
	return { service };
}

const active = UserStatus.ACTIVE;
const users = [
	{ id: 'sa2', role: UserRole.SUPER_ADMIN, status: active, email: 'sa2@x.co' },
	{ id: 'adminA', role: UserRole.ADMIN, status: active, email: 'a@x.co' },
	{ id: 'adminB', role: UserRole.ADMIN, status: active, email: 'b@x.co' },
	{ id: 'coachA', role: UserRole.COACH, status: active, adminId: 'adminA', email: 'ca@x.co' },
	{ id: 'coachB', role: UserRole.COACH, status: active, adminId: 'adminB', email: 'cb@x.co' },
	{ id: 'clientA', role: UserRole.CLIENT, status: active, adminId: 'adminA', email: 'cl@x.co' },
];
const superAdmin = { id: 'sa', role: UserRole.SUPER_ADMIN };
const adminA = { id: 'adminA', role: UserRole.ADMIN };

describe('"View as" (impersonate)', () => {
	it('lets a super admin enter any account except another super admin', async () => {
		const { service } = createService(users);
		await expect(service.impersonateUser('coachB', superAdmin)).resolves.toMatchObject({ accessToken: 'token' });
		await expect(service.impersonateUser('adminA', superAdmin)).resolves.toMatchObject({ accessToken: 'token' });
		await expect(service.impersonateUser('sa2', superAdmin)).rejects.toThrow(/another super admin/);
	});

	it('lets an admin enter only their own coaches', async () => {
		const { service } = createService(users);
		await expect(service.impersonateUser('coachA', adminA)).resolves.toMatchObject({ accessToken: 'token' });
		await expect(service.impersonateUser('coachB', adminA)).rejects.toThrow(/own coaches/);
		await expect(service.impersonateUser('clientA', adminA)).rejects.toThrow(/own coaches/);
		await expect(service.impersonateUser('adminB', adminA)).rejects.toThrow(/own coaches/);
		await expect(service.impersonateUser('sa2', adminA)).rejects.toThrow(/super admin/);
	});

	it('is refused for coaches and clients', async () => {
		const { service } = createService(users);
		await expect(service.impersonateUser('coachA', { id: 'coachB', role: UserRole.COACH })).rejects.toThrow(/super admin or admin/);
		await expect(service.impersonateUser('coachA', { id: 'clientA', role: UserRole.CLIENT })).rejects.toThrow(/super admin or admin/);
	});
});
