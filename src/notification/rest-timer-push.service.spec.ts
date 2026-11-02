import { BadRequestException } from '@nestjs/common';
import { RestTimerPushService } from './rest-timer-push.service';

describe('RestTimerPushService', () => {
	let sendToUser: jest.Mock;
	let svc: RestTimerPushService;

	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2026-11-02T12:00:00Z'));
		sendToUser = jest.fn().mockResolvedValue([]);
		svc = new RestTimerPushService({ sendToUser } as any);
	});

	afterEach(() => {
		svc.onModuleDestroy();
		jest.useRealTimers();
	});

	it('pushes once when the rest ends', () => {
		svc.schedule('u1', { endsAt: '2026-11-02T12:01:30Z', title: 'Rest over', body: 'Next set' });
		jest.advanceTimersByTime(89_000);
		expect(sendToUser).not.toHaveBeenCalled();
		jest.advanceTimersByTime(1_000);
		expect(sendToUser).toHaveBeenCalledTimes(1);
		expect(sendToUser).toHaveBeenCalledWith('u1', expect.objectContaining({ title: 'Rest over', tag: 'rest-timer', url: '/dashboard/my/workouts' }));
	});

	it('a new start replaces the pending rest, and cancel drops it', () => {
		svc.schedule('u1', { endsAt: '2026-11-02T12:01:00Z' });
		svc.schedule('u1', { endsAt: '2026-11-02T12:02:00Z' });
		jest.advanceTimersByTime(61_000);
		expect(sendToUser).not.toHaveBeenCalled();
		expect(svc.cancel('u1')).toEqual({ cancelled: true });
		jest.advanceTimersByTime(120_000);
		expect(sendToUser).not.toHaveBeenCalled();
	});

	it('rejects times that are not a rest', () => {
		expect(() => svc.schedule('u1', { endsAt: 'nope' })).toThrow(BadRequestException);
		expect(() => svc.schedule('u1', { endsAt: '2026-11-02T15:00:00Z' })).toThrow(BadRequestException);
	});
});
