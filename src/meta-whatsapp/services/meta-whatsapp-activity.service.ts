import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetaWhatsAppActivityLog } from '../entities/meta-whatsapp.entity';

@Injectable()
export class MetaWhatsAppActivityService {
	constructor(
		@InjectRepository(MetaWhatsAppActivityLog)
		private readonly repo: Repository<MetaWhatsAppActivityLog>,
	) {}

	async log(
		action: string,
		actorId: string | null,
		details?: Record<string, any>,
		configId?: string | null,
	) {
		const row = this.repo.create({
			action,
			actorId,
			configId: configId || null,
			details: details || null,
		});
		await this.repo.save(row);
		return row;
	}

	async list(configId: string, limit = 50) {
		return this.repo.find({
			where: { configId },
			order: { createdAt: 'DESC' },
			take: Math.min(Math.max(limit, 1), 200),
		});
	}
}
