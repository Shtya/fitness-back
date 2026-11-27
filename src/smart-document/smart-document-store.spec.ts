import { decideUpsert, latestSharePerDoc, normalizeIncomingDoc } from './smart-document-store.rules';
import { SmartDocumentStoreService } from './smart-document-store.service';

const t = (iso: string) => new Date(iso);

describe('smart document rules', () => {
	it('cleans an incoming doc and refuses a bad id', () => {
		const now = t('2026-11-27T10:00:00Z');
		expect(normalizeIncomingDoc({ id: 'd_abc_123', title: '  My   doc ', content: 'x', updatedAt: t('2026-11-27T09:00:00Z').getTime() }, now)).toMatchObject({
			clientId: 'd_abc_123',
			title: 'My doc',
			titleLocked: false,
			content: 'x',
		});
		expect(normalizeIncomingDoc({ id: '../etc', content: 'x' }, now)).toBeNull();
		expect(normalizeIncomingDoc(null, now)).toBeNull();
		// A clock far in the future cannot make a copy win forever.
		expect(normalizeIncomingDoc({ id: 'd_1', updatedAt: t('2030-01-01T00:00:00Z').getTime() }, now)!.updatedAt).toEqual(now);
		expect(normalizeIncomingDoc({ id: 'd_1', title: '' }, now)!.title).toBe('Untitled');
	});

	it('keeps the newer copy and respects deletes', () => {
		const stored = { clientUpdatedAt: t('2026-11-20T10:00:00Z'), deletedAt: null };
		expect(decideUpsert(null, { updatedAt: t('2026-11-01T00:00:00Z') })).toBe('insert');
		expect(decideUpsert(stored, { updatedAt: t('2026-11-21T00:00:00Z') })).toBe('update');
		expect(decideUpsert(stored, { updatedAt: t('2026-11-20T10:00:00Z') })).toBe('update');
		expect(decideUpsert(stored, { updatedAt: t('2026-11-19T00:00:00Z') })).toBe('keep');
		const deleted = { clientUpdatedAt: t('2026-11-20T10:00:00Z'), deletedAt: t('2026-11-22T00:00:00Z') };
		expect(decideUpsert(deleted, { updatedAt: t('2026-11-21T00:00:00Z') })).toBe('keep');
		expect(decideUpsert(deleted, { updatedAt: t('2026-11-23T00:00:00Z') })).toBe('restore');
	});

	it('picks the latest share per document', () => {
		const rows = [
			{ localDocId: 'd_a', updated_at: t('2026-11-01T00:00:00Z'), v: 1 },
			{ localDocId: 'd_a', updated_at: t('2026-11-05T00:00:00Z'), v: 2 },
			{ localDocId: 'd_b', updated_at: t('2026-11-02T00:00:00Z'), v: 3 },
			{ localDocId: null, updated_at: t('2026-11-09T00:00:00Z'), v: 4 },
		];
		expect(latestSharePerDoc(rows).map(r => r.v).sort()).toEqual([2, 3]);
	});
});

/** In-memory stand-ins for the two repositories (soft delete aware). */
function makeService(shares: any[] = []) {
	const rows: any[] = [];
	const match = (row: any, where: any) => Object.entries(where).every(([k, v]) => row[k] === v);
	const docs = {
		create: (data: any) => ({ ...data, deleted_at: null }),
		findOne: async ({ where, withDeleted }: any) => rows.find(r => match(r, where) && (withDeleted || !r.deleted_at)) || null,
		exists: async ({ where, withDeleted }: any) => rows.some(r => match(r, where) && (withDeleted || !r.deleted_at)),
		find: async ({ where }: any) =>
			rows
				.filter(r => match(r, where) && !r.deleted_at)
				.sort((a, b) => b.clientUpdatedAt.getTime() - a.clientUpdatedAt.getTime()),
		save: async (row: any) => {
			if (!rows.includes(row)) rows.push(row);
			return row;
		},
		softRemove: async (row: any) => {
			row.deleted_at = new Date();
			return row;
		},
	};
	const shareRepo = { find: async () => shares };
	return { service: new SmartDocumentStoreService(docs as any, shareRepo as any), rows };
}

describe('SmartDocumentStoreService', () => {
	it('syncs local docs, keeps the newer copy, and only shows the owner their own docs', async () => {
		const { service } = makeService();
		await service.upsert('u1', { id: 'd_1', title: 'A', content: 'server newer', updatedAt: t('2026-11-25T00:00:00Z').getTime() });
		const list = await service.sync('u1', [
			{ id: 'd_1', title: 'A', content: 'stale local', updatedAt: t('2026-11-20T00:00:00Z').getTime() },
			{ id: 'd_2', title: 'B', content: 'only local', updatedAt: t('2026-11-26T00:00:00Z').getTime() },
		]);
		expect(list.map(d => [d.id, d.content])).toEqual([
			['d_2', 'only local'],
			['d_1', 'server newer'],
		]);
		expect(await service.list('u2')).toEqual([]);
	});

	it('brings back shared documents, but not ones deleted on purpose', async () => {
		const shares = [
			{ localDocId: 'd_s1', title: 'Shared', content: 'from share', updated_at: t('2026-11-17T08:30:00Z') },
			{ localDocId: 'd_gone', title: 'Deleted', content: 'x', updated_at: t('2026-11-10T00:00:00Z') },
		];
		const { service } = makeService(shares);
		await service.upsert('u1', { id: 'd_gone', content: 'x', updatedAt: t('2026-11-10T00:00:00Z').getTime() });
		await service.remove('u1', 'd_gone');
		const list = await service.sync('u1', []);
		expect(list.map(d => d.id)).toEqual(['d_s1']);
		expect(list[0]).toMatchObject({ title: 'Shared', content: 'from share' });
	});

	it('does not bring a deleted doc back from an older browser copy', async () => {
		const { service } = makeService();
		await service.upsert('u1', { id: 'd_1', content: 'x', updatedAt: t('2026-11-20T00:00:00Z').getTime() });
		await service.remove('u1', 'd_1');
		expect(await service.sync('u1', [{ id: 'd_1', content: 'old tab', updatedAt: t('2026-11-20T00:00:00Z').getTime() }])).toEqual([]);
	});
});
