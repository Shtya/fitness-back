import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
	AI_FEATURES,
	AI_PAGES,
	AiFeatureId,
	AiModelType,
	catalogFor,
	featureSpec,
	GEMINI_PROVIDER_ID,
	KNOWN_PROVIDER_META,
	providerNeedsKey,
} from './ai.constants';
import { AiException, sanitizeProviderMessage } from './ai.errors';
import { AiGenerateImageDto, AiGenerateTextDto, UpdateAiFeatureDto, UpdateAiLimitsDto, UpdateAiProviderLimitsDto } from './dto/ai.dto';
import { AiCredentialsService } from './services/ai-credentials.service';
import { AiLimitsService, LimitReservation } from './services/ai-limits.service';
import { AiModelRegistryService } from './services/ai-model-registry.service';
import { AiProviderRegistryService } from './services/ai-provider-registry.service';
import { AiRouterService } from './services/ai-router.service';
import { estimatePromptTokens } from './ai.util';

export type AiCaller = {
	id: string;
	tenantId?: string | null;
	adminId?: string | null;
	tokenTenantId?: string | null;
};

export type GenerateTextInput = {
	prompt: string;
	model?: string;
	system?: string;
	maxTokens?: number;
	temperature?: number;
	feature?: string;
	user: AiCaller;
};

export type GenerateImageInput = {
	prompt: string;
	model?: string;
	aspectRatio?: string;
	feature?: string;
	user: AiCaller;
};

export type FeatureChoice = {
	feature: AiFeatureId;
	provider: string;
	modelKey: string;
	type: AiModelType;
	tier: string;
};

@Injectable()
export class AiService {
	private readonly logger = new Logger(AiService.name);

	constructor(
		private readonly models: AiModelRegistryService,
		private readonly credentials: AiCredentialsService,
		private readonly providers: AiProviderRegistryService,
		private readonly limits: AiLimitsService,
		private readonly router: AiRouterService,
	) {}

	/**
	 * Feature-facing API. Callers must not pass API keys, providers, or prices.
	 */
	async generateText(input: GenerateTextInput) {
		return this.run('text', input.user, input.feature, async () => {
			const workspaceId = this.workspaceId(input.user);
			const modelKey = await this.resolveRequestedModel(workspaceId, 'text', input.model, input.feature);
			const { model, provider } = await this.router.route(workspaceId, 'text', modelKey);
			if (!provider.generateText) {
				throw new AiException('AI_PROVIDER_UNAVAILABLE', `Provider "${model.provider}" cannot generate text.`);
			}
			const reservation = await this.limits.reserve({
				workspaceId,
				provider: model.provider,
				type: 'text',
				pricing: model.pricing,
				promptTokens: estimatePromptTokens(input.prompt, input.system),
				maxOutputTokens: input.maxTokens || 1024,
				imageCount: 0,
			});
			return this.execute({
				workspaceId,
				userId: input.user.id,
				feature: input.feature || null,
				model,
				type: 'text',
				reservation,
				run: async (apiKey) => {
					const result = await provider.generateText!(
						{
							prompt: input.prompt,
							model: model.modelKey,
							system: input.system,
							maxTokens: input.maxTokens,
							temperature: input.temperature,
						},
						{ apiKey },
					);
					return {
						payload: { text: result.text, model: result.model },
						promptTokens: result.promptTokens,
						completionTokens: result.completionTokens,
						totalTokens: result.totalTokens,
						imageCount: 0,
					};
				},
			});
		});
	}

	async generateImage(input: GenerateImageInput) {
		return this.run('image', input.user, input.feature, async () => {
			const workspaceId = this.workspaceId(input.user);
			const modelKey = await this.resolveRequestedModel(workspaceId, 'image', input.model, input.feature);
			const { model, provider } = await this.router.route(workspaceId, 'image', modelKey);
			if (!provider.generateImage) {
				throw new AiException('AI_PROVIDER_UNAVAILABLE', `Provider "${model.provider}" cannot generate images.`);
			}
			const reservation = await this.limits.reserve({
				workspaceId,
				provider: model.provider,
				type: 'image',
				pricing: model.pricing,
				promptTokens: estimatePromptTokens(input.prompt),
				maxOutputTokens: 0,
				imageCount: 1,
			});
			return this.execute({
				workspaceId,
				userId: input.user.id,
				feature: input.feature || null,
				model,
				type: 'image',
				reservation,
				run: async (apiKey) => {
					const result = await provider.generateImage!(
						{
							prompt: input.prompt,
							model: model.modelKey,
							aspectRatio: input.aspectRatio,
						},
						{ apiKey },
					);
					return {
						payload: { imageUrl: result.imageUrl, mimeType: result.mimeType, model: result.model },
						promptTokens: result.promptTokens,
						completionTokens: result.completionTokens,
						totalTokens: result.totalTokens,
						imageCount: result.imageCount || 1,
					};
				},
			});
		});
	}

