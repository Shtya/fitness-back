import {
	BadRequestException,
	Injectable,
	ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { FitnessLeadsCredential } from './entities/fitness-leads.entity';
import {
	FITNESS_CREDENTIAL_PROVIDERS,
	FITNESS_PROVIDER_CATALOG,
	FitnessCredentialProvider,
} from './fitness-provider-catalog';

@Injectable()
export class FitnessLeadsCredentialsService {
	constructor(
		@InjectRepository(FitnessLeadsCredential)
		private readonly credentialRepo: Repository<FitnessLeadsCredential>,
		private readonly config: ConfigService,
	) {}

	catalog() {
		return FITNESS_PROVIDER_CATALOG.map(item => ({
			id: item.id,
			name: item.name,
			purposeEn: item.purposeEn,
			purposeAr: item.purposeAr,
			docsUrl: item.docsUrl,
			signupUrl: item.signupUrl,
			stepsEn: item.stepsEn,
			stepsAr: item.stepsAr,
			required: item.required,
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
		const providers = await Promise.all(
			FITNESS_CREDENTIAL_PROVIDERS.map(p => this.credentialStatus(p)),
		);
		return { providers, catalog: this.catalog() };
	}

	async credentialStatus(provider: string) {
		const id = this.assertProvider(provider);
		const meta = FITNESS_PROVIDER_CATALOG.find(p => p.id === id)!;
		const stored = await this.credentialRepo.findOne({ where: { provider: id } });
		const envPayload = this.envPayload(id);
		const envConfigured = Boolean(envPayload.apiKey);

		return {
			provider: id,
			name: meta.name,
			required: meta.required,
			configured: Boolean(stored) || envConfigured,
			lastFour: stored?.keyLastFour || (envPayload.apiKey ? envPayload.apiKey.slice(-4) : null),
			source: stored ? 'database' : envConfigured ? 'environment' : null,
			updatedAt: stored?.updatedAt || null,
		};
	}

	async saveCredential(userId: string, provider: string, fields: Record<string, string>) {
		const id = this.assertProvider(provider);
		const meta = FITNESS_PROVIDER_CATALOG.find(p => p.id === id)!;
		const normalized: Record<string, string> = {};
		for (const field of meta.fields) {
			const raw = String(fields?.[field.key] ?? '').trim();
			if (!raw || raw.length < (field.minLength || 4)) {
				throw new BadRequestException(`${field.labelEn} is required`);
			}
			normalized[field.key] = raw;
		}
		let stored = await this.credentialRepo.findOne({ where: { provider: id } });
		if (!stored) stored = this.credentialRepo.create({ provider: id });
		stored.encryptedPayload = this.encrypt(JSON.stringify(normalized));
		stored.keyLastFour = normalized.apiKey.slice(-4);
		stored.updatedBy = userId || null;
		await this.credentialRepo.save(stored);
		return this.credentialStatus(id);
	}

	async removeCredential(provider: string) {
		const id = this.assertProvider(provider);
		await this.credentialRepo.delete({ provider: id });
		return this.credentialStatus(id);
	}

	async resolveApiKey(provider: FitnessCredentialProvider): Promise<string | null> {
		const stored = await this.credentialRepo.findOne({ where: { provider } });
		if (stored) {
			try {
				const parsed = JSON.parse(this.decrypt(stored.encryptedPayload));
				return parsed.apiKey || null;
			} catch {
				throw new ServiceUnavailableException(
					`Saved ${provider} key cannot be decrypted. Save it again from Fitness Leads settings.`,
				);
			}
		}
		return this.envPayload(provider).apiKey || null;
	}

	private assertProvider(provider: string): FitnessCredentialProvider {
		if (!FITNESS_CREDENTIAL_PROVIDERS.includes(provider as FitnessCredentialProvider)) {
			throw new BadRequestException('Unsupported fitness leads provider');
		}
		return provider as FitnessCredentialProvider;
	}

	private envPayload(provider: FitnessCredentialProvider) {
		const map: Record<FitnessCredentialProvider, string> = {
			google_places: 'GOOGLE_PLACES_API_KEY',
			hunter: 'HUNTER_API_KEY',
			apollo: 'APOLLO_API_KEY',
			clearbit: 'CLEARBIT_API_KEY',
		};
		return { apiKey: this.config.get<string>(map[provider])?.trim() || '' };
	}

	private encryptionKey() {
		const jwtSecret = this.config.get<string>('JWT_SECRET') || 'so7bafit-dev-secret';
		return createHash('sha256')
			.update(`so7bafit:fitness-leads-credentials:${jwtSecret}`)
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
