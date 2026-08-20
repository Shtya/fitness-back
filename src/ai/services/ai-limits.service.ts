import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UpdateAiLimitsDto } from '../dto/ai.dto';
import { AiSettingsEntity, AiUsageLogEntity, AiUsagePeriodEntity } from '../entities/ai.entity';
import { AiModelPricing, AiModelType, AiUsageStatus, featureSpec } from '../ai.constants';
import { aiLimitReached } from '../ai.errors';
import {
	currentPeriodKey,
	effectiveLimit,
	estimateUsageCost,
	toNumber,
	usagePercent,
	warningLevel,
} from '../ai.util';

export type LimitReservation = {
	periodId: string;
	periodKey: string;
	reservedCost: number;
	reservedRequests: number;
	reservedImages: number;
};

export type SettleUsageInput = {
	workspaceId: string;
	userId?: string | null;
	feature?: string | null;
	provider: string;
	modelKey: string;
	type: AiModelType;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	imageCount?: number;
	pricing: AiModelPricing;
	status: AiUsageStatus;
	errorCode?: string | null;
	errorMessage?: string | null;
	durationMs?: number | null;
	reservation: LimitReservation;
};

@Injectable()
export class AiLimitsService {
	constructor(
		private readonly dataSource: DataSource,
		@InjectRepository(AiSettingsEntity)
		private readonly settingsRepo: Repository<AiSettingsEntity>,
		@InjectRepository(AiUsagePeriodEntity)
		private readonly periodRepo: Repository<AiUsagePeriodEntity>,
		@InjectRepository(AiUsageLogEntity)
		private readonly logRepo: Repository<AiUsageLogEntity>,
	) {}

	async getOrCreateSettings(workspaceId: string) {
		let row = await this.settingsRepo.findOne({ where: { workspaceId } });
		if (row) return row;
		try {
			row = this.settingsRepo.create({ workspaceId });
			return await this.settingsRepo.save(row);
		} catch (err: any) {
			if (String(err?.code || err?.driverError?.code) !== '23505') throw err;
			return this.settingsRepo.findOneOrFail({ where: { workspaceId } });
		}
	}

	async updateSettings(workspaceId: string, patch: UpdateAiLimitsDto) {
		const settings = await this.getOrCreateSettings(workspaceId);
		if (patch.monthlyCostLimit != null) settings.monthlyCostLimit = String(patch.monthlyCostLimit);
		if (patch.monthlyRequestLimit != null) settings.monthlyRequestLimit = patch.monthlyRequestLimit;
		if (patch.monthlyImageLimit != null) settings.monthlyImageLimit = patch.monthlyImageLimit;
		if (patch.safetyBufferPercent != null) settings.safetyBufferPercent = String(patch.safetyBufferPercent);
		if (patch.warningsEnabled != null) settings.warningsEnabled = patch.warningsEnabled;
		if (patch.timezone) settings.timezone = patch.timezone;
		return this.settingsRepo.save(settings);
	}

	async getFeatureDefaults(workspaceId: string): Promise<Record<string, string>> {
		const settings = await this.getOrCreateSettings(workspaceId);
		const stored = settings.featureDefaults;
		if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
		const next: Record<string, string> = {};
		for (const [key, value] of Object.entries(stored)) {
			const spec = featureSpec(String(key));
			const modelKey = String(value || '').trim();
			if (!spec || !modelKey) continue;
			next[spec.id] = modelKey;
		}
		return next;
	}

	async updateFeatureDefault(workspaceId: string, feature: string, modelKey: string) {
		const spec = featureSpec(feature);
		if (!spec) throw new BadRequestException(`Unknown AI feature "${feature}"`);
		const key = String(modelKey || '').trim();
		if (!key) throw new BadRequestException('modelKey is required');
		const settings = await this.getOrCreateSettings(workspaceId);
		settings.featureDefaults = { ...(settings.featureDefaults || {}), [spec.id]: key };
		return this.settingsRepo.save(settings);
	}

	async updateProviderLimits(
		workspaceId: string,
		provider: string,
		patch: { monthlyCostLimit?: number; monthlyRequestLimit?: number },
	) {
		const id = String(provider || '').trim();
		if (!id) throw new BadRequestException('provider is required');
		const settings = await this.getOrCreateSettings(workspaceId);
		const current = { ...(settings.providerLimits || {}) };
		current[id] = {
			...(current[id] || {}),
			...(patch.monthlyCostLimit != null ? { monthlyCostLimit: Number(patch.monthlyCostLimit) } : {}),
			...(patch.monthlyRequestLimit != null ? { monthlyRequestLimit: Number(patch.monthlyRequestLimit) } : {}),
		};
		settings.providerLimits = current;
		return this.settingsRepo.save(settings);
	}