	async overview(user: AiCaller) {
		const workspaceId = this.workspaceId(user);
		const [models, usage, credentials, featureDefaults] = await Promise.all([
			this.models.list(workspaceId),
			this.limits.dashboard(workspaceId),
			Promise.all(KNOWN_PROVIDER_META.map((meta) => this.credentials.publicStatus(workspaceId, meta.id))),
			this.limits.getFeatureDefaults(workspaceId),
		]);
		const settings = await this.limits.getOrCreateSettings(workspaceId);
		const providers = KNOWN_PROVIDER_META.map((meta) => {
			const live = credentials.find((row) => row.provider === meta.id);
			const credential = live || { provider: meta.id, configured: false, last4: null };
			return {
				...meta,
				credential: meta.needsKey ? credential : { ...credential, configured: true },
			};
		});
		const keyReady = new Set(
			providers.filter((item) => !item.needsKey || item.credential?.configured).map((item) => item.id),
		);
		const mappedModels = models.map((row) => {
			const catalog = catalogFor(row.modelKey);
			const locked = providerNeedsKey(row.provider) && !keyReady.has(row.provider);
			return {
				id: row.id,
				modelKey: row.modelKey,
				name: row.name,
				provider: row.provider,
				type: row.type,
				pricing: row.pricing,
				enabled: Boolean(row.enabled) && !locked,
				isDefault: row.isDefault,
				tier: row.tier,
				system: row.system,
				usedBy: catalog?.usedBy || [],
				costTier: catalog?.costTier || (row.tier === 'premium' ? 'PREMIUM' : 'PAID'),
				locked,
			};
		});
		const features = AI_FEATURES.map((spec) => {
			const modelKey = featureDefaults[spec.id] || spec.defaultModelKey;
			const row = mappedModels.find((item) => item.modelKey === modelKey);
			const catalog = catalogFor(modelKey);
			return {
				id: spec.id,
				name: spec.name,
				type: spec.type,
				page: spec.page,
				defaultModelKey: spec.defaultModelKey,
				modelKey,
				provider: row?.provider || catalog?.provider || null,
				tier: row?.tier || catalog?.tier || null,
				costTier: catalog?.costTier || null,
				locked: Boolean(row?.locked),
				resolved: row
					? {
							id: row.id,
							name: row.name,
							modelKey: row.modelKey,
							provider: row.provider,
							type: row.type,
							enabled: row.enabled,
						}
					: catalog
						? {
								name: catalog.name,
								modelKey: catalog.modelKey,
								provider: catalog.provider,
								type: catalog.type,
								enabled: catalog.enabled,
							}
						: null,
			};
		});
		const byKey = new Map(mappedModels.map((row) => [row.modelKey, row]));
		return {
			workspaceId,
			providers,
			models: mappedModels,
			features,
			pages: AI_PAGES.map((page) => ({
				id: page.id,
				href: page.href,
				features: features.filter((item) => item.page === page.id),
			})),
			featureDefaults,
			providerLimits: settings.providerLimits || {},
			limits: usage.limits,
			warningsEnabled: usage.warningsEnabled,
			timezone: usage.timezone,
			usage: {
				...usage,
				modelBreakdown: (usage.modelBreakdown || []).map((row) => {
					const model = byKey.get(row.modelKey);
					const catalog = catalogFor(row.modelKey);
					return {
						...row,
						name: model?.name || catalog?.name || row.modelKey,
						provider: row.provider || model?.provider || catalog?.provider || null,
						costTier: model?.costTier || catalog?.costTier || null,
					};
				}),
			},
		};
	}

