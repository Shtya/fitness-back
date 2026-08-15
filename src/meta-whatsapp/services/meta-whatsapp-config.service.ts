import {
	BadRequestException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from 'entities/global.entity';
import {
	MetaWaConnectionStatus,
	MetaWhatsAppConfig,
} from '../entities/meta-whatsapp.entity';
import { SaveMetaWhatsAppConfigDto } from '../dto/meta-whatsapp.dto';
import { MetaWhatsAppCryptoService, MetaWhatsAppSecrets } from './meta-whatsapp-crypto.service';
import { MetaWhatsAppCloudApiService } from './meta-whatsapp-cloud-api.service';
import { MetaWhatsAppActivityService } from './meta-whatsapp-activity.service';
import {
	getSo7baSeedTemplatePreviews,
	SO7BA_META_TEMPLATE_SEEDS,
} from '../seeds/so7ba-meta-templates.seed';
import { metaWaOwnerUserId, MetaWaActor } from '../meta-whatsapp-actor';

@Injectable()
export class MetaWhatsAppConfigService {
	constructor(
		@InjectRepository(MetaWhatsAppConfig)
		private readonly configRepo: Repository<MetaWhatsAppConfig>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		private readonly crypto: MetaWhatsAppCryptoService,
		private readonly cloudApi: MetaWhatsAppCloudApiService,
		private readonly activity: MetaWhatsAppActivityService,
	) {}

	async getOrCreate(userId: string): Promise<MetaWhatsAppConfig> {
		if (!userId) {
			throw new BadRequestException('Authenticated user is required');
		}
		const actor = await this.loadActor(userId);
		const ownerUserId = metaWaOwnerUserId(actor);
		const tenantId = actor.tenantId || null;

		const existing = await this.configRepo.findOne({ where: { ownerUserId } });
		if (existing) {
			if (tenantId && !existing.tenantId) {
				existing.tenantId = tenantId;
				await this.configRepo.save(existing);
			}
			return existing;
		}

		const legacy = await this.configRepo.findOne({
			where: { ownerUserId: IsNull() },
			order: { createdAt: 'ASC' },
		});
		if (legacy) {
			const email = String(actor.email || '').toLowerCase();
			const canClaim =
				email === 'admin@gmail.com' ||
				(legacy.updatedBy &&
					(legacy.updatedBy === userId || legacy.updatedBy === ownerUserId));
			if (canClaim) {
				legacy.ownerUserId = ownerUserId;
				legacy.tenantId = tenantId || legacy.tenantId;
				return this.configRepo.save(legacy);
			}
		}

		return this.configRepo.save(
			this.configRepo.create({
				enabled: false,
				connectionStatus: MetaWaConnectionStatus.DISCONNECTED,
				ownerUserId,
				tenantId,
			}),
		);
	}

	async getPublicStatus(userId: string) {
		const cfg = await this.getOrCreate(userId);
		const secrets = this.safeSecrets(cfg);
		const webhookCallbackUrl = this.buildWebhookCallbackUrl(cfg.webhookPath);
		return {
			id: cfg.id,
			enabled: cfg.enabled,
			phoneNumberId: cfg.phoneNumberId,
			wabaId: cfg.wabaId,
			displayPhoneNumber: cfg.displayPhoneNumber,
			connectionStatus: cfg.enabled
				? cfg.connectionStatus
				: MetaWaConnectionStatus.DISABLED,
			lastValidatedAt: cfg.lastValidatedAt,
			lastError: cfg.lastError,
			webhookPath: cfg.webhookPath,
			webhookCallbackUrl,
			webhookUrlHint: webhookCallbackUrl,
			/** Admins need plaintext to paste into Meta Developer Console / edit config. */
			verifyToken: secrets?.verifyToken || null,
			accessToken: secrets?.accessToken || null,
			appSecret: secrets?.appSecret || null,
			hasAccessToken: Boolean(secrets?.accessToken),
			accessTokenHint: this.crypto.maskSecret(secrets?.accessToken),
			hasAppSecret: Boolean(secrets?.appSecret),
			appSecretHint: this.crypto.maskSecret(secrets?.appSecret),
			hasVerifyToken: Boolean(secrets?.verifyToken),
			verifyTokenHint: this.crypto.maskSecret(secrets?.verifyToken),
			graphApiVersion: process.env.META_GRAPH_API_VERSION || 'v21.0',
			updatedAt: cfg.updatedAt,
		};
	}

	private buildWebhookCallbackUrl(webhookPath: string) {
		const path =
			webhookPath?.startsWith('/api/')
				? webhookPath
				: '/api/v1/meta-whatsapp/webhook';
		const base =
			process.env.META_WHATSAPP_PUBLIC_API_URL?.trim() ||
			process.env.PUBLIC_API_URL?.trim() ||
			'';
		if (!base) return path;
		const clean = base.replace(/\/$/, '');
		if (clean.endsWith('/api/v1')) return `${clean}/meta-whatsapp/webhook`;
		if (/\/api\/v1\/meta-whatsapp\/webhook\/?$/.test(clean)) return clean;
		return `${clean}/api/v1/meta-whatsapp/webhook`;
	}

	async save(userId: string, dto: SaveMetaWhatsAppConfigDto) {
		const cfg = await this.getOrCreate(userId);
		const current = this.safeSecrets(cfg) || {
			accessToken: '',
			appSecret: '',
			verifyToken: '',
		};

		if (dto.accessToken?.trim()) current.accessToken = dto.accessToken.trim();
		if (dto.appSecret?.trim()) current.appSecret = dto.appSecret.trim();
		if (dto.verifyToken?.trim()) {
			current.verifyToken = dto.verifyToken.trim();
			cfg.verifyTokenHash = this.crypto.hashVerifyToken(current.verifyToken);
		}
		if (dto.phoneNumberId !== undefined) {
			cfg.phoneNumberId = dto.phoneNumberId?.trim() || null;
		}
		if (dto.wabaId !== undefined) {
			cfg.wabaId = dto.wabaId?.trim() || null;
		}
		if (cfg.wabaId && cfg.phoneNumberId && cfg.wabaId === cfg.phoneNumberId) {
			throw new BadRequestException(
				'WABA ID cannot be the same as Phone Number ID. In Meta Developer → WhatsApp → API Setup, copy WhatsApp Business Account ID into WABA ID.',
			);
		}
		if (dto.enabled !== undefined) cfg.enabled = Boolean(dto.enabled);

		if (!cfg.phoneNumberId) {
			throw new BadRequestException('Phone Number ID is required');
		}

		const secretsComplete = Boolean(
			current.accessToken && current.verifyToken && current.appSecret,
		);
		const touchingSecrets = Boolean(
			dto.accessToken?.trim() || dto.appSecret?.trim() || dto.verifyToken?.trim(),
		);

		if (touchingSecrets && !secretsComplete) {
			throw new BadRequestException(
				'Access token, Verify token, and App secret are all required when updating credentials',
			);
		}

		if (secretsComplete) {
			cfg.encryptedCredentials = this.crypto.encryptSecrets(current);
			if (!cfg.verifyTokenHash && current.verifyToken) {
				cfg.verifyTokenHash = this.crypto.hashVerifyToken(current.verifyToken);
			}
		}

		cfg.updatedBy = userId || null;
		cfg.lastError = null;
		await this.configRepo.save(cfg);

		await this.activity.log(
			'config.saved',
			userId,
			{
				phoneNumberId: cfg.phoneNumberId,
				wabaId: cfg.wabaId,
				enabled: cfg.enabled,
				secretsUpdated: secretsComplete && touchingSecrets,
			},
			cfg.id,
		);

		return this.getPublicStatus(userId);
	}

	async setEnabled(userId: string, enabled: boolean) {
		const cfg = await this.getOrCreate(userId);
		if (enabled) {
			this.assertConnectionFields(cfg, this.safeSecrets(cfg));
		}
		cfg.enabled = enabled;
		if (!enabled) cfg.connectionStatus = MetaWaConnectionStatus.DISABLED;
		cfg.updatedBy = userId || null;
		await this.configRepo.save(cfg);
		await this.activity.log(
			enabled ? 'integration.enabled' : 'integration.disabled',
			userId,
			undefined,
			cfg.id,
		);
		return this.getPublicStatus(userId);
	}

	async validate(userId: string) {
		const cfg = await this.getOrCreate(userId);
		this.assertConnectionFields(cfg, this.safeSecrets(cfg));
		const runtime = await this.requireRuntime(userId);
		try {
			const result = await this.cloudApi.validateCredentials({
				accessToken: runtime.secrets.accessToken,
				phoneNumberId: runtime.config.phoneNumberId!,
				wabaId: runtime.config.wabaId,
			});
			runtime.config.displayPhoneNumber = result.displayPhoneNumber;
			if (result.wabaId) runtime.config.wabaId = result.wabaId;
			runtime.config.connectionStatus = MetaWaConnectionStatus.CONNECTED;
			runtime.config.lastValidatedAt = new Date();
			runtime.config.lastError = null;
			await this.configRepo.save(runtime.config);
			await this.activity.log('credentials.validated', userId, {
				displayPhoneNumber: result.displayPhoneNumber,
				verifiedName: result.verifiedName,
				wabaId: result.wabaId,
				wabaAutoResolved: result.wabaAutoResolved,
			});
			return { ok: true, ...result, status: await this.getPublicStatus(userId) };
		} catch (error) {
			runtime.config.connectionStatus = MetaWaConnectionStatus.ERROR;
			runtime.config.lastError =
				error instanceof Error ? error.message : 'Validation failed';
			await this.configRepo.save(runtime.config);
			await this.activity.log('credentials.validation_failed', userId, {
				error: runtime.config.lastError,
			});
			throw error;
		}
	}

	async ensureWabaId(runtime: {
		config: MetaWhatsAppConfig;
		secrets: MetaWhatsAppSecrets;
	}) {
		if (!runtime.config.phoneNumberId) {
			throw new BadRequestException('Phone Number ID is required');
		}
		const resolved = await this.cloudApi.resolveWabaId({
			accessToken: runtime.secrets.accessToken,
			phoneNumberId: runtime.config.phoneNumberId,
			wabaId: runtime.config.wabaId,
		});
		if (resolved.autoResolved || runtime.config.wabaId !== resolved.wabaId) {
			runtime.config.wabaId = resolved.wabaId;
			await this.configRepo.save(runtime.config);
		}
		return resolved.wabaId;
	}

	async listTemplates(userId: string) {
		const runtime = await this.requireRuntime(userId);
		const phoneId = String(runtime.config.phoneNumberId || '').trim();
		let wabaId = String(runtime.config.wabaId || '').trim();

		// Fix only the obvious mix-up: WABA field equals Phone Number ID (or empty)
		if (!wabaId || wabaId === phoneId) {
			if (wabaId === phoneId) runtime.config.wabaId = null;
			wabaId = await this.ensureWabaId(runtime);
		}

		try {
			return await this.cloudApi.listMessageTemplates(
				runtime.secrets.accessToken,
				wabaId,
			);
		} catch (err) {
			throw new BadRequestException(
				this.cloudApi.explainWhatsAppAccessError(this.extractErrorMessage(err), {
					phoneNumberId: phoneId,
					wabaId,
				}),
			);
		}
	}

	private extractErrorMessage(err: unknown) {
		const response =
			typeof (err as any)?.getResponse === 'function' ? (err as any).getResponse() : null;
		const raw =
			typeof response === 'string'
				? response
				: response?.message || (err as any)?.message || '';
		return Array.isArray(raw) ? raw.join(', ') : String(raw);
	}

	async uploadTemplateHeader(
		userId: string,
		file: { buffer: Buffer; mimetype?: string; originalname?: string },
	) {
		const runtime = await this.requireRuntime(userId);
		const wabaId = await this.ensureWabaId(runtime);
		if (!file?.buffer?.length) {
			throw new BadRequestException('Sample media file is required');
		}
		const mime = String(file.mimetype || 'application/octet-stream');
		const allowed = [
			'image/jpeg',
			'image/jpg',
			'image/png',
			'video/mp4',
			'application/pdf',
		];
		if (!allowed.includes(mime.toLowerCase()) && !mime.startsWith('image/')) {
			throw new BadRequestException('Use JPEG/PNG image, MP4 video, or PDF document');
		}
		const handle = await this.cloudApi.uploadTemplateHeaderHandle(
			runtime.secrets.accessToken,
			wabaId,
			file.buffer,
			mime,
			file.originalname || 'sample',
		);
		await this.activity.log('template.header_uploaded', userId, {
			mime,
			fileName: file.originalname,
		});
		return { headerHandle: handle };
	}

	async createTemplate(
		userId: string,
		dto: {
			name: string;
			language: string;
			category: string;
			bodyText: string;
			headerFormat?: string;
			headerText?: string;
			headerHandle?: string;
			footerText?: string;
			buttons?: Array<{
				type: string;
				text: string;
				url?: string;
				phone_number?: string;
			}>;
			exampleBodyParams?: string[];
			exampleHeaderParams?: string[];
		},
	) {
		const runtime = await this.requireRuntime(userId);
		const wabaId = await this.ensureWabaId(runtime);
		const name = String(dto.name || '')
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, '_');
		if (!name || name.length < 3) {
			throw new BadRequestException(
				'Template name must be at least 3 chars (lowercase letters, numbers, underscores)',
			);
		}
		const category = String(dto.category || 'UTILITY').toUpperCase();
		if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(category)) {
			throw new BadRequestException('Category must be UTILITY, MARKETING, or AUTHENTICATION');
		}
		const language = String(dto.language || 'en').trim() || 'en';
		const bodyText = String(dto.bodyText || '').trim();
		if (!bodyText) {
			throw new BadRequestException('Template body text is required');
		}
		this.assertPositionalVars(bodyText, 'body');
		if (dto.headerText) this.assertPositionalVars(dto.headerText, 'header');

		const headerFormat = String(dto.headerFormat || 'NONE').toUpperCase();
		if (!['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
			throw new BadRequestException('Invalid header format');
		}

		const created = await this.cloudApi.createMessageTemplate(
			runtime.secrets.accessToken,
			wabaId,
			{
				name,
				language,
				category,
				bodyText,
				headerFormat,
				headerText: dto.headerText,
				headerHandle: dto.headerHandle,
				footerText: dto.footerText,
				buttons: dto.buttons,
				exampleBodyParams: dto.exampleBodyParams,
				exampleHeaderParams: dto.exampleHeaderParams,
			},
		);
		await this.activity.log('template.created', userId, {
			name,
			language,
			category,
			headerFormat,
			buttons: dto.buttons?.length || 0,
			id: created?.id,
			status: created?.status,
		});
		return {
			...created,
			name: created?.name || name,
			language: created?.language || language,
			category: created?.category || category,
		};
	}

	async updateTemplate(
		userId: string,
		templateId: string,
		dto: {
			category?: string;
			bodyText: string;
			headerFormat?: string;
			headerText?: string;
			headerHandle?: string;
			existingHeaderComponent?: Record<string, any>;
			footerText?: string;
			buttons?: Array<{
				type: string;
				text: string;
				url?: string;
				phone_number?: string;
			}>;
			exampleBodyParams?: string[];
			exampleHeaderParams?: string[];
		},
	) {
		const runtime = await this.requireRuntime(userId);
		const id = String(templateId || '').trim();
		if (!id) throw new BadRequestException('Template id is required');

		const bodyText = String(dto.bodyText || '').trim();
		if (!bodyText) {
			throw new BadRequestException('Template body text is required');
		}
		this.assertPositionalVars(bodyText, 'body');
		if (dto.headerText) this.assertPositionalVars(dto.headerText, 'header');

		const headerFormat = String(dto.headerFormat || 'NONE').toUpperCase();
		if (!['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
			throw new BadRequestException('Invalid header format');
		}

		const existingHeader =
			dto.existingHeaderComponent &&
			String(dto.existingHeaderComponent.type || '').toUpperCase() === 'HEADER'
				? dto.existingHeaderComponent
				: undefined;

		const updated = await this.cloudApi.editMessageTemplate(
			runtime.secrets.accessToken,
			id,
			{
				bodyText,
				headerFormat,
				headerText: dto.headerText,
				headerHandle: dto.headerHandle,
				existingHeaderComponent: existingHeader,
				footerText: dto.footerText,
				buttons: dto.buttons,
				exampleBodyParams: dto.exampleBodyParams,
				exampleHeaderParams: dto.exampleHeaderParams,
			},
		);
		await this.activity.log('template.updated', userId, {
			templateId: id,
			headerFormat,
			buttons: dto.buttons?.length || 0,
			status: updated?.status,
			success: updated?.success,
		});
		return {
			...updated,
			id,
			category: updated?.category || dto.category,
		};
	}

	listSeedTemplates() {
		return {
			presentation: {
				en: 'https://so7bafit.com/en/presentation',
				ar: 'https://so7bafit.com/ar/presentation',
			},
			note:
				'Preview only. Submit with POST /meta-whatsapp/templates/seed after verifying connection. Meta must APPROVE marketing templates before send.',
			templates: getSo7baSeedTemplatePreviews(),
		};
	}

	async listTemplateLibrary(userId: string, query?: { search?: string; language?: string }) {
		const runtime = await this.requireRuntime(userId);
		try {
			const templates = await this.cloudApi.listTemplateLibrary(runtime.secrets.accessToken, {
				search: query?.search,
				language: query?.language,
				limit: 40,
			});
			await this.activity.log('template.library_listed', userId, {
				count: templates.length,
				search: query?.search || null,
			});
			return {
				source: 'meta_library',
				verification: [
					{
						key: 'hello_world',
						name: 'hello_world',
						language: 'en_US',
						category: 'UTILITY',
						body: 'Welcome and congratulations!! This message demonstrates your ability to send a message from WhatsApp Business Platform. Thank you for taking the time to test with us.',
						isVerification: true,
						alreadyOnAccount: true,
						note:
							'Meta sample template. On live (non-test) phone numbers Meta returns (#131058). Use Public Test Number, or verify with your own APPROVED template.',
					},
				],
				templates,
			};
		} catch (err) {
			throw new BadRequestException(
				this.cloudApi.explainWhatsAppAccessError(this.extractErrorMessage(err), {
					phoneNumberId: runtime.config.phoneNumberId,
					wabaId: runtime.config.wabaId,
				}),
			);
		}
	}

	async createFromLibrary(
		userId: string,
		dto: {
			name: string;
			language: string;
			libraryTemplateName: string;
			category?: string;
			libraryTemplateButtonInputs?: any[];
			buttons?: any[];
			buttonUrl?: string;
			buttonPhone?: string;
		},
	) {
		const runtime = await this.requireRuntime(userId);
		const wabaId = await this.ensureWabaId(runtime);
		const name = String(dto.name || '')
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, '_');
		if (name.length < 3) {
			throw new BadRequestException('Template name must be at least 3 characters');
		}
		try {
			const created = await this.cloudApi.createMessageTemplateFromLibrary(
				runtime.secrets.accessToken,
				wabaId,
				{
					name,
					language: dto.language,
					category: dto.category || 'UTILITY',
					libraryTemplateName: dto.libraryTemplateName,
					libraryTemplateButtonInputs: dto.libraryTemplateButtonInputs,
					buttons: dto.buttons,
					buttonUrl: dto.buttonUrl,
					buttonPhone:
						dto.buttonPhone || runtime.config.displayPhoneNumber || undefined,
				},
			);
			await this.activity.log('template.created_from_library', userId, {
				name,
				libraryTemplateName: dto.libraryTemplateName,
				id: created?.id,
				status: created?.status,
			});
			return {
				id: created?.id,
				status: created?.status || 'PENDING',
				category: created?.category || dto.category || 'UTILITY',
				name: created?.name || name,
				language: created?.language || dto.language,
				libraryTemplateName: dto.libraryTemplateName,
			};
		} catch (err) {
			throw new BadRequestException(
				this.cloudApi.explainWhatsAppAccessError(this.extractErrorMessage(err), {
					phoneNumberId: runtime.config.phoneNumberId,
					wabaId,
				}),
			);
		}
	}

	async deleteTemplate(userId: string, input: { name?: string; hsmId?: string }) {
		const name = String(input.name || '').trim();
		const hsmId = String(input.hsmId || '').trim();
		if (!name) {
			throw new BadRequestException('Template name is required');
		}
		const runtime = await this.requireRuntime(userId);
		const wabaId = await this.ensureWabaId(runtime);
		try {
			const result = await this.cloudApi.deleteMessageTemplate(
				runtime.secrets.accessToken,
				wabaId,
				{ name, hsmId },
			);
			await this.activity.log('template.deleted', userId, { name, hsmId: hsmId || null });
			return { ok: true, name, hsmId: hsmId || null, ...result };
		} catch (err) {
			throw new BadRequestException(
				this.cloudApi.explainWhatsAppAccessError(this.extractErrorMessage(err), {
					phoneNumberId: runtime.config.phoneNumberId,
					wabaId,
				}),
			);
		}
	}

	async submitSeedTemplates(userId: string, keys?: string[]) {
		const selected = keys?.length
			? SO7BA_META_TEMPLATE_SEEDS.filter(t => keys.includes(t.key) || keys.includes(t.name))
			: SO7BA_META_TEMPLATE_SEEDS;

		if (!selected.length) {
			throw new BadRequestException('No matching seed templates');
		}

		const results: Array<{
			key: string;
			name: string;
			language: string;
			ok: boolean;
			status?: string;
			id?: string;
			error?: string;
		}> = [];

		for (const seed of selected) {
			try {
				if (seed.bodyText.length > 1024) {
					throw new BadRequestException(
						`Body too long (${seed.bodyText.length}/1024) for ${seed.name}`,
					);
				}
				const created = await this.createTemplate(userId, {
					name: seed.name,
					language: seed.language,
					category: seed.category,
					headerFormat: seed.headerFormat,
					headerText: seed.headerText,
					bodyText: seed.bodyText,
					footerText: seed.footerText,
					buttons: seed.buttons,
					exampleBodyParams: seed.exampleBodyParams,
				});
				results.push({
					key: seed.key,
					name: seed.name,
					language: seed.language,
					ok: true,
					status: created?.status || 'PENDING',
					id: created?.id,
				});
			} catch (err: any) {
				const response =
					typeof err?.getResponse === 'function' ? err.getResponse() : null;
				const raw =
					typeof response === 'string'
						? response
						: response?.message || err?.message || 'Failed';
				results.push({
					key: seed.key,
					name: seed.name,
					language: seed.language,
					ok: false,
					error: Array.isArray(raw) ? raw.join(', ') : String(raw),
				});
			}
		}

		await this.activity.log('template.seed_submitted', userId, {
			count: selected.length,
			ok: results.filter(r => r.ok).length,
			failed: results.filter(r => !r.ok).length,
		});

		return {
			preview: getSo7baSeedTemplatePreviews().filter(t =>
				selected.some(s => s.key === t.key),
			),
			results,
			submitted: results.filter(r => r.ok).length,
			failed: results.filter(r => !r.ok).length,
		};
	}

	/**
	 * Clone existing Meta templates under new names with a different category.
	 * Default: so7ba_fitness_outreach_ar/en → so7ba_fitness_util_ar/en as UTILITY.
	 */
	async cloneTemplatesAsCategory(
		userId: string,
		dto?: {
			names?: string[];
			category?: string;
			nameSuffix?: string;
			nameMap?: Record<string, string>;
		},
	) {
		const category = String(dto?.category || 'UTILITY').toUpperCase();
		if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(category)) {
			throw new BadRequestException('Category must be UTILITY, MARKETING, or AUTHENTICATION');
		}

		const defaultNames = ['so7ba_fitness_outreach_ar', 'so7ba_fitness_outreach_en'];
		const defaultNameMap: Record<string, string> = {
			so7ba_fitness_outreach_ar: 'so7ba_fitness_util_ar',
			so7ba_fitness_outreach_en: 'so7ba_fitness_util_en',
		};
		const names = (dto?.names?.length ? dto.names : defaultNames).map(n =>
			String(n || '').trim().toLowerCase(),
		);
		const nameSuffix = String(dto?.nameSuffix || '_util')
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, '_');
		const nameMap = { ...defaultNameMap, ...(dto?.nameMap || {}) };

		const existing = await this.listTemplates(userId);
		const results: Array<{
			sourceName: string;
			sourceLanguage?: string;
			newName?: string;
			ok: boolean;
			status?: string;
			id?: string;
			category?: string;
			error?: string;
		}> = [];

		for (const sourceName of names) {
			const matches = existing.filter(
				(t: any) => String(t.name || '').toLowerCase() === sourceName,
			);
			if (!matches.length) {
				results.push({
					sourceName,
					ok: false,
					error: `Template "${sourceName}" not found on Meta`,
				});
				continue;
			}

			for (const source of matches) {
				try {
					const mapped = nameMap[sourceName];
					const newName = mapped
						? mapped
						: `${String(source.name || sourceName).slice(0, 512 - nameSuffix.length)}${nameSuffix}`
								.toLowerCase()
								.replace(/[^a-z0-9_]/g, '_');
					if (newName === String(source.name || '').toLowerCase()) {
						throw new BadRequestException(
							'Cloned template name must differ from the source name',
						);
					}
					const parsed = this.parseMetaTemplateComponents(source.components || []);
					if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(parsed.headerFormat)) {
						throw new BadRequestException(
							`Cannot auto-clone ${parsed.headerFormat} header for ${source.name} — re-upload media sample manually`,
						);
					}
					const created = await this.createTemplate(userId, {
						name: newName,
						language: source.language || 'en_US',
						category,
						...parsed,
					});
					results.push({
						sourceName: source.name,
						sourceLanguage: source.language,
						newName: created?.name || newName,
						ok: true,
						status: created?.status || 'PENDING',
						id: created?.id,
						category: created?.category || category,
					});
				} catch (err: any) {
					const response =
						typeof err?.getResponse === 'function' ? err.getResponse() : null;
					const raw =
						typeof response === 'string'
							? response
							: response?.message || err?.message || 'Failed';
					results.push({
						sourceName: source.name || sourceName,
						sourceLanguage: source.language,
						ok: false,
						error: Array.isArray(raw) ? raw.join(', ') : String(raw),
					});
				}
			}
		}

		await this.activity.log('template.cloned', userId, {
			category,
			count: results.length,
			ok: results.filter(r => r.ok).length,
			failed: results.filter(r => !r.ok).length,
		});

		return {
			category,
			results,
			submitted: results.filter(r => r.ok).length,
			failed: results.filter(r => !r.ok).length,
			note: 'Meta may still reclassify marketing-style copy during review even if submitted as UTILITY.',
		};
	}

	parseMetaTemplateComponents(components: any[]) {
		const comps = Array.isArray(components) ? components : [];
		const header = comps.find(c => String(c?.type || '').toUpperCase() === 'HEADER');
		const body = comps.find(c => String(c?.type || '').toUpperCase() === 'BODY');
		const footer = comps.find(c => String(c?.type || '').toUpperCase() === 'FOOTER');
		const buttonsComp = comps.find(c => String(c?.type || '').toUpperCase() === 'BUTTONS');

		const headerFormat = String(
			header?.format || (header?.text ? 'TEXT' : 'NONE'),
		).toUpperCase();
		const bodyText = String(body?.text || '').trim();
		if (!bodyText) {
			throw new BadRequestException('Source template has no body text');
		}

		const exampleBodyParams = Array.isArray(body?.example?.body_text?.[0])
			? body.example.body_text[0].map((v: any) => String(v))
			: undefined;
		const exampleHeaderParams = Array.isArray(header?.example?.header_text)
			? header.example.header_text.map((v: any) => String(v))
			: undefined;

		const buttons = (buttonsComp?.buttons || [])
			.map((b: any) => ({
				type: String(b.type || '').toUpperCase(),
				text: String(b.text || '').trim(),
				url: b.url ? String(b.url).trim() : undefined,
				phone_number: b.phone_number ? String(b.phone_number).trim() : undefined,
			}))
			.filter((b: any) => b.text && ['URL', 'QUICK_REPLY', 'PHONE_NUMBER'].includes(b.type));

		return {
			headerFormat: (['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)
				? headerFormat
				: 'NONE') as string,
			headerText: headerFormat === 'TEXT' ? String(header?.text || '').trim() || undefined : undefined,
			footerText: String(footer?.text || '').trim() || undefined,
			bodyText,
			buttons: buttons.length ? buttons : undefined,
			exampleBodyParams,
			exampleHeaderParams,
		};
	}

	private assertPositionalVars(text: string, field: string) {
		const named = [...String(text || '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
		for (const m of named) {
			if (!/^\d+$/.test(String(m[1]).trim())) {
				throw new BadRequestException(
					`Use numbered variables like {{1}}, {{2}} in ${field} — not {{${m[1].trim()}}}`,
				);
			}
		}
		const positional = named.map(m => Number(m[1]));
		if (!positional.length) return;
		const unique = [...new Set(positional)].sort((a, b) => a - b);
		for (let i = 0; i < unique.length; i += 1) {
			if (unique[i] !== i + 1) {
				throw new BadRequestException(
					`Variables in ${field} must be sequential: {{1}}, {{2}}, {{3}}…`,
				);
			}
		}
	}

	async requireRuntime(userId: string, options?: { requireEnabled?: boolean }) {
		const config = await this.getOrCreate(userId);
		return this.runtimeFromConfig(config, options);
	}

	runtimeFromConfig(
		config: MetaWhatsAppConfig,
		options?: { requireEnabled?: boolean },
	) {
		if (options?.requireEnabled && !config.enabled) {
			throw new ServiceUnavailableException('Meta WhatsApp integration is disabled');
		}
		if (!config.encryptedCredentials || !config.phoneNumberId) {
			throw new NotFoundException('Meta WhatsApp is not configured');
		}
		const secrets = this.crypto.decryptSecrets(config.encryptedCredentials);
		if (!secrets.accessToken) {
			throw new NotFoundException('Meta WhatsApp access token is missing');
		}
		return { config, secrets };
	}

	async resolveSecretsByPhoneNumberId(phoneNumberId: string): Promise<{
		config: MetaWhatsAppConfig;
		secrets: MetaWhatsAppSecrets;
	} | null> {
		const id = String(phoneNumberId || '').trim();
		if (!id) return null;
		const config = await this.configRepo.findOne({ where: { phoneNumberId: id } });
		return this.safeRuntime(config);
	}

	async resolveSecretsByVerifyToken(token: string): Promise<{
		config: MetaWhatsAppConfig;
		secrets: MetaWhatsAppSecrets;
	} | null> {
		const rows = await this.configRepo.find({
			where: {},
			take: 200,
		});
		for (const config of rows) {
			const runtime = this.safeRuntime(config);
			if (!runtime) continue;
			const ok =
				this.crypto.verifyTokenMatches(token, config.verifyTokenHash) ||
				token === runtime.secrets.verifyToken;
			if (ok) return runtime;
		}
		return null;
	}

	private safeRuntime(config: MetaWhatsAppConfig | null): {
		config: MetaWhatsAppConfig;
		secrets: MetaWhatsAppSecrets;
	} | null {
		if (!config?.encryptedCredentials) return null;
		try {
			return { config, secrets: this.crypto.decryptSecrets(config.encryptedCredentials) };
		} catch {
			return null;
		}
	}

	private async loadActor(userId: string): Promise<MetaWaActor> {
		const user = await this.userRepo.findOne({
			where: { id: userId },
			select: ['id', 'tenantId', 'adminId', 'role', 'email'],
		});
		if (user) {
			return {
				id: user.id,
				tenantId: user.tenantId,
				adminId: user.adminId,
				role: user.role,
				email: user.email,
			};
		}
		return { id: userId };
	}

	private safeSecrets(cfg: MetaWhatsAppConfig): MetaWhatsAppSecrets | null {
		if (!cfg.encryptedCredentials) return null;
		try {
			return this.crypto.decryptSecrets(cfg.encryptedCredentials);
		} catch {
			return null;
		}
	}

	/** Fields required before Verify connection / Enable. */
	private assertConnectionFields(
		cfg: MetaWhatsAppConfig,
		secrets: MetaWhatsAppSecrets | null,
	) {
		const missing: string[] = [];
		if (!cfg.phoneNumberId?.trim()) missing.push('Phone Number ID');
		if (!cfg.wabaId?.trim()) missing.push('WABA ID');
		if (!secrets?.accessToken?.trim()) missing.push('Permanent Access Token');
		if (!secrets?.verifyToken?.trim()) missing.push('Verify Token');
		if (!secrets?.appSecret?.trim()) missing.push('App Secret');
		if (missing.length) {
			throw new BadRequestException(
				`Missing required fields: ${missing.join(', ')}. Save all fields first.`,
			);
		}
	}
}