	async snapshot(workspaceId: string) {
		const settings = await this.getOrCreateSettings(workspaceId);
		const periodKey = currentPeriodKey(settings.timezone);
		const period = await this.ensurePeriod(workspaceId, periodKey);
		const costLimit = effectiveLimit(toNumber(settings.monthlyCostLimit), toNumber(settings.safetyBufferPercent));
		const requestLimit = Math.floor(
			effectiveLimit(toNumber(settings.monthlyRequestLimit), toNumber(settings.safetyBufferPercent)),
		);
		const imageLimit = Math.floor(
			effectiveLimit(toNumber(settings.monthlyImageLimit), toNumber(settings.safetyBufferPercent)),
		);
		const usedCost = toNumber(period.estimatedCost);
		const usedRequests = toNumber(period.requestCount);
		const usedImages = toNumber(period.imageCount);
		const percents = {
			cost: usagePercent(usedCost, costLimit),
			requests: usagePercent(usedRequests, requestLimit),
			images: usagePercent(usedImages, imageLimit),
		};
		const highest = Math.max(percents.cost, percents.requests, percents.images);
		return {
			settings,
			period,
			periodKey,
			limits: {
				monthlyCostLimit: toNumber(settings.monthlyCostLimit),
				monthlyRequestLimit: toNumber(settings.monthlyRequestLimit),
				monthlyImageLimit: toNumber(settings.monthlyImageLimit),
				safetyBufferPercent: toNumber(settings.safetyBufferPercent),
				effectiveCostLimit: costLimit,
				effectiveRequestLimit: requestLimit,
				effectiveImageLimit: imageLimit,
			},
			used: {
				cost: usedCost,
				requests: usedRequests,
				images: usedImages,
			},
			percents,
			warning: warningLevel(highest, settings.warningsEnabled),
			hardStopped: highest >= 100 && (costLimit > 0 || requestLimit > 0 || imageLimit > 0),
		};
	}

	async reserve(params: {
		workspaceId: string;
		provider?: string;
		type: AiModelType;
		pricing: AiModelPricing;
		promptTokens: number;
		maxOutputTokens: number;
		imageCount: number;
	}): Promise<LimitReservation> {
		const settings = await this.getOrCreateSettings(params.workspaceId);
		const periodKey = currentPeriodKey(settings.timezone);
		const estimatedCost = estimateUsageCost({
			pricing: params.pricing,
			promptTokens: params.promptTokens,
			completionTokens: params.type === 'text' ? params.maxOutputTokens : 0,
			imageCount: params.imageCount,
		});
		return this.dataSource.transaction(async (manager) => {
			const period = await this.lockPeriod(manager, params.workspaceId, periodKey);
			this.assertWithinLimits(settings, period, {
				cost: estimatedCost,
				requests: 1,
				images: params.imageCount,
			});
			await this.assertProviderLimits(manager, settings, {
				workspaceId: params.workspaceId,
				periodKey,
				provider: params.provider,
				cost: estimatedCost,
				requests: 1,
			});
			period.reservedCost = String(toNumber(period.reservedCost) + estimatedCost);
			period.reservedRequests = toNumber(period.reservedRequests) + 1;
			period.reservedImages = toNumber(period.reservedImages) + params.imageCount;
			await manager.save(period);
			return {
				periodId: period.id,
				periodKey,
				reservedCost: estimatedCost,
				reservedRequests: 1,
				reservedImages: params.imageCount,
			};
		});
	}