	async resolveFeatureChoice(user: AiCaller, feature: string): Promise<FeatureChoice> {
		const spec = featureSpec(feature);
		if (!spec) throw new BadRequestException(`Unknown AI feature "${feature}"`);
		const workspaceId = this.workspaceId(user);
		await this.models.ensureSeeded(workspaceId);
		const stored = (await this.limits.getFeatureDefaults(workspaceId))[spec.id];
		const modelKey = stored || spec.defaultModelKey;
		const row =
			(await this.models.findByKey(workspaceId, modelKey, spec.type)) ||
			(await this.models.findByKey(workspaceId, modelKey));
		const catalog = catalogFor(modelKey);
		return {
			feature: spec.id,
			provider: row?.provider || catalog?.provider || 'unknown',
			modelKey: row?.modelKey || catalog?.modelKey || modelKey,
			type: row?.type || catalog?.type || spec.type,
			tier: row?.tier || catalog?.tier || 'custom',
		};
	}

	async updateFeatureDefault(user: AiCaller, dto: UpdateAiFeatureDto) {
		const spec = featureSpec(dto.feature);
		if (!spec) throw new BadRequestException(`Unknown AI feature "${dto.feature}"`);
		const workspaceId = this.workspaceId(user);
		await this.models.ensureSeeded(workspaceId);
		const modelKey = String(dto.modelKey || '').trim();
		const row = await this.models.findByKey(workspaceId, modelKey);
		const catalog = catalogFor(modelKey);
		const type = row?.type || catalog?.type;
		if (!type) throw new BadRequestException(`Unknown model "${modelKey}"`);
		if (type !== spec.type) {
			throw new BadRequestException(`Model "${modelKey}" is ${type}, but ${spec.id} requires ${spec.type}.`);
		}
		if (row && !row.enabled) {
			throw new BadRequestException(`Model "${modelKey}" is disabled.`);
		}
		if (providerNeedsKey(row?.provider || catalog?.provider || '')) {
			const status = await this.credentials.publicStatus(workspaceId, row?.provider || catalog?.provider);
			if (!status?.configured) {
				throw new BadRequestException(`Save the ${row?.provider || catalog?.provider} API key before using this model.`);
			}
		}
		await this.limits.updateFeatureDefault(workspaceId, spec.id, modelKey);
		return this.overview(user);
	}

	async saveCredential(user: AiCaller, provider: string, apiKey: string) {
		this.providers.get(provider);
		const workspaceId = this.workspaceId(user);
		return this.credentials.save(workspaceId, provider, apiKey, user.id);
	}

	async testCredential(user: AiCaller, provider: string) {
		const workspaceId = this.workspaceId(user);
		const impl = this.providers.get(provider);
		const apiKey = await this.credentials.getApiKey(workspaceId, provider);
		const result = await impl.testConnection({ apiKey });
		if (result.ok) await this.credentials.markVerified(workspaceId, provider);
		return result;
	}

	async removeCredential(user: AiCaller, provider: string) {
		return this.credentials.remove(this.workspaceId(user), provider);
	}

	async updateLimits(user: AiCaller, dto: UpdateAiLimitsDto) {
		await this.limits.updateSettings(this.workspaceId(user), dto);
		return this.overview(user);
	}

	async updateProviderLimits(user: AiCaller, dto: UpdateAiProviderLimitsDto) {
		await this.limits.updateProviderLimits(this.workspaceId(user), dto.provider, {
			monthlyCostLimit: dto.monthlyCostLimit,
			monthlyRequestLimit: dto.monthlyRequestLimit,
		});
		return this.overview(user);
	}

	listModels(user: AiCaller) {
		return this.models.list(this.workspaceId(user));
	}

	createModel(user: AiCaller, dto: Parameters<AiModelRegistryService['create']>[1]) {
		return this.models.create(this.workspaceId(user), dto);
	}

	async updateModel(user: AiCaller, id: string, dto: Parameters<AiModelRegistryService['update']>[2]) {
		await this.assertModelKeyReady(this.workspaceId(user), id, dto.enabled === true || dto.isDefault === true);
		return this.models.update(this.workspaceId(user), id, dto);
	}

	async setDefaultModel(user: AiCaller, id: string) {
		await this.assertModelKeyReady(this.workspaceId(user), id, true);
		return this.models.setDefault(this.workspaceId(user), id);
	}

	removeModel(user: AiCaller, id: string) {
		return this.models.remove(this.workspaceId(user), id);
	}

	usage(user: AiCaller) {
		return this.limits.dashboard(this.workspaceId(user));
	}

	generateTextFromDto(user: AiCaller, dto: AiGenerateTextDto) {
		return this.generateText({ ...dto, user, feature: dto.feature || 'settings' });
	}

	generateImageFromDto(user: AiCaller, dto: AiGenerateImageDto) {
		return this.generateImage({ ...dto, user, feature: dto.feature || 'settings' });
	}

