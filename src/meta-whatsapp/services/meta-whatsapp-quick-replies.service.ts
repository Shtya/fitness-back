import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MetaWhatsAppQuickReply } from '../entities/meta-whatsapp.entity';
import {
	CreateMetaQuickReplyDto,
	UpdateMetaQuickReplyDto,
} from '../dto/meta-whatsapp.dto';

export const DEFAULT_ASK_PHONE_REPLY = {
	title: 'Ask for phone / demo',
	body: `Hi! 👋
Thanks for your interest in our Gym Management System.
Could you please share your direct phone number so one of our specialists can contact you, explain the system, and schedule a free demo`,
};

@Injectable()
export class MetaWhatsAppQuickRepliesService {
	constructor(
		@InjectRepository(MetaWhatsAppQuickReply)
		private readonly repo: Repository<MetaWhatsAppQuickReply>,
	) {}

	async list(userId?: string) {
		await this.ensureDefaults(userId);
		const rows = await this.repo.find({
			order: { sortOrder: 'ASC', createdAt: 'ASC' },
			take: 100,
		});
		return rows.map(r => this.serialize(r));
	}

	async create(userId: string, dto: CreateMetaQuickReplyDto) {
		const title = String(dto.title || '').trim();
		const body = String(dto.body || '').trim();
		if (!title) throw new BadRequestException('Title is required');
		if (!body) throw new BadRequestException('Reply body is required');
		if (title.length > 120) throw new BadRequestException('Title is too long');
		if (body.length > 4000) throw new BadRequestException('Reply body is too long');

		const maxSort = await this.repo
			.createQueryBuilder('q')
			.select('MAX(q.sort_order)', 'max')
			.getRawOne<{ max: string | null }>();
		const sortOrder = Number(maxSort?.max || 0) + 1;

		const row = this.repo.create({
			title,
			body,
			sortOrder,
			isDefault: false,
			createdBy: userId || null,
		});
		await this.repo.save(row);
		return this.serialize(row);
	}

	async update(id: string, dto: UpdateMetaQuickReplyDto) {
		const row = await this.repo.findOne({ where: { id } });
		if (!row) throw new NotFoundException('Quick reply not found');

		if (dto.title != null) {
			const title = String(dto.title).trim();
			if (!title) throw new BadRequestException('Title is required');
			if (title.length > 120) throw new BadRequestException('Title is too long');
			row.title = title;
		}
		if (dto.body != null) {
			const body = String(dto.body).trim();
			if (!body) throw new BadRequestException('Reply body is required');
			if (body.length > 4000) throw new BadRequestException('Reply body is too long');
			row.body = body;
		}
		if (dto.sortOrder != null) row.sortOrder = Number(dto.sortOrder) || 0;

		await this.repo.save(row);
		return this.serialize(row);
	}

	async remove(id: string) {
		const row = await this.repo.findOne({ where: { id } });
		if (!row) throw new NotFoundException('Quick reply not found');
		if (row.isDefault) {
			throw new BadRequestException('Default quick replies cannot be deleted — edit instead');
		}
		await this.repo.remove(row);
		return { ok: true };
	}

	private async ensureDefaults(userId?: string) {
		const count = await this.repo.count();
		if (count > 0) {
			// Still ensure the ask-phone default exists even if other replies were added
			const hasAskPhone = await this.repo.findOne({
				where: { isDefault: true, title: DEFAULT_ASK_PHONE_REPLY.title },
			});
			if (hasAskPhone) return;
			const bodyMatch = await this.repo
				.createQueryBuilder('q')
				.where('q.body ILIKE :hint', { hint: '%share your direct phone number%' })
				.getOne();
			if (bodyMatch) return;
		}

		const existingDefault = await this.repo.findOne({
			where: { isDefault: true },
		});
		if (existingDefault) return;

		const row = this.repo.create({
			title: DEFAULT_ASK_PHONE_REPLY.title,
			body: DEFAULT_ASK_PHONE_REPLY.body,
			sortOrder: 0,
			isDefault: true,
			createdBy: userId || null,
		});
		await this.repo.save(row);
	}

	private serialize(row: MetaWhatsAppQuickReply) {
		return {
			id: row.id,
			title: row.title,
			body: row.body,
			sortOrder: row.sortOrder,
			isDefault: row.isDefault,
			createdBy: row.createdBy,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}
