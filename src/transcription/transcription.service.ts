import {
	BadGatewayException,
	BadRequestException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import {
	Transcription,
	TranscriptionProviderCredential,
} from 'entities/transcription.entity';
import FormData = require('form-data');
import * as crypto from 'crypto';
import { createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { Repository } from 'typeorm';
import { CreateTranscriptionDto } from './dto/transcription.dto';

type WhisperResponse = {
	text: string;
	language?: string;
	duration_seconds?: number;
	processing_time_seconds?: number;
};

type GroqResponse = {
	text: string;
	language?: string;
	duration?: number;
};

const CLOUD_PROVIDERS = ['groq', 'deepgram', 'assemblyai'] as const;
type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

export type AudioUpload = {
	mimetype: string;
	originalname: string;
	path: string;
	size: number;
};

@Injectable()
export class TranscriptionService {
	constructor(
		@InjectRepository(Transcription)
		private readonly transcriptionRepo: Repository<Transcription>,
		@InjectRepository(TranscriptionProviderCredential)
		private readonly credentialRepo: Repository<TranscriptionProviderCredential>,
		private readonly config: ConfigService,
	) {}

	private counts(text: string) {
		const trimmed = text.trim();
		return {
			wordCount: trimmed ? trimmed.split(/\s+/u).length : 0,
			characterCount: text.length,
		};
	}

	private serviceError(error: any, fallback: string) {
		return (
			error?.response?.data?.error?.message ||
			error?.response?.data?.detail ||
			error?.response?.data?.message ||
			(error instanceof Error ? error.message : fallback)
		);
	}

	private credentialEncryptionKey() {
		const configured = this.config.get<string>('TRANSCRIPTION_CREDENTIAL_ENCRYPTION_KEY')?.trim();
		if (configured) {
			const key = Buffer.from(configured, 'base64');
			if (key.length !== 32) {
				throw new ServiceUnavailableException(
					'TRANSCRIPTION_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
				);
			}
			return key;
		}
		const jwtSecret = this.config.get<string>('JWT_SECRET');
		if (!jwtSecret) {
			throw new ServiceUnavailableException(
				'Configure TRANSCRIPTION_CREDENTIAL_ENCRYPTION_KEY before saving provider keys',
			);
		}
		return crypto
			.createHash('sha256')
			.update(`so7bafit:transcription-credentials:${jwtSecret}`)
			.digest();
	}

	private encryptCredential(value: string) {
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv('aes-256-gcm', this.credentialEncryptionKey(), iv);
		const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
		return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
	}

	private decryptCredential(value: string) {
		const payload = Buffer.from(value, 'base64');
		const iv = payload.subarray(0, 12);
		const tag = payload.subarray(12, 28);
		const ciphertext = payload.subarray(28);
		const decipher = crypto.createDecipheriv(
			'aes-256-gcm',
			this.credentialEncryptionKey(),
			iv,
		);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
	}

	private assertCloudProvider(provider: string): asserts provider is CloudProvider {
		if (!CLOUD_PROVIDERS.includes(provider as CloudProvider)) {
			throw new BadRequestException('Unsupported cloud transcription provider');
		}
	}

	private providerEnvironmentKey(provider: CloudProvider) {
		const names: Record<CloudProvider, string> = {
			groq: 'GROQ_API_KEY',
			deepgram: 'DEEPGRAM_API_KEY',
			assemblyai: 'ASSEMBLYAI_API_KEY',
		};
		return this.config.get<string>(names[provider])?.trim() || '';
	}

	private async resolveProviderApiKey(provider: CloudProvider) {
		const stored = await this.credentialRepo.findOne({ where: { provider } });
		if (stored) {
			try {
				return this.decryptCredential(stored.encryptedApiKey);
			} catch {
				throw new ServiceUnavailableException(
					`The saved ${provider} key cannot be decrypted. Save it again from Transcript settings.`,
				);
			}
		}
		return this.providerEnvironmentKey(provider);
	}

	async credentialStatus(provider: string) {
		this.assertCloudProvider(provider);
		const stored = await this.credentialRepo.findOne({ where: { provider } });
		const environmentKey = this.providerEnvironmentKey(provider);
		return {
			configured: Boolean(stored || environmentKey),
			lastFour: stored?.keyLastFour || (environmentKey ? environmentKey.slice(-4) : null),
			source: stored ? 'database' : environmentKey ? 'environment' : null,
			updatedAt: stored?.updatedAt || null,
		};
	}

	async saveCredential(userId: string, provider: string, apiKey: string) {
		this.assertCloudProvider(provider);
		const normalized = apiKey.trim();
		let stored = await this.credentialRepo.findOne({ where: { provider } });
		if (!stored) stored = this.credentialRepo.create({ provider });
		stored.encryptedApiKey = this.encryptCredential(normalized);
		stored.keyLastFour = normalized.slice(-4);
		stored.updatedBy = userId;
		await this.credentialRepo.save(stored);
		return this.credentialStatus(provider);
	}

	async removeCredential(provider: string) {
		this.assertCloudProvider(provider);
		await this.credentialRepo.delete({ provider });
		return this.credentialStatus(provider);
	}

	private async transcribeLocal(
		file: AudioUpload,
		language: string,
		customVocabulary?: string,
	): Promise<WhisperResponse> {
		const serviceUrl =
			this.config.get<string>('TRANSCRIPTION_SERVICE_URL') || 'http://127.0.0.1:8000';
		const internalKey = this.config.get<string>('TRANSCRIPTION_SERVICE_API_KEY') || '';
		const form = new FormData();
		form.append('file', createReadStream(file.path), {
			filename: file.originalname,
			contentType: file.mimetype,
		});
		form.append('language', language);
		if (customVocabulary) form.append('custom_vocabulary', customVocabulary);

		try {
			const response = await axios.post<WhisperResponse>(
				`${serviceUrl.replace(/\/$/, '')}/transcribe`,
				form,
				{
					headers: {
						...form.getHeaders(),
						...(internalKey ? { 'x-internal-api-key': internalKey } : {}),
					},
					timeout: Number(this.config.get<string>('TRANSCRIPTION_TIMEOUT_MS')) || 1_800_000,
					maxBodyLength: Infinity,
					maxContentLength: Infinity,
				},
			);
			return response.data;
		} catch (error: any) {
			throw new BadGatewayException(
				`Local transcription failed: ${String(this.serviceError(error, 'unknown error')).slice(0, 500)}`,
			);
		}
	}

	private async transcribeGroq(
		file: AudioUpload,
		language: string,
		customVocabulary?: string,
	): Promise<WhisperResponse> {
		const apiKey = await this.resolveProviderApiKey('groq');
		if (!apiKey) {
			throw new ServiceUnavailableException(
				'Groq is not configured. Add GROQ_API_KEY to backend/.env and restart the backend.',
			);
		}
		if (file.size > 25 * 1024 * 1024) {
			throw new BadRequestException('Groq free tier accepts files up to 25 MB');
		}

		const startedAt = Date.now();
		const form = new FormData();
		form.append('file', createReadStream(file.path), {
			filename: file.originalname,
			contentType: file.mimetype,
		});
		form.append(
			'model',
			this.config.get<string>('GROQ_TRANSCRIPTION_MODEL') || 'whisper-large-v3-turbo',
		);
		form.append('response_format', 'verbose_json');
		form.append('temperature', '0');
		if (language !== 'auto') form.append('language', language);
		if (customVocabulary) form.append('prompt', customVocabulary);

		try {
			const response = await axios.post<GroqResponse>(
				'https://api.groq.com/openai/v1/audio/transcriptions',
				form,
				{
					headers: {
						...form.getHeaders(),
						Authorization: `Bearer ${apiKey}`,
					},
					timeout: 600_000,
					maxBodyLength: Infinity,
					maxContentLength: Infinity,
				},
			);
			return {
				text: response.data.text,
				language: response.data.language,
				duration_seconds: Number(response.data.duration) || 0,
				processing_time_seconds: (Date.now() - startedAt) / 1000,
			};
		} catch (error: any) {
			throw new BadGatewayException(
				`Groq transcription failed: ${String(this.serviceError(error, 'unknown error')).slice(0, 500)}`,
			);
		}
	}

	private async transcribeDeepgram(file: AudioUpload): Promise<WhisperResponse> {
		const apiKey = await this.resolveProviderApiKey('deepgram');
		if (!apiKey) {
			throw new ServiceUnavailableException(
				'Deepgram is not configured. Save a Deepgram API key from Transcript settings.',
			);
		}
		const startedAt = Date.now();
		try {
			const response = await axios.post(
				'https://api.deepgram.com/v1/listen',
				createReadStream(file.path),
				{
					headers: {
						Authorization: `Token ${apiKey}`,
						'Content-Type': file.mimetype || 'application/octet-stream',
					},
					params: {
						model: this.config.get<string>('DEEPGRAM_TRANSCRIPTION_MODEL') || 'nova-3',
						detect_language: true,
						smart_format: true,
						punctuate: true,
					},
					timeout: 600_000,
					maxBodyLength: Infinity,
					maxContentLength: Infinity,
				},
			);
			const channel = response.data?.results?.channels?.[0];
			const alternative = channel?.alternatives?.[0];
			return {
				text: alternative?.transcript || '',
				language: channel?.detected_language || response.data?.metadata?.detected_language,
				duration_seconds: Number(response.data?.metadata?.duration) || 0,
				processing_time_seconds: (Date.now() - startedAt) / 1000,
			};
		} catch (error: any) {
			throw new BadGatewayException(
				`Deepgram transcription failed: ${String(this.serviceError(error, 'unknown error')).slice(0, 500)}`,
			);
		}
	}

	private async transcribeAssemblyAI(file: AudioUpload): Promise<WhisperResponse> {
		const apiKey = await this.resolveProviderApiKey('assemblyai');
		if (!apiKey) {
			throw new ServiceUnavailableException(
				'AssemblyAI is not configured. Save an AssemblyAI API key from Transcript settings.',
			);
		}
		const startedAt = Date.now();
		const headers = { authorization: apiKey };
		try {
			const upload = await axios.post(
				'https://api.assemblyai.com/v2/upload',
				createReadStream(file.path),
				{
					headers: { ...headers, 'Content-Type': 'application/octet-stream' },
					timeout: 600_000,
					maxBodyLength: Infinity,
					maxContentLength: Infinity,
				},
			);
			const created = await axios.post(
				'https://api.assemblyai.com/v2/transcript',
				{
					audio_url: upload.data.upload_url,
					language_detection: true,
					speech_models: ['universal-3-5-pro', 'universal-2'],
				},
				{ headers, timeout: 30_000 },
			);
			const transcriptId = created.data?.id;
			if (!transcriptId) throw new Error('AssemblyAI did not return a transcript id');

			const deadline = Date.now() + 1_800_000;
			while (Date.now() < deadline) {
				const response = await axios.get(
					`https://api.assemblyai.com/v2/transcript/${transcriptId}`,
					{ headers, timeout: 30_000 },
				);
				if (response.data?.status === 'completed') {
					return {
						text: response.data.text || '',
						language: response.data.language_code,
						duration_seconds: Number(response.data.audio_duration) || 0,
						processing_time_seconds: (Date.now() - startedAt) / 1000,
					};
				}
				if (response.data?.status === 'error') {
					throw new Error(response.data.error || 'AssemblyAI transcription failed');
				}
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
			throw new Error('AssemblyAI transcription timed out');
		} catch (error: any) {
			throw new BadGatewayException(
				`AssemblyAI transcription failed: ${String(this.serviceError(error, 'unknown error')).slice(0, 500)}`,
			);
		}
	}

	async transcribe(userId: string, file: AudioUpload, dto: CreateTranscriptionDto) {
		const language = dto?.language || 'auto';
		const provider = dto?.provider || 'local';
		const customVocabulary = dto?.customVocabulary?.trim() || undefined;
		if (!['auto', 'ar', 'en'].includes(language)) {
			await unlink(file.path).catch(() => {});
			throw new BadRequestException('language must be auto, ar, or en');
		}
		if (!['local', 'groq', 'deepgram', 'assemblyai'].includes(provider)) {
			await unlink(file.path).catch(() => {});
			throw new BadRequestException(
				'provider must be local, groq, deepgram, or assemblyai',
			);
		}
		if ((dto?.customVocabulary?.length || 0) > 4000) {
			await unlink(file.path).catch(() => {});
			throw new BadRequestException('customVocabulary is too long');
		}

		let result: WhisperResponse;
		try {
			switch (provider) {
				case 'groq':
					result = await this.transcribeGroq(file, language, customVocabulary);
					break;
				case 'deepgram':
					result = await this.transcribeDeepgram(file);
					break;
				case 'assemblyai':
					result = await this.transcribeAssemblyAI(file);
					break;
				default:
					result = await this.transcribeLocal(file, language, customVocabulary);
			}
		} finally {
			await unlink(file.path).catch(() => {});
		}

		if (typeof result.text !== 'string') {
			throw new BadGatewayException('Transcription service returned an invalid response');
		}

		const counts = this.counts(result.text);
		const record = this.transcriptionRepo.create({
			userId,
			originalFileName: file.originalname,
			provider,
			text: result.text,
			requestedLanguage: language,
			detectedLanguage: result.language || null,
			customVocabulary: customVocabulary || null,
			durationSeconds: Number(result.duration_seconds) || 0,
			processingTimeSeconds: Number(result.processing_time_seconds) || 0,
			...counts,
		});
		return this.transcriptionRepo.save(record);
	}

	async list(userId: string, limit = 25) {
		const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
		return this.transcriptionRepo.find({
			where: { userId },
			order: { createdAt: 'DESC' },
			take: safeLimit,
		});
	}

	async update(userId: string, id: string, text: string) {
		const record = await this.transcriptionRepo.findOne({ where: { id, userId } });
		if (!record) throw new NotFoundException('Transcription not found');
		if (typeof text !== 'string') throw new BadRequestException('text is required');
		record.text = text;
		Object.assign(record, this.counts(text));
		return this.transcriptionRepo.save(record);
	}

	async remove(userId: string, id: string) {
		const record = await this.transcriptionRepo.findOne({ where: { id, userId } });
		if (!record) throw new NotFoundException('Transcription not found');
		await this.transcriptionRepo.remove(record);
		return { ok: true };
	}
}