	workspaceId(user: AiCaller): string {
		const id = user?.tenantId || user?.tokenTenantId || user?.adminId || user?.id;
		if (!id) throw new AiException('AI_NOT_CONFIGURED', 'Authenticated user is missing a workspace id.');
		return id;
	}

	private async resolveRequestedModel(
		workspaceId: string,
		type: AiModelType,
		explicit?: string,
		feature?: string,
	): Promise<string | undefined> {
		if (explicit) return explicit;
		if (!feature) return undefined;
		const spec = featureSpec(feature);
		const defaults = await this.limits.getFeatureDefaults(workspaceId);
		const stored = spec ? defaults[spec.id] : defaults[feature];
		if (stored) return stored;
		if (spec?.defaultModelKey && spec.type === type) return spec.defaultModelKey;
		return undefined;
	}

	private async assertModelKeyReady(workspaceId: string, id: string, required: boolean) {
		if (!required) return;
		const row = (await this.models.list(workspaceId)).find((item) => item.id === id);
		if (!row || !providerNeedsKey(row.provider)) return;
		const status = await this.credentials.publicStatus(workspaceId, row.provider);
		if (!status?.configured) {
			throw new BadRequestException(`Save the ${row.provider} API key before enabling this model.`);
		}
	}

	private async run<T>(type: AiModelType, user: AiCaller, feature: string | undefined, fn: () => Promise<T>) {
		try {
			return await fn();
		} catch (err: any) {
			if (err instanceof AiException && err.aiCode === 'AI_LIMIT_REACHED') {
				try {
					await this.limits.logBlocked({
						workspaceId: this.workspaceId(user),
						userId: user.id,
						feature: feature || null,
						provider: GEMINI_PROVIDER_ID,
						modelKey: 'unknown',
						type,
						message: err.message,
					});
				} catch (logErr) {
					this.logger.warn(`Failed to log blocked AI request: ${sanitizeProviderMessage(logErr)}`);
				}
			}
			throw err;
		}
	}

	private async execute<T>(params: {
		workspaceId: string;
		userId: string;
		feature: string | null;
		model: Awaited<ReturnType<AiModelRegistryService['resolve']>>;
		type: AiModelType;
		reservation: LimitReservation;
		run: (apiKey: string) => Promise<{
			payload: T;
			promptTokens: number;
			completionTokens: number;
			totalTokens: number;
			imageCount: number;
		}>;
	}): Promise<T> {
		const started = Date.now();
		let apiKey = '';
		try {
			if (providerNeedsKey(params.model.provider)) {
				apiKey = await this.credentials.getApiKey(params.workspaceId, params.model.provider);
			}
		} catch (err) {
			await this.limits.settle({
				workspaceId: params.workspaceId,
				userId: params.userId,
				feature: params.feature,
				provider: params.model.provider,
				modelKey: params.model.modelKey,
				type: params.type,
				pricing: params.model.pricing,
				status: 'error',
				errorCode: 'AI_NOT_CONFIGURED',
				errorMessage: sanitizeProviderMessage((err as Error)?.message),
				durationMs: Date.now() - started,
				reservation: params.reservation,
			});
			throw err;
		}

		try {
			const result = await params.run(apiKey);
			await this.limits.settle({
				workspaceId: params.workspaceId,
				userId: params.userId,
				feature: params.feature,
				provider: params.model.provider,
				modelKey: params.model.modelKey,
				type: params.type,
				promptTokens: result.promptTokens,
				completionTokens: result.completionTokens,
				totalTokens: result.totalTokens,
				imageCount: result.imageCount,
				pricing: params.model.pricing,
				status: 'success',
				durationMs: Date.now() - started,
				reservation: params.reservation,
			});
			return result.payload;
		} catch (err: any) {
			await this.limits.settle({
				workspaceId: params.workspaceId,
				userId: params.userId,
				feature: params.feature,
				provider: params.model.provider,
				modelKey: params.model.modelKey,
				type: params.type,
				pricing: params.model.pricing,
				status: 'error',
				errorCode: err?.aiCode || 'AI_PROVIDER_ERROR',
				errorMessage: sanitizeProviderMessage(err?.message),
				durationMs: Date.now() - started,
				reservation: params.reservation,
			});
			this.logger.warn(`AI ${params.type} failed for ${params.model.modelKey}: ${sanitizeProviderMessage(err?.message)}`);
			throw err;
		}
	}
}
