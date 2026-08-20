import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiModelEntity } from '../entities/ai.entity';
import { AiModelPricing, AiModelType, SEEDED_MODELS } from '../ai.constants';
import { AiException } from '../ai.errors';
import { UpsertAiModelDto, UpdateAiModelDto } from '../dto/ai.dto';

const DEFAULT_PRICING: AiModelPricing = {
	inputPerMillion: 0,
	outputPerMillion: 0,
	imagePerUnit: 0,
	currency: 'USD',
};

@Injectable()
export class AiModelRegistryService {
	constructor(
		@InjectRepository(AiModelEntity)
		private readonly repo: Repository<AiModelEntity>,
	) {}

	async ensureSeeded(workspaceId: string) {
		const existing = await this.repo.find({ where: { workspaceId } });
		const existingKeys = new Set(existing.map((row) => row.modelKey));
		const typesWithDefault = new Set(existing.filter((row) => row.isDefault).map((row) => row.type));
		const missing = SEEDED_MODELS.filter((model) => !existingKeys.has(model.modelKey));
		if (!missing.length) return;
		const rows = missing.map((model) =>
			this.repo.create({
				workspaceId,
				modelKey: model.modelKey,
				name: model.name,
				provider: model.provider,
				type: model.type,
				pricing: model.pricing,
				enabled: model.enabled,
				isDefault: Boolean(model.isDefault) && !typesWithDefault.has(model.type),
				tier: model.tier,
				system: true,
			}),
		);
		await this.repo.save(rows);
	}

	async list(workspaceId: string) {
		await this.ensureSeeded(workspaceId);
		return this.repo.find({
			where: { workspaceId },
			order: { type: 'ASC', isDefault: 'DESC', name: 'ASC' },
		});
	}

	async findByKey(workspaceId: string, modelKey: string, type?: AiModelType) {
		await this.ensureSeeded(workspaceId);
		const row = await this.repo.findOne({
			where: type ? { workspaceId, modelKey, type } : { workspaceId, modelKey },
		});
		return row;
	}

	async resolve(workspaceId: string, type: AiModelType, modelKey?: string) {
		await this.ensureSeeded(workspaceId);
		if (modelKey) {
			const exact = await this.repo.findOne({ where: { workspaceId, modelKey } });
			if (!exact) {
				throw new AiException('AI_MODEL_NOT_FOUND', `Model "${modelKey}" is not in the registry.`, HttpStatus.NOT_FOUND);
			}
			if (exact.type !== type) {
				throw new AiException(
					'AI_MODEL_NOT_FOUND',
					`Model "${modelKey}" is a ${exact.type} model, not ${type}.`,
					HttpStatus.BAD_REQUEST,
				);
			}
			if (!exact.enabled) {
				throw new AiException('AI_MODEL_DISABLED', `Model "${modelKey}" is disabled.`, HttpStatus.BAD_REQUEST);
			}
			return exact;
		}
		const fallback = await this.repo.findOne({
			where: { workspaceId, type, isDefault: true, enabled: true },
		});
		if (fallback) return fallback;
		throw new AiException(
			'AI_MODEL_NOT_FOUND',
			`No default ${type} model is enabled. Set one from AI Settings.`,
			HttpStatus.BAD_REQUEST,
		);
	}

	async create(workspaceId: string, dto: UpsertAiModelDto) {
		await this.ensureSeeded(workspaceId);
		const modelKey = dto.modelKey.trim();
		const exists = await this.repo.findOne({ where: { workspaceId, modelKey } });
		if (exists) throw new BadRequestException(`Model "${modelKey}" already exists`);
		const row = this.repo.create({
			workspaceId,
			modelKey,
			name: dto.name.trim(),
			provider: dto.provider.trim().toLowerCase(),
			type: dto.type,
			pricing: { ...DEFAULT_PRICING, ...(dto.pricing || {}) },
			enabled: dto.enabled !== false,
			isDefault: Boolean(dto.isDefault),
			tier: dto.tier || 'custom',
			system: false,
		});
		await this.repo.save(row);
		if (row.isDefault) await this.setDefault(workspaceId, row.id);
		return this.repo.findOneByOrFail({ id: row.id });
	}

	async update(workspaceId: string, id: string, dto: UpdateAiModelDto) {
		const row = await this.mustGet(workspaceId, id);
		if (dto.name != null) row.name = dto.name.trim();
		if (dto.pricing) row.pricing = { ...DEFAULT_PRICING, ...row.pricing, ...dto.pricing };
		if (dto.enabled != null) {
			if (row.isDefault && dto.enabled === false) {
				throw new BadRequestException('Disable a default model only after choosing another default.');
			}
			row.enabled = dto.enabled;
		}
		await this.repo.save(row);
		if (dto.isDefault === true) await this.setDefault(workspaceId, row.id);
		if (dto.isDefault === false && row.isDefault) {
			throw new BadRequestException('Choose another default model instead of unsetting this one.');
		}
		return this.repo.findOneByOrFail({ id: row.id });
	}

	async setDefault(workspaceId: string, id: string) {
		const row = await this.mustGet(workspaceId, id);
		if (!row.enabled) throw new BadRequestException('Enable the model before making it default.');
		await this.repo
			.createQueryBuilder()
			.update(AiModelEntity)
			.set({ isDefault: false })
			.where('workspace_id = :workspaceId AND type = :type AND id <> :id', {
				workspaceId,
				type: row.type,
				id: row.id,
			})
			.execute();
		row.isDefault = true;
		return this.repo.save(row);
	}

	async remove(workspaceId: string, id: string) {
		const row = await this.mustGet(workspaceId, id);
		if (row.system) throw new BadRequestException('System models cannot be deleted. Disable them instead.');
		if (row.isDefault) throw new BadRequestException('Choose another default model before deleting this one.');
		await this.repo.delete({ id: row.id, workspaceId });
		return { ok: true };
	}

	private async mustGet(workspaceId: string, id: string) {
		const row = await this.repo.findOne({ where: { id, workspaceId } });
		if (!row) throw new NotFoundException('Model not found');
		return row;
	}
}
