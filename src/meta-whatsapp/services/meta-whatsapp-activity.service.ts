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

	async log(action: string, actorId: string | null, details?: Record<string, any>) {
		const row = this.repo.create({
			action,
			actorId,
			details: details || null,
		});
		await this.repo.save(row);
		return row;
	}

	async list(limit = 50) {
		return this.repo.find({
			order: { createdAt: 'DESC' },
			take: Math.min(Math.max(limit, 1), 200),
		});
	}
}
