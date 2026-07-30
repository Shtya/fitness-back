import {
	BadRequestException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
	MetaWaConnectionStatus,
	MetaWhatsAppConfig,
} from '../entities/meta-whatsapp.entity';
import { SaveMetaWhatsAppConfigDto } from '../dto/meta-whatsapp.dto';
import { MetaWhatsAppCryptoService, MetaWhatsAppSecrets } from './meta-whatsapp-crypto.service';
import { MetaWhatsAppCloudApiService } from './meta-whatsapp-cloud-api.service';
import { MetaWhatsAppActivityService } from './meta-whatsapp-activity.service';

@Injectable()
export class MetaWhatsAppConfigService {
	constructor(
		@InjectRepository(MetaWhatsAppConfig)
		private readonly configRepo: Repository<MetaWhatsAppConfig>,
		private readonly crypto: MetaWhatsAppCryptoService,
		private readonly cloudApi: MetaWhatsAppCloudApiService,
		private readonly activity: MetaWhatsAppActivityService,
	) {}

	async getOrCreate(): Promise<MetaWhatsAppConfig> {
		const existing = await this.configRepo.find({ order: { createdAt: 'ASC' }, take: 1 });
		if (existing[0]) return existing[0];
		const row = this.configRepo.create({
			enabled: false,
			connectionStatus: MetaWaConnectionStatus.DISCONNECTED,
		});
		return this.configRepo.save(row);
	}

	async getPublicStatus() {
		const cfg = await this.getOrCreate();
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
		const cfg = await this.getOrCreate();
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

		await this.activity.log('config.saved', userId, {
			phoneNumberId: cfg.phoneNumberId,
			wabaId: cfg.wabaId,
			enabled: cfg.enabled,
			secretsUpdated: secretsComplete && touchingSecrets,
		});

		return this.getPublicStatus();
	}

	async setEnabled(userId: string, enabled: boolean) {
		const cfg = await this.getOrCreate();
		if (enabled) {
			this.assertConnectionFields(cfg, this.safeSecrets(cfg));
		}
		cfg.enabled = enabled;
		if (!enabled) cfg.connectionStatus = MetaWaConnectionStatus.DISABLED;
		cfg.updatedBy = userId || null;
		await this.configRepo.save(cfg);
		await this.activity.log(enabled ? 'integration.enabled' : 'integration.disabled', userId);
		return this.getPublicStatus();
	}

	async validate(userId: string) {
		const cfg = await this.getOrCreate();
		this.assertConnectionFields(cfg, this.safeSecrets(cfg));
		const runtime = await this.requireRuntime();
		try {
			const result = await this.cloudApi.validateCredentials({
				accessToken: runtime.secrets.accessToken,
				phoneNumberId: runtime.config.phoneNumberId!,
				wabaId: runtime.config.wabaId,
			});
			runtime.config.displayPhoneNumber = result.displayPhoneNumber;
			runtime.config.connectionStatus = MetaWaConnectionStatus.CONNECTED;
			runtime.config.lastValidatedAt = new Date();
			runtime.config.lastError = null;
			await this.configRepo.save(runtime.config);
			await this.activity.log('credentials.validated', userId, {
				displayPhoneNumber: result.displayPhoneNumber,
				verifiedName: result.verifiedName,
			});
			return { ok: true, ...result, status: await this.getPublicStatus() };
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

	async listTemplates() {
		const runtime = await this.requireRuntime();
		if (!runtime.config.wabaId) {
			throw new BadRequestException('WABA ID is required to list message templates');
		}
		return this.cloudApi.listMessageTemplates(
			runtime.secrets.accessToken,
			runtime.config.wabaId,
		);
	}

	async uploadTemplateHeader(
		userId: string,
		file: { buffer: Buffer; mimetype?: string; originalname?: string },
	) {
		const runtime = await this.requireRuntime();
		if (!runtime.config.wabaId) {
			throw new BadRequestException('WABA ID is required to upload template media');
		}
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
			runtime.config.wabaId,
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
		const runtime = await this.requireRuntime();
		if (!runtime.config.wabaId) {
			throw new BadRequestException('WABA ID is required to create message templates');
		}
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
			runtime.config.wabaId,
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

	async requireRuntime(options?: { requireEnabled?: boolean }) {
		const config = await this.getOrCreate();
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

	async resolveSecretsForWebhook(): Promise<{
		config: MetaWhatsAppConfig;
		secrets: MetaWhatsAppSecrets;
	} | null> {
		const config = await this.getOrCreate();
		if (!config.encryptedCredentials) return null;
		try {
			return { config, secrets: this.crypto.decryptSecrets(config.encryptedCredentials) };
		} catch {
			return null;
		}
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