	async settle(input: SettleUsageInput) {
		const actualCost =
			input.status === 'success'
				? estimateUsageCost({
						pricing: input.pricing,
						promptTokens: input.promptTokens,
						completionTokens: input.completionTokens,
						imageCount: input.imageCount,
					})
				: 0;
		const imageCount = input.status === 'success' ? toNumber(input.imageCount) : 0;
		const requestCount = input.status === 'success' ? 1 : 0;

		await this.dataSource.transaction(async (manager) => {
			const period = await manager.findOne(AiUsagePeriodEntity, {
				where: { id: input.reservation.periodId },
				lock: { mode: 'pessimistic_write' },
			});
			if (period) {
				period.reservedCost = String(Math.max(0, toNumber(period.reservedCost) - input.reservation.reservedCost));
				period.reservedRequests = Math.max(0, toNumber(period.reservedRequests) - input.reservation.reservedRequests);
				period.reservedImages = Math.max(0, toNumber(period.reservedImages) - input.reservation.reservedImages);
				period.estimatedCost = String(toNumber(period.estimatedCost) + actualCost);
				period.requestCount = toNumber(period.requestCount) + requestCount;
				period.imageCount = toNumber(period.imageCount) + imageCount;
				const settings = await manager.findOne(AiSettingsEntity, { where: { workspaceId: input.workspaceId } });
				if (settings?.warningsEnabled) {
					const costPct = usagePercent(
						toNumber(period.estimatedCost),
						effectiveLimit(toNumber(settings.monthlyCostLimit), toNumber(settings.safetyBufferPercent)),
					);
					const reqPct = usagePercent(
						toNumber(period.requestCount),
						effectiveLimit(toNumber(settings.monthlyRequestLimit), toNumber(settings.safetyBufferPercent)),
					);
					const imgPct = usagePercent(
						toNumber(period.imageCount),
						effectiveLimit(toNumber(settings.monthlyImageLimit), toNumber(settings.safetyBufferPercent)),
					);
					period.lastWarningLevel = warningLevel(Math.max(costPct, reqPct, imgPct), true);
				}
				await manager.save(period);
			}

			const log = manager.create(AiUsageLogEntity, {
				workspaceId: input.workspaceId,
				userId: input.userId || null,
				feature: input.feature || null,
				provider: input.provider,
				modelKey: input.modelKey,
				type: input.type,
				promptTokens: toNumber(input.promptTokens),
				completionTokens: toNumber(input.completionTokens),
				totalTokens: toNumber(input.totalTokens) || toNumber(input.promptTokens) + toNumber(input.completionTokens),
				imageCount,
				estimatedCost: String(actualCost),
				status: input.status,
				errorCode: input.errorCode || null,
				errorMessage: input.errorMessage || null,
				durationMs: input.durationMs ?? null,
			});
			await manager.save(log);
		});

		return { estimatedCost: actualCost };
	}

	async logBlocked(params: {
		workspaceId: string;
		userId?: string | null;
		feature?: string | null;
		provider: string;
		modelKey: string;
		type: AiModelType;
		message: string;
	}) {
		const log = this.logRepo.create({
			workspaceId: params.workspaceId,
			userId: params.userId || null,
			feature: params.feature || null,
			provider: params.provider,
			modelKey: params.modelKey,
			type: params.type,
			status: 'blocked',
			errorCode: 'AI_LIMIT_REACHED',
			errorMessage: params.message,
		});
		await this.logRepo.save(log);
	}

	async dashboard(workspaceId: string) {
		const snap = await this.snapshot(workspaceId);
		const logs = await this.logRepo.find({
			where: { workspaceId },
			order: { createdAt: 'DESC' },
			take: 50,
		});
		const periodStart = new Date(`${snap.periodKey}-01T00:00:00.000Z`);
		const breakdown = await this.logRepo
			.createQueryBuilder('l')
			.select('l.modelKey', 'modelKey')
			.addSelect('l.provider', 'provider')
			.addSelect('l.type', 'type')
			.addSelect('COUNT(*)', 'requests')
			.addSelect('COALESCE(SUM(l.imageCount), 0)', 'images')
			.addSelect('COALESCE(SUM(l.estimatedCost), 0)', 'cost')
			.where('l.workspaceId = :workspaceId', { workspaceId })
			.andWhere('l.createdAt >= :start', { start: periodStart })
			.andWhere('l.status = :status', { status: 'success' })
			.groupBy('l.modelKey')
			.addGroupBy('l.provider')
			.addGroupBy('l.type')
			.orderBy('cost', 'DESC')
			.getRawMany();
		const providerBreakdown = await this.logRepo
			.createQueryBuilder('l')
			.select('l.provider', 'provider')
			.addSelect('COUNT(*)', 'requests')
			.addSelect('COALESCE(SUM(l.estimatedCost), 0)', 'cost')
			.where('l.workspaceId = :workspaceId', { workspaceId })
			.andWhere('l.createdAt >= :start', { start: periodStart })
			.andWhere('l.status = :status', { status: 'success' })
			.groupBy('l.provider')
			.orderBy('cost', 'DESC')
			.getRawMany();

		return {
			period: snap.periodKey,
			warningsEnabled: snap.settings.warningsEnabled,
			timezone: snap.settings.timezone,
			currentUsage: snap.used,
			limits: snap.limits,
			percents: snap.percents,
			warning: snap.warning,
			hardStopped: snap.hardStopped,
			monthlyCost: snap.used.cost,
			requests: snap.used.requests,
			images: snap.used.images,
			modelBreakdown: breakdown.map((row) => ({
				modelKey: row.modelKey,
				provider: row.provider,
				type: row.type,
				requests: toNumber(row.requests),
				images: toNumber(row.images),
				cost: toNumber(row.cost),
			})),
			providerBreakdown: providerBreakdown.map((row) => ({
				provider: row.provider,
				requests: toNumber(row.requests),
				cost: toNumber(row.cost),
			})),
			recent: logs.map((row) => ({
				id: row.id,
				modelKey: row.modelKey,
				provider: row.provider,
				type: row.type,
				feature: row.feature,
				tokens: row.totalTokens,
				images: row.imageCount,
				estimatedCost: toNumber(row.estimatedCost),
				status: row.status,
				createdAt: row.createdAt,
			})),
		};
	}

