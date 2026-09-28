import { BadRequestException } from '@nestjs/common';
import { CRUD } from './crud.service';

function fakeRepository() {
	const calls = { andWhere: [] as string[], skip: [] as number[], take: [] as number[] };
	const qb: any = {
		skip: (v: number) => (calls.skip.push(v), qb),
		take: (v: number) => (calls.take.push(v), qb),
		andWhere: (sql: string) => (calls.andWhere.push(sql), qb),
		orderBy: () => qb,
		getManyAndCount: async () => [[], 0],
	};
	const repository: any = {
		createQueryBuilder: () => qb,
		metadata: { columns: [{ propertyName: 'created_at' }, { propertyName: 'status' }] },
	};
	return { repository, calls };
}

describe('CRUD.findAll input hardening (audit B4)', () => {
	it('rejects filter keys that are not plain identifier paths', async () => {
		const { repository, calls } = fakeRepository();
		await expect(CRUD.findAll(repository, 'p', undefined, 1, 10, 'created_at', 'DESC', [], [], { 'status = status OR 1=1 --': 'x' })).rejects.toBeInstanceOf(BadRequestException);
		expect(calls.andWhere).toHaveLength(0);
	});

	it('keeps valid filters and floors fractional pagination', async () => {
		const { repository, calls } = fakeRepository();
		await CRUD.findAll(repository, 'p', undefined, '2.7', '10.2', 'created_at', 'DESC', [], [], { status: 'active' });
		expect(calls.andWhere).toEqual(['p.status = :status']);
		expect(calls.skip).toEqual([10]);
		expect(calls.take).toEqual([10]);
	});
});
