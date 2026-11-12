import { WhatsAppReportsService, percentile, replyStats } from './whatsapp-reports.service';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';

describe('reply stats', () => {
	it('matches PERCENTILE_CONT', () => {
		expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
		expect(percentile([10, 20, 30, 40, 50], 0.9)).toBe(46);
		expect(percentile([], 0.5)).toBeNull();
	});

	it('counts quick, late and very late replies and keeps the last reply time', () => {
		const rows = [60, 400, 1000, 4000].map((waitSeconds, index) => ({
			conversationId: `c${index}`,
			userId: 'u1',
			inboundAt: '2026-11-12T08:00:00.000Z',
			repliedAt: `2026-11-12T${String(8 + index).padStart(2, '0')}:00:00.000Z`,
			waitSeconds,
		}));
		expect(replyStats(rows)).toMatchObject({
			replies: 4,
			medianResponseSeconds: 700,
			fastestResponseSeconds: 60,
			slowestResponseSeconds: 4000,
			fastReplies5m: 1,
			slowReplies15m: 2,
			slowReplies1h: 1,
			lastReplyAt: '2026-11-12T11:00:00.000Z',
		});
	});
});

describe('reports summary', () => {
	function createService() {
		const query = jest.fn(async (sql: string) => {
			if (sql.includes('LAG(m.direction)')) {
				return [
					// newest first, like the ORDER BY in the SQL
					{ conversationId: 'aaaaaaaa-0000-4000-8000-000000000002', userId: 'coach', inboundAt: new Date('2026-11-12T10:00:00Z'), repliedAt: new Date('2026-11-12T10:02:00Z'), waitSeconds: 120 },
					{ conversationId: 'aaaaaaaa-0000-4000-8000-000000000001', userId: 'coach', inboundAt: new Date('2026-11-12T09:00:00Z'), repliedAt: new Date('2026-11-12T09:20:00Z'), waitSeconds: 1200 },
				];
			}
			if (sql.includes('UNION ALL')) return [{ userId: 'coach', at: new Date('2026-11-12T10:05:00Z') }];
			if (sql.includes('a.actor_user_id AS "userId"')) {
				return [
					{ userId: 'coach', at: new Date('2026-11-12T09:00:00Z'), action: 'whatsapp.session.active', conversationId: null },
					{ userId: 'coach', at: new Date('2026-11-12T09:05:00Z'), action: 'whatsapp.conversation.read', conversationId: 'aaaaaaaa-0000-4000-8000-000000000003' },
				];
			}
			if (sql.includes('m.sender_user_id AS "userId"')) {
				return [{ userId: 'coach', at: new Date('2026-11-12T09:20:00Z'), conversationId: 'aaaaaaaa-0000-4000-8000-000000000001' }];
			}
			if (sql.includes('SELECT c.id, COALESCE')) {
				return [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Mona' }, { id: 'aaaaaaaa-0000-4000-8000-000000000002', title: 'Karim' }];
			}
			return [];
		});
		const qb: any = {
			select: () => qb, addSelect: () => qb, where: () => qb, andWhere: () => qb, groupBy: () => qb,
			getRawMany: async () => [],
		};
		const messageRepo = { query, createQueryBuilder: () => qb };
		const conversationRepo = { query };
		const accessRepo = {
			find: async () => [
				{ userId: 'coach', canView: true, canUse: true, user: { name: 'Coach Omar' } },
				{ userId: 'other', canView: true, canUse: true, user: { name: 'Sara' } },
			],
		};
		const access = { getAccountAccess: async () => ({ canManage: true, canAssign: true }) };
		const gateway = { liveWatchersOfAccount: () => new Map([['coach', Date.parse('2026-11-12T10:10:00Z')]]) };
		const service = new WhatsAppReportsService(
			messageRepo as any,
			conversationRepo as any,
			accessRepo as any,
			access as any,
			gateway as any,
		);
		return { service, query };
	}

	it('bounds the reply query to the period instead of the whole history', async () => {
		const { service, query } = createService();
		await service.summary({ id: 'owner' } as any, ACCOUNT, '2026-11-12T00:00:00Z', '2026-11-12T23:59:59Z');
		const replySql = query.mock.calls.map(call => String(call[0])).find(sql => sql.includes('LAG(m.direction)'))!;
		expect(replySql).toMatch(/m\.provider_timestamp >= \$2::timestamptz - \(\$4 \* INTERVAL '1 second'\)/);
		const waitingSql = query.mock.calls.map(call => String(call[0])).find(sql => sql.includes('waiting_inbound'))!;
		expect(waitingSql).toMatch(/provider_timestamp >= NOW\(\) - \(\$2 \* INTERVAL '1 second'\)/);
	});

	it('gives each person online state, last seen, last reply and a shift timeline', async () => {
		const { service } = createService();
		const report = await service.summary({ id: 'owner' } as any, ACCOUNT, '2026-11-12T00:00:00Z', '2026-11-12T23:59:59Z');
		const coach = report.staff.find((item: any) => item.userId === 'coach')!;
		expect(coach).toMatchObject({
			online: true,
			lastSeenAt: '2026-11-12T10:10:00.000Z',
			lastReplyAt: '2026-11-12T10:02:00.000Z',
			replies: 2,
			slowReplies15m: 1,
			chatsOpened: 1,
			repliedChats: 1,
			seenNoReply: 1,
		});
		expect(coach.timeline.replies).toHaveLength(2);
		expect(coach.timeline.sessions).toHaveLength(1);
		// online people first; everyone with access is listed, even with no activity
		expect(report.staff.map((item: any) => item.userId)).toEqual(['coach', 'other']);
		expect(report.totals.onlineNow).toBe(1);
		expect(report.recentReplies[0]).toMatchObject({ userName: 'Coach Omar', title: 'Karim', waitSeconds: 120 });
	});
});
