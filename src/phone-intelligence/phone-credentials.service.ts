import {
	BadRequestException,
	Injectable,
	ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { PhoneIntelligenceCredential } from './entities/phone-intelligence.entity';
import {
	getProviderCatalog,
	PHONE_CREDENTIAL_PROVIDERS,
	PHONE_PROVIDER_CATALOG,
	PhoneCredentialProvider,
} from './phone-provider-catalog';

export type CredentialPayload = Record<string, string>;

@Injectable()
export class PhoneCredentialsService {
	constructor(
		@InjectRepository(PhoneIntelligenceCredential)
		private readonly credentialRepo: Repository<PhoneIntelligenceCredential>,
		private readonly config: ConfigService,
	) {}

	catalog() {
		return PHONE_PROVIDER_CATALOG.map(item => ({
			id: item.id,
			name: item.name,
			purposeEn: item.purposeEn,
			purposeAr: item.purposeAr,
			docsUrl: item.docsUrl,
			signupUrl: item.signupUrl,
			stepsEn: item.stepsEn,
			stepsAr: item.stepsAr,
			fields: item.fields.map(f => ({
				key: f.key,
				labelEn: f.labelEn,
				labelAr: f.labelAr,
				placeholder: f.placeholder,
				secret: Boolean(f.secret),
			})),
		}));
	}

	async listStatus() {
		const statuses = await Promise.all(
			PHONE_CREDENTIAL_PROVIDERS.map(provider => this.credentialStatus(provider)),
		);
		return {
			providers: statuses,
			catalog: this.catalog(),
			localCarrierGuess: true,
			ddgSearchEnabled: !['0', 'false', 'no', 'off'].includes(
				String(this.config.get('PHONE_DDG_SEARCH') ?? 'true').toLowerCase(),
			),
			note:
				'Keys are encrypted at rest. Env vars still work as fallback if no DB key is saved.',
		};
	}

	async credentialStatus(provider: string) {
		const id = this.assertProvider(provider);
		const catalog = getProviderCatalog(id)!;
		const stored = await this.credentialRepo.findOne({ where: { provider: id } });
		const envPayload = this.envPayload(id);
		const envConfigured = this.isPayloadComplete(id, envPayload);

		return {
			provider: id,
			name: catalog.name,
			configured: Boolean(stored) || envConfigured,
			lastFour: stored?.keyLastFour || this.maskFromPayload(envPayload),
			source: stored ? 'database' : envConfigured ? 'environment' : null,
			updatedAt: stored?.updatedAt || null,
			fields: catalog.fields.map(f => f.key),
		};
	}

	async saveCredential(userId: string, provider: string, fields: CredentialPayload) {
		const id = this.assertProvider(provider);
		const catalog = getProviderCatalog(id)!;
		const normalized: CredentialPayload = {};

		for (const field of catalog.fields) {
			const raw = String(fields?.[field.key] ?? '').trim();
			const min = field.minLength || 4;
			if (!raw || raw.length < min) {
				throw new BadRequestException(
					`${field.labelEn} is required (min ${min} characters)`,
				);
			}
			normalized[field.key] = raw;
		}

		let stored = await this.credentialRepo.findOne({ where: { provider: id } });
		if (!stored) stored = this.credentialRepo.create({ provider: id });
		stored.encryptedPayload = this.encrypt(JSON.stringify(normalized));
		stored.keyLastFour = this.maskFromPayload(normalized);
		stored.updatedBy = userId || null;
		await this.credentialRepo.save(stored);
		return this.credentialStatus(id);
	}

	async removeCredential(provider: string) {
		const id = this.assertProvider(provider);
		await this.credentialRepo.delete({ provider: id });
		return this.credentialStatus(id);
	}

	/** Resolve secrets for runtime API calls (DB first, then env). */
	async resolve(provider: PhoneCredentialProvider): Promise<CredentialPayload | null> {
		const stored = await this.credentialRepo.findOne({ where: { provider } });
		if (stored) {
			try {
				const parsed = JSON.parse(this.decrypt(stored.encryptedPayload)) as CredentialPayload;
				if (this.isPayloadComplete(provider, parsed)) return parsed;
			} catch {
				throw new ServiceUnavailableException(
					`Saved ${provider} credentials cannot be decrypted. Save them again from Phone Check settings.`,
				);
			}
		}
		const envPayload = this.envPayload(provider);
		return this.isPayloadComplete(provider, envPayload) ? envPayload : null;
	}

	private assertProvider(provider: string): PhoneCredentialProvider {
		if (!PHONE_CREDENTIAL_PROVIDERS.includes(provider as PhoneCredentialProvider)) {
			throw new BadRequestException('Unsupported phone intelligence provider');
		}
		return provider as PhoneCredentialProvider;
	}

	private isPayloadComplete(provider: PhoneCredentialProvider, payload: CredentialPayload) {
		const catalog = getProviderCatalog(provider);
		if (!catalog) return false;
		return catalog.fields.every(f => Boolean(String(payload?.[f.key] || '').trim()));
	}

	private envPayload(provider: PhoneCredentialProvider): CredentialPayload {
		switch (provider) {
			case 'twilio':
				return {
					accountSid: this.config.get<string>('TWILIO_ACCOUNT_SID')?.trim() || '',
					authToken: this.config.get<string>('TWILIO_AUTH_TOKEN')?.trim() || '',
				};
			case 'abstract':
				return { apiKey: this.config.get<string>('ABSTRACT_API_KEY')?.trim() || '' };
			case 'numverify':
				return { apiKey: this.config.get<string>('NUMVERIFY_API_KEY')?.trim() || '' };
			case 'serpapi':
				return { apiKey: this.config.get<string>('SERPAPI_API_KEY')?.trim() || '' };
			case 'google_cse':
				return {
					apiKey: this.config.get<string>('GOOGLE_CSE_API_KEY')?.trim() || '',
					cx: this.config.get<string>('GOOGLE_CSE_CX')?.trim() || '',
				};
			default:
				return {};
		}
	}

	private maskFromPayload(payload: CredentialPayload): string | null {
		const secret =
			payload.authToken || payload.apiKey || payload.accountSid || Object.values(payload)[0];
		if (!secret || secret.length < 4) return null;
		return secret.slice(-4);
	}

	private encryptionKey() {
		const jwtSecret = this.config.get<string>('JWT_SECRET') || 'so7bafit-dev-secret';
		return createHash('sha256')
			.update(`so7bafit:phone-intelligence-credentials:${jwtSecret}`)
			.digest();
	}

	private encrypt(value: string) {
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
		const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
		return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
	}

	private decrypt(value: string) {
		const payload = Buffer.from(value, 'base64');
		const iv = payload.subarray(0, 12);
		const tag = payload.subarray(12, 28);
		const ciphertext = payload.subarray(28);
		const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
	}
}
