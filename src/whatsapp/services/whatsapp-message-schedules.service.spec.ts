import {
	WhatsAppMessageScheduleDeliveryStatus,
	WhatsAppMessageScheduleKind,
	WhatsAppMessageScheduleRecipientStatus,
	WhatsAppMessageScheduleStatus,
} from '../entities/whatsapp.entity';
import { WhatsAppMessageSchedulesService } from './whatsapp-message-schedules.service';

const NOW = new Date('2026-10-23T12:00:00.000Z');

function setup(options: { previousRuns?: number; sentBefore?: string[]; sendFails?: boolean } = {}) {
	const schedule: any = {
		id: 'sch-1',
		accountId: 'acc-1',
		createdByUserId: 'user-1',
		type: 'text',
		text: 'hello',
		scheduleKind: WhatsAppMessageScheduleKind.ONCE,
		scheduledAt: NOW,
		nextRunAt: NOW,
		status: WhatsAppMessageScheduleStatus.ACTIVE,
		recipients: [
			{ id: 'r-1', conversationId: 'conv-1', status: WhatsAppMessageScheduleRecipientStatus.ACTIVE },
			{ id: 'r-2', conversationId: 'conv-2', status: WhatsAppMessageScheduleRecipientStatus.ACTIVE },
		],
	};
	const saved: any[] = [];
	const scheduleRepo = {
		find: jest.fn(async (query: any) =>
			query.where?.status === WhatsAppMessageScheduleStatus.PROCESSING ? [] : [schedule],
		),
		findOne: jest.fn(async () => ({ ...schedule })),
		update: jest.fn(async () => ({ affected: 1 })),
		save: jest.fn(async (row: any) => {
			saved.push({ ...row });
			return row;
		}),
		create: jest.fn((row: any) => row),
	};
	const deliveryRepo = {
		find: jest.fn(async () => (options.sentBefore || []).map(conversationId => ({ conversationId }))),
		create: jest.fn((row: any) => ({ ...row })),
		save: jest.fn(async (row: any) => row),
	};
	const runRepo = {
		count: jest.fn(async () => options.previousRuns || 0),
		create: jest.fn((row: any) => ({ id: 'run-1', ...row })),
		save: jest.fn(async (row: any) => row),
	};
	const recipientRepo = { save: jest.fn(async (row: any) => row), create: jest.fn((row: any) => row) };
	const userRepo = { findOne: jest.fn(async () => ({ id: 'user-1' })) };
	const sync = {
		sendText: jest.fn(async () => {
			if (options.sendFails) throw new Error('WhatsApp is not connected');
			return { message: { id: 'msg-1' } };
		}),
	};
	const gateway = { emitAccountEvent: jest.fn() };
	const service = new WhatsAppMessageSchedulesService(
		scheduleRepo as any,
		recipientRepo as any,
		runRepo as any,
		deliveryRepo as any,
		userRepo as any,
		{} as any,
		{} as any,
		sync as any,
		{ write: jest.fn() } as any,
		gateway as any,
	);
	(service as any).sleep = jest.fn(async () => undefined);
	return { service, schedule, saved, sync, scheduleRepo };
}

describe('WhatsAppMessageSchedulesService.processDue', () => {
	it('sends a due one-time message with a stable id and completes it', async () => {
		const { service, saved, sync } = setup();
		await service.processDue(NOW);
		expect(sync.sendText).toHaveBeenCalledWith(
			expect.anything(),
			'conv-1',
			'hello',
			undefined,
			'schedule:sch-1:conv-1',
		);
		expect(saved.at(-1).status).toBe(WhatsAppMessageScheduleStatus.COMPLETED);
		expect(saved.at(-1).nextRunAt).toBeNull();
	});

	it('does not send again to a chat an earlier try already reached', async () => {
		const { service, sync } = setup({ sentBefore: ['conv-1'] });
		await service.processDue(NOW);
		expect(sync.sendText).toHaveBeenCalledTimes(1);
		expect((sync.sendText.mock.calls[0] as any[])[1]).toBe('conv-2');
	});

	it('retries a failed send later, then marks it failed after the last try', async () => {
		const first = setup({ sendFails: true, previousRuns: 0 });
		await first.service.processDue(NOW);
		const retry = first.saved.at(-1);
		expect(retry.status).toBe(WhatsAppMessageScheduleStatus.ACTIVE);
		expect(retry.nextRunAt.getTime()).toBeGreaterThan(NOW.getTime());

		const last = setup({ sendFails: true, previousRuns: 2 });
		await last.service.processDue(NOW);
		const failed = last.saved.at(-1);
		expect(failed.status).toBe(WhatsAppMessageScheduleStatus.FAILED);
		expect(failed.nextRunAt).toBeNull();
		expect(failed.lastError).toBe('WhatsApp is not connected');
	});

	it('send-now puts a waiting message out right away', async () => {
		const { service, schedule, sync } = setup();
		schedule.nextRunAt = new Date(Date.now() + 60 * 60 * 1000);
		(service as any).access = { getAccountAccess: jest.fn(async () => ({ canUse: true, canManage: false })) };
		const result = await service.sendNow({ id: 'user-1' } as any, 'sch-1');
		expect(result.status).toBe(WhatsAppMessageScheduleStatus.ACTIVE);
		await new Promise(resolve => setImmediate(resolve));
		await new Promise(resolve => setImmediate(resolve));
		expect(sync.sendText).toHaveBeenCalledWith(expect.anything(), 'conv-1', 'hello', undefined, 'schedule:sch-1:conv-1');
	});

	it('send-now refuses recurring or finished messages', async () => {
		const recurring = setup();
		recurring.schedule.scheduleKind = WhatsAppMessageScheduleKind.RECURRING;
		(recurring.service as any).access = { getAccountAccess: jest.fn(async () => ({ canUse: true, canManage: true })) };
		await expect(recurring.service.sendNow({ id: 'user-1' } as any, 'sch-1')).rejects.toThrow('one-time');

		const done = setup();
		done.schedule.status = WhatsAppMessageScheduleStatus.COMPLETED;
		(done.service as any).access = { getAccountAccess: jest.fn(async () => ({ canUse: true, canManage: true })) };
		await expect(done.service.sendNow({ id: 'user-1' } as any, 'sch-1')).rejects.toThrow('already sent');
	});

	it('records each send as a delivery', async () => {
		const { service } = setup();
		await service.processDue(NOW);
		const deliveryRepo = (service as any).deliveryRepo;
		// Each delivery row is saved twice (pending, then its result); the mock keeps the same object.
		const rows = [...new Set(deliveryRepo.save.mock.calls.map((call: any[]) => call[0]))] as any[];
		expect(rows.map(row => row.status)).toEqual([
			WhatsAppMessageScheduleDeliveryStatus.SENT,
			WhatsAppMessageScheduleDeliveryStatus.SENT,
		]);
	});
});
