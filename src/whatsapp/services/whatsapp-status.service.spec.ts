import { WhatsAppStatusService } from './whatsapp-status.service';

function row(id: string, providerStatusId = `p-${id}`) {
	return {
		id,
		accountId: 'acc-1',
		providerStatusId,
		senderWaId: '201111111111@c.us',
		type: 'image',
		caption: null,
		isOwn: false,
		publishedAt: new Date(0),
		expiresAt: new Date(1),
		mediaPath: null,
	};
}

function createService(expired: any[] = []) {
	const qb: any = {
		where: jest.fn(() => qb),
		andWhere: jest.fn(() => qb),
		getMany: jest.fn().mockResolvedValue(expired),
	};
	const repo = {
		createQueryBuilder: jest.fn(() => qb),
		delete: jest.fn().mockResolvedValue(undefined),
	};
	const historyRepo = { upsert: jest.fn().mockResolvedValue(undefined) };
	const access = {
		assertAccountPermission: jest.fn().mockResolvedValue(undefined),
	};
	const providers = {
		getProvider: jest.fn(() => {
			throw new Error('stop-after-prune-scheduling');
		}),
	};
	const service = new WhatsAppStatusService(
		repo as any,
		historyRepo as any,
		{} as any,
		{} as any,
		access as any,
		providers as any,
		{} as any,
		{} as any,
	);
	return { service, repo, historyRepo, qb };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('WhatsAppStatusService expired-status housekeeping', () => {
	it('archives expired rows in one upsert and one delete', async () => {
		const { service, repo, historyRepo } = createService([row('1'), row('2'), row('3')]);
		await (service as any).pruneExpiredStatuses('acc-1');
		expect(historyRepo.upsert).toHaveBeenCalledTimes(1);
		expect(historyRepo.upsert.mock.calls[0][0]).toHaveLength(3);
		expect(historyRepo.upsert.mock.calls[0][1]).toEqual(['accountId', 'providerStatusId']);
		expect(repo.delete).toHaveBeenCalledWith(['1', '2', '3']);
	});

	it('does not write when nothing expired', async () => {
		const { service, repo, historyRepo } = createService([]);
		await (service as any).pruneExpiredStatuses('acc-1');
		expect(historyRepo.upsert).not.toHaveBeenCalled();
		expect(repo.delete).not.toHaveBeenCalled();
	});

	it('dedupes conflict keys inside one upsert batch', async () => {
		const { service, historyRepo } = createService();
		await (service as any).archiveStatusRows([row('1', 'same'), row('2', 'same'), row('3')]);
		expect(historyRepo.upsert.mock.calls[0][0]).toHaveLength(2);
	});

	it('list() schedules pruning without awaiting it and throttles per account', async () => {
		const { service, qb } = createService([row('1')]);
		let release: (value: any[]) => void = () => undefined;
		qb.getMany.mockImplementation(() => new Promise((resolve) => (release = resolve)));

		await expect(service.list({} as any, 'acc-1')).rejects.toThrow('stop-after-prune-scheduling');
		await expect(service.list({} as any, 'acc-1')).rejects.toThrow('stop-after-prune-scheduling');

		expect(qb.getMany).toHaveBeenCalledTimes(1);
		release([]);
		await flush();
	});

	it('retries pruning on the next request after a failure', async () => {
		const { service, qb } = createService();
		qb.getMany.mockRejectedValueOnce(new Error('db down'));
		(service as any).schedulePrune('acc-1');
		await flush();
		(service as any).schedulePrune('acc-1');
		await flush();
		expect(qb.getMany).toHaveBeenCalledTimes(2);
	});
});
