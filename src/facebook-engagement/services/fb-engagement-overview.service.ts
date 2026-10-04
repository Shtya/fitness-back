import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
	FbAccountStatus,
	FbCampaignStatus,
	FbConnectionStatus,
	FbEngagementAccount,
	FbEngagementCampaign,
	FbEngagementConnection,
} from '../entities/facebook-engagement.entity';
import { emptyStatusCounts } from '../utils/fb-campaign-rules';
import { FbEngagementActivityService } from './fb-engagement-activity.service';
import { FbEngagementCampaignsService } from './fb-engagement-campaigns.service';

const CHART_DAYS = 14;

@Injectable()
export class FbEngagementOverviewService {
	constructor(
		private readonly activity: FbEngagementActivityService,
		private readonly campaigns: FbEngagementCampaignsService,
		@InjectDataSource() private readonly dataSource: DataSource,
		@InjectRepository(FbEngagementConnection)
		private readonly connections: Repository<FbEngagementConnection>,
		@InjectRepository(FbEngagementAccount)
		private readonly accounts: Repository<FbEngagementAccount>,
		@InjectRepository(FbEngagementCampaign)
		private readonly campaignRepo: Repository<FbEngagementCampaign>,
	) {}

	async overview(userId: string) {
		const activeWhere = {
			ownerUserId: userId,
			status: In([FbCampaignStatus.QUEUED, FbCampaignStatus.PROCESSING]),
		};
		const [connections, pages, publishablePages, [activeCampaigns, activeCount], totalCampaigns, statusRows, daily, recent] =
			await Promise.all([
				this.connections.count({ where: { ownerUserId: userId, status: FbConnectionStatus.CONNECTED } }),
				this.accounts.count({ where: { ownerUserId: userId, status: FbAccountStatus.ACTIVE } }),
				this.accounts.count({
					where: { ownerUserId: userId, status: FbAccountStatus.ACTIVE, canPublishComments: true },
				}),
				this.campaignRepo.findAndCount({ where: activeWhere, order: { updatedAt: 'DESC' }, take: 5 }),
				this.campaignRepo.count({ where: { ownerUserId: userId } }),
				this.dataSource.query(
					`SELECT c.status, count(*)::int AS count
					 FROM fb_engagement_comments c
					 JOIN fb_engagement_campaigns k ON k.id = c.campaign_id AND k.deleted_at IS NULL
					 WHERE c.owner_user_id = $1
					 GROUP BY c.status`,
					[userId],
				) as Promise<Array<{ status: string; count: number }>>,
				this.dataSource.query(
					`SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
					        count(c.id) FILTER (WHERE c.status = 'published' AND c.published_at::date = d.day)::int AS published,
					        count(c.id) FILTER (WHERE c.status = 'failed' AND c.updated_at::date = d.day)::int AS failed
					 FROM generate_series(current_date - ($2::int - 1), current_date, interval '1 day') AS d(day)
					 LEFT JOIN fb_engagement_comments c
					   ON c.owner_user_id = $1
					  AND (c.published_at::date = d.day OR c.updated_at::date = d.day)
					 GROUP BY d.day
					 ORDER BY d.day`,
					[userId, CHART_DAYS],
				) as Promise<Array<{ day: string; published: number; failed: number }>>,
				this.activity.recent(userId, 8),
			]);

		const comments = emptyStatusCounts();
		for (const row of statusRows) {
			if (row.status in comments) comments[row.status as keyof typeof comments] = Number(row.count);
		}

		return {
			connections,
			pages,
			publishablePages,
			campaigns: { active: activeCount, total: totalCampaigns },
			comments,
			daily,
			activeCampaigns: await this.campaigns.attachRelations(activeCampaigns),
			recentActivity: recent,
		};
	}
}