	private async ensurePeriod(workspaceId: string, periodKey: string) {
		let row = await this.periodRepo.findOne({ where: { workspaceId, periodKey } });
		if (!row) {
			row = this.periodRepo.create({ workspaceId, periodKey });
			try {
				row = await this.periodRepo.save(row);
			} catch {
				row = await this.periodRepo.findOneOrFail({ where: { workspaceId, periodKey } });
			}
		}
		return row;
	}

	private async lockPeriod(manager: EntityManager, workspaceId: string, periodKey: string) {
		let period = await manager.findOne(AiUsagePeriodEntity, {
			where: { workspaceId, periodKey },
			lock: { mode: 'pessimistic_write' },
		});
		if (period) return period;
		period = manager.create(AiUsagePeriodEntity, { workspaceId, periodKey });
		try {
			await manager.save(period);
		} catch {
			// concurrent insert — lock the winner
		}
		period = await manager.findOne(AiUsagePeriodEntity, {
			where: { workspaceId, periodKey },
			lock: { mode: 'pessimistic_write' },
		});
		if (!period) throw new Error('Failed to lock AI usage period');
		return period;
	}

	private assertWithinLimits(
		settings: AiSettingsEntity,
		period: AiUsagePeriodEntity,
		delta: { cost: number; requests: number; images: number },
	) {
		const buffer = toNumber(settings.safetyBufferPercent);
		const costLimit = effectiveLimit(toNumber(settings.monthlyCostLimit), buffer);
		const requestLimit = Math.floor(effectiveLimit(toNumber(settings.monthlyRequestLimit), buffer));
		const imageLimit = Math.floor(effectiveLimit(toNumber(settings.monthlyImageLimit), buffer));
		const nextCost = toNumber(period.estimatedCost) + toNumber(period.reservedCost) + delta.cost;
		const nextRequests = toNumber(period.requestCount) + toNumber(period.reservedRequests) + delta.requests;
		const nextImages = toNumber(period.imageCount) + toNumber(period.reservedImages) + delta.images;
		if (costLimit > 0 && nextCost > costLimit) throw aiLimitReached('cost');
		if (requestLimit > 0 && nextRequests > requestLimit) throw aiLimitReached('requests');
		if (imageLimit > 0 && nextImages > imageLimit) throw aiLimitReached('images');
	}

	private async assertProviderLimits(
		manager: EntityManager,
		settings: AiSettingsEntity,
		params: {
			workspaceId: string;
			periodKey: string;
			provider?: string;
			cost: number;
			requests: number;
		},
	) {
		const provider = String(params.provider || '').trim();
		if (!provider) return;
		const cap = settings.providerLimits?.[provider];
		const costLimit = Number(cap?.monthlyCostLimit || 0);
		const requestLimit = Number(cap?.monthlyRequestLimit || 0);
		if (costLimit <= 0 && requestLimit <= 0) return;
		const start = new Date(`${params.periodKey}-01T00:00:00.000Z`);
		const used = await manager
			.createQueryBuilder(AiUsageLogEntity, 'l')
			.select('COALESCE(SUM(l.estimatedCost), 0)', 'cost')
			.addSelect('COUNT(*)', 'requests')
			.where('l.workspaceId = :workspaceId', { workspaceId: params.workspaceId })
			.andWhere('l.provider = :provider', { provider })
			.andWhere('l.createdAt >= :start', { start })
			.andWhere('l.status = :status', { status: 'success' })
			.getRawOne();
		const nextCost = toNumber(used?.cost) + params.cost;
		const nextRequests = toNumber(used?.requests) + params.requests;
		if (costLimit > 0 && nextCost > costLimit) throw aiLimitReached('provider');
		if (requestLimit > 0 && nextRequests > requestLimit) throw aiLimitReached('provider');
	}
}
