import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PlanService } from './plans.service';
import { PERSONAL_PLAN_SCHEMA_STATEMENTS } from './personal-plan.schema';

const day = (dayOfWeek: string, ids: string[]) => ({ dayOfWeek, exercises: ids.map(id => ({ exerciseId: id })) });

function setup({ user, plans }: { user: any; plans: Record<string, any> }) {
	const userRepo = {
		findOne: jest.fn(async () => user),
		update: jest.fn(async (_where: any, patch: any) => Object.assign(user, patch)),
	};
	const planRepo = {
		findOne: jest.fn(async ({ where }: any) => plans[where.id] ?? null),
		find: jest.fn(async () => []),
	};
	const manager = {
		update: jest.fn(async (_e: any, _w: any, patch: any) => Object.assign(user, patch)),
		find: jest.fn(async () => [{ id: 'day-1' }]),
		delete: jest.fn(async () => undefined),
	};
	const dataSource = { transaction: jest.fn(async (fn: any) => fn(manager)), query: jest.fn() };
	const redis = { del: jest.fn(), deletePattern: jest.fn() };
	const svc = new PlanService(dataSource as any, planRepo as any, {} as any, {} as any, {} as any, userRepo as any, redis as any);
	const create = jest.spyOn(svc, 'createPlanWithContent').mockImplementation(async (input: any, _l, _a, personal) => {
		const copy = { id: 'copy-1', ...input, ...personal };
		plans['copy-1'] = { id: 'copy-1', name: input.name, ownerUserId: personal?.ownerUserId, sourcePlanId: personal?.sourcePlanId };
		return copy as any;
	});
	const update = jest.spyOn(svc, 'updatePlanAndContent').mockResolvedValue({} as any);
	jest.spyOn(svc, 'planToFrontendShape').mockImplementation((p: any) => ({ id: p.id }) as any);
	return { svc, create, update, userRepo, manager, redis };
}

describe('client personal plan', () => {
	const coachPlan = { id: 'coach-1', name: 'PPL', adminId: 'coach', notes: ['n'], ownerUserId: null };

	it('first save copies the coach plan and points the client to the copy', async () => {
		const user = { id: 'u1', role: 'client', canEditWorkout: true, activeExercisePlanId: 'coach-1' };
		const { svc, create, update } = setup({ user, plans: { 'coach-1': coachPlan } });
		const out = await svc.saveMyPlan('u1', { program: { days: [day('saturday', ['e1'])] } }, 'en');
		expect(update).not.toHaveBeenCalled();
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'PPL', userId: 'coach' }),
			'en',
			{ id: 'u1', role: 'client' },
			{ ownerUserId: 'u1', sourcePlanId: 'coach-1' },
		);
		expect(user.activeExercisePlanId).toBe('copy-1');
		expect(out).toMatchObject({ isPersonal: true, canReset: true, canEdit: true });
	});

	it('later saves update the copy, never the coach plan', async () => {
		const user = { id: 'u1', role: 'client', canEditWorkout: true, activeExercisePlanId: 'copy-1' };
		const { svc, create, update } = setup({
			user,
			plans: { 'coach-1': coachPlan, 'copy-1': { id: 'copy-1', ownerUserId: 'u1', sourcePlanId: 'coach-1' } },
		});
		await svc.saveMyPlan('u1', { program: { days: [day('monday', ['e2'])] } }, 'en');
		expect(create).not.toHaveBeenCalled();
		expect(update).toHaveBeenCalledWith('copy-1', { program: { days: [day('monday', ['e2'])] } }, 'en', { id: 'u1', role: 'client' });
	});

	it('refuses without the coach permission, and never empties the plan', async () => {
		const blocked = setup({ user: { id: 'u1', canEditWorkout: false, activeExercisePlanId: 'coach-1' }, plans: { 'coach-1': coachPlan } });
		await expect(blocked.svc.saveMyPlan('u1', { program: { days: [day('saturday', ['e1'])] } }, 'en')).rejects.toBeInstanceOf(ForbiddenException);

		const allowed = setup({ user: { id: 'u1', canEditWorkout: true, activeExercisePlanId: 'coach-1' }, plans: { 'coach-1': coachPlan } });
		await expect(allowed.svc.saveMyPlan('u1', { program: { days: [] } }, 'en')).rejects.toBeInstanceOf(BadRequestException);
		await expect(allowed.svc.saveMyPlan('u1', { program: { days: [day('saturday', [])] } }, 'en')).rejects.toBeInstanceOf(BadRequestException);
		expect(allowed.create).not.toHaveBeenCalled();
	});

	it('reset puts the client back on the coach plan and deletes the copy', async () => {
		const user = { id: 'u1', role: 'client', canEditWorkout: true, activeExercisePlanId: 'copy-1' };
		const { svc, manager } = setup({
			user,
			plans: { 'coach-1': coachPlan, 'copy-1': { id: 'copy-1', ownerUserId: 'u1', sourcePlanId: 'coach-1' } },
		});
		const out = await svc.resetMyPlan('u1', 'en');
		expect(user.activeExercisePlanId).toBe('coach-1');
		expect(manager.delete).toHaveBeenCalledWith(expect.anything(), { id: 'copy-1' });
		expect(out).toMatchObject({ isPersonal: false, canReset: false });
	});

	it('reset on the coach plan itself is refused', async () => {
		const { svc } = setup({ user: { id: 'u1', canEditWorkout: true, activeExercisePlanId: 'coach-1' }, plans: { 'coach-1': coachPlan } });
		await expect(svc.resetMyPlan('u1', 'en')).rejects.toBeInstanceOf(BadRequestException);
	});

	it('boot schema only adds nullable columns and an index', () => {
		for (const statement of PERSONAL_PLAN_SCHEMA_STATEMENTS) {
			expect(statement).toMatch(/^(ALTER TABLE exercise_plans ADD COLUMN IF NOT EXISTS|CREATE INDEX IF NOT EXISTS)/);
			expect(statement).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|NOT NULL)\b/i);
		}
	});
});
