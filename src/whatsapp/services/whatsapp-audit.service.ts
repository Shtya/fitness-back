import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsAppAuditLog } from '../entities/whatsapp.entity';

@Injectable()
export class WhatsAppAuditService {
	private readonly logger = new Logger(WhatsAppAuditService.name);

	constructor(
		@InjectRepository(WhatsAppAuditLog)
		private readonly repo: Repository<WhatsAppAuditLog>,
	) {}

	async write(input: {
		actorUserId?: string | null;
		accountId?: string | null;
		action: string;
		targetType?: string | null;
		targetId?: string | null;
		metadata?: Record<string, any> | null;
	}) {
		try {
			return await this.repo.save(
				this.repo.create({
					actorUserId: input.actorUserId ?? null,
					accountId: input.accountId ?? null,
					action: input.action,
					targetType: input.targetType ?? null,
					targetId: input.targetId ?? null,
					metadata: input.metadata ?? null,
				}),
			);
		} catch (error) {
			this.logger.error(
				`Failed to persist WhatsApp audit event ${input.action}`,
				error instanceof Error ? error.stack : String(error),
			);
			return null;
		}
	}

	async list(accountId: string, page = 1, limit = 50) {
		const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
		const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
		const [items, total] = await this.repo.findAndCount({
			where: { accountId },
			relations: ['actor'],
			order: { created_at: 'DESC' },
			take,
			skip,
		});
		return { items, total, page: Math.floor(skip / take) + 1, limit: take };
	}
}
