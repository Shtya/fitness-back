import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ListActivityQueryDto } from '../dto/facebook-engagement.dto';
import { FbActivityLevel, FbEngagementActivityLog } from '../entities/facebook-engagement.entity';

export type ActivityInput = {
	actorUserId?: string | null;
	campaignId?: string | null;
	commentId?: string | null;
	action: string;
	level?: FbActivityLevel;
	message: string;
	details?: Record<string, unknown> | null;
};

@Injectable()
export class FbEngagementActivityService {
	private readonly logger = new Logger(FbEngagementActivityService.name);

	constructor(
		@InjectRepository(FbEngagementActivityLog)
		private readonly logs: Repository<FbEngagementActivityLog>,
	) {}

	async log(ownerUserId: string, input: ActivityInput, manager?: EntityManager) {
		const repo = manager ? manager.getRepository(FbEngagementActivityLog) : this.logs;
		try {
			await repo.insert({
				ownerUserId,
				actorUserId: input.actorUserId ?? null,
				campaignId: input.campaignId ?? null,
				commentId: input.commentId ?? null,
				action: input.action,
				level: input.level ?? 'info',
				message: input.message.slice(0, 2000),
				details: input.details ?? null,
			});
		} catch (error) {
			if (manager) throw error;
			this.logger.warn(`Activity log write failed (${input.action}): ${error instanceof Error ? error.message : error}`);
		}
	}

	async list(ownerUserId: string, query: ListActivityQueryDto) {
		const page = query.page ?? 1;
		const limit = query.limit ?? 25;
		const qb = this.logs
			.createQueryBuilder('log')
			.where('log.ownerUserId = :ownerUserId', { ownerUserId })
			.orderBy('log.createdAt', 'DESC')
			.skip((page - 1) * limit)
			.take(limit);
		if (query.campaignId) qb.andWhere('log.campaignId = :campaignId', { campaignId: query.campaignId });
		if (query.level) qb.andWhere('log.level = :level', { level: query.level });
		const [items, total] = await qb.getManyAndCount();
		return { items, total, page, limit };
	}

	recent(ownerUserId: string, limit = 10) {
		return this.logs.find({ where: { ownerUserId }, order: { createdAt: 'DESC' }, take: limit });
	}
}
