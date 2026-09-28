import { RedisService } from './redis.service';

function withClient(client: Record<string, any>) {
	const service = new RedisService();
	(service as any).client = { isOpen: true, isReady: true, ...client };
	return service;
}

function fakeMulti() {
	const calls: [string, any[]][] = [];
	const tx: any = {};
	for (const name of ['setEx', 'sAdd', 'expire', 'del', 'sRem']) {
		tx[name] = jest.fn((...args: any[]) => {
			calls.push([name, args]);
			return tx;
		});
	}
	tx.exec = jest.fn().mockResolvedValue([]);
	return { tx, calls };
}

describe('RedisService', () => {
	it('scanKeys follows string cursors until "0" (node-redis v5)', async () => {
		const scan = jest
			.fn()
			.mockResolvedValueOnce({ cursor: '17', keys: ['a'] })
			.mockResolvedValueOnce({ cursor: '0', keys: ['b'] });
		const service = withClient({ scan });

		await expect(service.scanKeys('wa:*')).resolves.toEqual(['a', 'b']);
		expect(scan).toHaveBeenCalledTimes(2);
		expect(scan).toHaveBeenLastCalledWith('17', { MATCH: 'wa:*', COUNT: 200 });
	});

	it('mGet parses JSON and maps missing keys to null in one call', async () => {
		const mGet = jest.fn().mockResolvedValue(['{"x":1}', null, 'plain']);
		const service = withClient({ mGet });

		await expect(service.mGet(['k1', 'k2', 'k3'])).resolves.toEqual([{ x: 1 }, null, 'plain']);
		expect(mGet).toHaveBeenCalledTimes(1);
	});

	it('mGet with no keys does not hit Redis', async () => {
		const mGet = jest.fn();
		const service = withClient({ mGet });
		await expect(service.mGet([])).resolves.toEqual([]);
		expect(mGet).not.toHaveBeenCalled();
	});

	it('setWithIndex sends SETEX + SADD + EXPIRE in one MULTI', async () => {
		const { tx, calls } = fakeMulti();
		const service = withClient({ multi: jest.fn(() => tx) });

		await service.setWithIndex('k', { a: 1 }, 60, 'idx', 'm', 120);

		expect(calls).toEqual([
			['setEx', ['k', 60, '{"a":1}']],
			['sAdd', ['idx', 'm']],
			['expire', ['idx', 120]],
		]);
		expect(tx.exec).toHaveBeenCalledTimes(1);
	});

	it('delWithIndex skips SREM when there are no members', async () => {
		const { tx, calls } = fakeMulti();
		const service = withClient({ multi: jest.fn(() => tx) });

		await service.delWithIndex(['k', 'idx'], 'idx', []);

		expect(calls).toEqual([['del', [['k', 'idx']]]]);
	});

	it('is a no-op when the client is not ready', async () => {
		const multi = jest.fn();
		const service = withClient({ isReady: false, multi, sMembers: jest.fn() });
		await service.setWithIndex('k', 1, 60, 'idx', 'm', 60);
		await expect(service.sMembers('idx')).resolves.toEqual([]);
		expect(multi).not.toHaveBeenCalled();
	});
});
