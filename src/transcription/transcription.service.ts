import {
	BadGatewayException,
	BadRequestException,
	HttpException,
	Injectable,
	Logger,
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
import { readFile, unlink } from 'fs/promises';
import { Repository } from 'typeorm';
import { AiFreeService } from '../ai-free/ai-free.service';
import {
	CreateTextTranscriptionDto,
	CreateTranscriptionDto,
	EnhanceTranscriptionDto,
	MemorizeTranscriptionDto,
	SummarizeTranscriptionDto,
} from './dto/transcription.dto';

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
	private readonly logger = new Logger(TranscriptionService.name);

	constructor(
		@InjectRepository(Transcription)
		private readonly transcriptionRepo: Repository<Transcription>,
		@InjectRepository(TranscriptionProviderCredential)
		private readonly credentialRepo: Repository<TranscriptionProviderCredential>,
		private readonly config: ConfigService,
		private readonly aiFree: AiFreeService,
	) {}

	private counts(text: string) {
		const trimmed = text.trim();
		return {
			wordCount: trimmed ? trimmed.split(/\s+/u).length : 0,
			characterCount: text.length,
		};
	}

	private serviceError(error: any, fallback: string) {
		const data = error?.response?.data;
		const nested = data?.error;
		if (typeof nested === 'string' && nested.trim()) return nested;
		if (nested?.message) return nested.message;
		if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail;
		if (typeof data?.message === 'string' && data.message.trim()) return data.message;
		if (Array.isArray(data?.message) && data.message.length) {
			return data.message.map(String).join(', ');
		}
		if (error instanceof Error && error.message) return error.message;
		return fallback;
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

	/** Stored transcription key only — env fallback stays with the caller. */
	async tryReadStoredApiKey(provider: string): Promise<{ key: string; lastFour: string } | null> {
		if (!CLOUD_PROVIDERS.includes(provider as CloudProvider)) return null;
		const stored = await this.credentialRepo.findOne({ where: { provider } });
		if (!stored?.encryptedApiKey) return null;
		try {
			const key = this.decryptCredential(stored.encryptedApiKey)?.trim();
			if (!key) return null;
			return { key, lastFour: stored.keyLastFour || key.slice(-4) };
		} catch {
			return null;
		}
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

	private async transcribeAssemblyAI(
		file: AudioUpload,
		language = 'auto',
	): Promise<WhisperResponse> {
		const apiKey = await this.resolveProviderApiKey('assemblyai');
		if (!apiKey) {
			throw new ServiceUnavailableException(
				'AssemblyAI is not configured. Save an AssemblyAI API key from Transcript settings.',
			);
		}
		const startedAt = Date.now();
		const headers = { authorization: apiKey };
		try {
			const bytes = await readFile(file.path);
			if (!bytes.length) {
				throw new BadRequestException('Audio file is empty');
			}
			const upload = await axios.post(
				'https://api.assemblyai.com/v2/upload',
				bytes,
				{
					headers: {
						...headers,
						'Content-Type': 'application/octet-stream',
						'Content-Length': String(bytes.length),
					},
					timeout: 600_000,
					maxBodyLength: Infinity,
					maxContentLength: Infinity,
				},
			);
			const uploadUrl = upload.data?.upload_url;
			if (!uploadUrl) throw new Error('AssemblyAI did not return an upload URL');

			const createTranscript = async (payload: Record<string, unknown>) => {
				const created = await axios.post(
					'https://api.assemblyai.com/v2/transcript',
					payload,
					{ headers, timeout: 30_000 },
				);
				const transcriptId = created.data?.id;
				if (!transcriptId) throw new Error('AssemblyAI did not return a transcript id');
				return transcriptId as string;
			};

			const basePayload: Record<string, unknown> = {
				audio_url: uploadUrl,
				speech_models: ['universal-3-5-pro', 'universal-2'],
			};
			if (language === 'ar' || language === 'en') {
				basePayload.language_code = language;
			} else {
				basePayload.language_detection = true;
			}

			let transcriptId = await createTranscript(basePayload);
			const deadline = Date.now() + 1_800_000;
			let retriedWithoutDetection = false;

			while (Date.now() < deadline) {
				const response = await axios.get(
					`https://api.assemblyai.com/v2/transcript/${transcriptId}`,
					{ headers, timeout: 30_000 },
				);
				const status = response.data?.status;
				if (status === 'completed') {
					return {
						text: response.data.text || '',
						language: response.data.language_code,
						duration_seconds: Number(response.data.audio_duration) || 0,
						processing_time_seconds: (Date.now() - startedAt) / 1000,
					};
				}
				if (status === 'error') {
					const errText = String(response.data?.error || 'AssemblyAI transcription failed');
					const detectionFailed =
						!retriedWithoutDetection &&
						/language_detection/i.test(errText) &&
						language === 'auto';
					if (detectionFailed) {
						retriedWithoutDetection = true;
						transcriptId = await createTranscript({
							audio_url: uploadUrl,
							speech_models: ['universal-3-5-pro', 'universal-2'],
							language_code: 'ar',
						});
						continue;
					}
					throw new Error(errText);
				}
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
			throw new Error('AssemblyAI transcription timed out');
		} catch (error: any) {
			if (error instanceof HttpException) throw error;
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
					result = await this.transcribeAssemblyAI(file, language);
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

	async createFromText(userId: string, dto: CreateTextTranscriptionDto) {
		const text = String(dto?.text || '').trim();
		if (!text) throw new BadRequestException('text is required');
		if (text.length > 2_000_000) {
			throw new BadRequestException('Transcript text is too long');
		}
		const language = dto?.language || 'auto';
		if (!['auto', 'ar', 'en'].includes(language)) {
			throw new BadRequestException('language must be auto, ar, or en');
		}
		const originalFileName = String(dto?.originalFileName || 'whatsapp-selection.txt').slice(
			0,
			255,
		);
		const record = this.transcriptionRepo.create({
			userId,
			originalFileName,
			provider: 'local',
			text,
			requestedLanguage: language,
			detectedLanguage: null,
			customVocabulary: null,
			durationSeconds: 0,
			processingTimeSeconds: 0,
			...this.counts(text),
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

	private detectScriptLocale(text: string) {
		const sample = String(text || '');
		const arabicChars = (sample.match(/[\u0600-\u06FF]/g) || []).length;
		const latinChars = (sample.match(/[A-Za-z]/g) || []).length;
		if (arabicChars === 0 && latinChars === 0) return 'en';
		return arabicChars >= latinChars ? 'ar' : 'en';
	}

	private resolveLocale(
		locale: string | undefined,
		requestedLanguage: string | null | undefined,
		text: string,
	) {
		const explicit = String(locale || '').toLowerCase();
		if (explicit === 'auto' || !explicit) {
			return this.detectScriptLocale(text);
		}
		if (explicit.startsWith('ar')) return 'ar';
		if (explicit.startsWith('en')) return 'en';
		const requested = String(requestedLanguage || '').toLowerCase();
		if (requested.startsWith('ar')) return 'ar';
		if (requested.startsWith('en')) return 'en';
		return this.detectScriptLocale(text);
	}

	private looksTranslated(source: string, enhanced: string) {
		const sourceLocale = this.detectScriptLocale(source);
		const outputLocale = this.detectScriptLocale(enhanced);
		if (sourceLocale === outputLocale) return false;
		const sourceAr = (source.match(/[\u0600-\u06FF]/g) || []).length;
		const outputAr = (enhanced.match(/[\u0600-\u06FF]/g) || []).length;
		const sourceEn = (source.match(/[A-Za-z]/g) || []).length;
		const outputEn = (enhanced.match(/[A-Za-z]/g) || []).length;
		if (sourceLocale === 'ar') {
			return sourceAr >= 20 && outputAr < Math.max(8, sourceAr * 0.35);
		}
		return sourceEn >= 20 && outputEn < Math.max(8, sourceEn * 0.35);
	}

	private tryParseJson(text: unknown) {
		const raw = String(text || '').trim();
		if (!raw) return null;
		const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
		const candidate = fenced || raw;
		try {
			return JSON.parse(candidate);
		} catch {
			const start = candidate.indexOf('{');
			const end = candidate.lastIndexOf('}');
			if (start >= 0 && end > start) {
				try {
					return JSON.parse(candidate.slice(start, end + 1));
				} catch {
					return null;
				}
			}
			return null;
		}
	}

	private asObject(value: unknown): Record<string, any> {
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, any>)
			: {};
	}

	private asStringArray(value: unknown, limit = 24) {
		if (!Array.isArray(value)) return [];
		return value
			.map(item => String(item || '').trim())
			.filter(Boolean)
			.slice(0, limit);
	}

	private localEnhanceTranscript(text: string) {
		return String(text || '')
			.replace(/\u00a0/g, ' ')
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.replace(/[ \t]{2,}/g, ' ')
			.replace(/\s+([,.!?؟،؛:…])/g, '$1')
			.trim();
	}

	private extractEnhancedText(reply: unknown, fallback: string) {
		const parsed = this.asObject(this.tryParseJson(reply));
		const fromJson = String(parsed.enhancedText || '').trim();
		if (fromJson) {
			return {
				enhancedText: fromJson,
				changesSummary: this.asStringArray(parsed.changesSummary, 12),
			};
		}
		const raw = String(reply || '').trim();
		if (!raw) {
			return { enhancedText: fallback, changesSummary: [] as string[] };
		}
		const cleaned = raw
			.replace(/^```(?:json)?\s*/i, '')
			.replace(/\s*```$/i, '')
			.trim();
		if (cleaned.startsWith('{')) {
			return { enhancedText: fallback, changesSummary: [] as string[] };
		}
		if (cleaned.length >= Math.max(12, Math.floor(fallback.length * 0.35))) {
			return {
				enhancedText: cleaned,
				changesSummary: ['Corrected formatting from free AI response.'],
			};
		}
		return { enhancedText: fallback, changesSummary: [] as string[] };
	}

	async enhance(user: any, id: string, dto: EnhanceTranscriptionDto) {
		const userId = String(user?.id || '');
		const record = await this.transcriptionRepo.findOne({ where: { id, userId } });
		if (!record) throw new NotFoundException('Transcription not found');

		const before = String(dto?.text ?? record.text ?? '').trim();
		if (!before) throw new BadRequestException('Transcript text is required');
		if (before.length > 2_000_000) {
			throw new BadRequestException('Transcript text is too long');
		}

		const locale = this.detectScriptLocale(before);
		const mode = dto?.mode || 'full';
		const apply = dto?.apply === true;

		const system = `You clean speech-to-text transcripts for So7baFit.
Fix wrong words, spelling, punctuation, spacing, and unclear sentences using context only.
Keep the same language (Arabic dialect / English / mixed). Never translate. Never summarize. Never invent facts.
Return ONLY JSON: {"enhancedText":"...","changesSummary":["..."]}`;

		const userMessage = `Mode: ${mode}
Language: ${locale}
Correct this transcript in-place and return JSON only.

---
${before.slice(0, 60_000)}`;

		let enhancedText = before;
		let changesSummary: string[] = [];
		let provider: string | null = null;
		let model: string | null = null;
		let usedLocalFallback = false;

		try {
			const ai = await this.aiFree.chat(user, {
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: userMessage },
				],
				allowFallback: true,
				useProjectKnowledge: false,
				provider: 'llm7-free',
				excludeProviders: ['browser-chatgpt', 'pollinations-free'],
				maxTokens: 4096,
			} as any);

			const extracted = this.extractEnhancedText(ai?.reply, before);
			const translated = this.looksTranslated(before, extracted.enhancedText);
			enhancedText = translated ? before : extracted.enhancedText;
			changesSummary = translated
				? [
						locale === 'ar'
							? 'تم الإبقاء على لغة المصدر وتجاهل تحويل النص للغة أخرى.'
							: 'Enhancement stayed in the source language; a translated rewrite was discarded.',
					]
				: extracted.changesSummary;
			provider = ai?.provider || null;
			model = ai?.actualModel || null;
		} catch (error) {
			enhancedText = this.localEnhanceTranscript(before);
			usedLocalFallback = enhancedText !== before;
			changesSummary = usedLocalFallback
				? [
						locale === 'ar'
							? 'تعذر الوصول لمزوّد الذكاء الاصطناعي؛ تم تنظيف المسافات وعلامات الترقيم محلياً.'
							: 'Free AI was unavailable; applied local spacing and punctuation cleanup.',
					]
				: [
						locale === 'ar'
							? 'تعذر تحسين النص عبر الذكاء الاصطناعي حالياً.'
							: 'Free AI enhance is temporarily unavailable.',
					];
			provider = 'local-fallback';
			this.logger.warn(
				`Transcription enhance AI failed for ${id}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			// Always return a successful enhance payload when local cleanup ran,
			// even if text is unchanged — UI can still show compare state.
		}

		if (!record.originalText) {
			record.originalText = before;
		}
		record.enhancedText = enhancedText;
		record.enhancementMeta = {
			mode,
			locale,
			changesSummary,
			provider,
			model,
			usedLocalFallback,
			enhancedAt: new Date().toISOString(),
		};

		if (apply) {
			record.text = enhancedText;
			Object.assign(record, this.counts(enhancedText));
		}

		const saved = await this.transcriptionRepo.save(record);
		return {
			id: saved.id,
			originalText: before,
			enhancedText,
			changesSummary,
			provider,
			applied: apply,
			usedLocalFallback,
			transcription: saved,
		};
	}

	async memorize(user: any, id: string, dto: MemorizeTranscriptionDto) {
		const userId = String(user?.id || '');
		const record = await this.transcriptionRepo.findOne({ where: { id, userId } });
		if (!record) throw new NotFoundException('Transcription not found');

		const source = String(
			dto?.text ?? record.enhancedText ?? record.text ?? '',
		).trim();
		if (!source) throw new BadRequestException('Transcript text is required');

		const locale = this.resolveLocale(dto?.locale, record.requestedLanguage, source);
		const depth = dto?.depth || 'detailed';
		const includeFlashcards = dto?.includeFlashcards !== false;

		const system = `You are a study coach that turns speech transcripts into memorable, detailed notes for So7baFit.
Expand unclear spoken ideas into clearer explanations WITHOUT inventing unsupported facts.
Add helpful context, definitions, and study cues based on what the speaker actually talked about.
${locale === 'ar' ? 'Respond in Arabic.' : 'Respond in clear English.'}
Depth: ${depth}
Reply with ONLY valid JSON (no markdown fences):
{
  "tldr": string,
  "expandedNotes": string,
  "keyPoints": string[],
  "terms": [{ "term": string, "definition": string }],
  "remember": string[],
  "flashcards": [{ "front": string, "back": string, "difficulty": "easy"|"medium"|"hard" }],
  "openQuestions": string[]
}
Rules:
- expandedNotes should add more detail and clarity than the raw transcript
- keep flashcards ${includeFlashcards ? 'useful (4-10 cards)' : 'as an empty array'}
- do not invent URLs or fake citations`;

		const userMessage = `Create a memorize pack from this transcript.\nDepth: ${depth}\nLocale: ${locale}\n\n--- TRANSCRIPT ---\n${source.slice(0, 100_000)}`;

		const ai = await this.aiFree.chat(user, {
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: userMessage },
			],
			allowFallback: true,
			useProjectKnowledge: false,
		} as any);

		const parsed = this.asObject(this.tryParseJson(ai?.reply));
		const terms = Array.isArray(parsed.terms)
			? parsed.terms
					.map((item: any) => ({
						term: String(item?.term || '').trim(),
						definition: String(item?.definition || '').trim(),
					}))
					.filter(item => item.term && item.definition)
					.slice(0, 20)
			: [];
		const flashcards = Array.isArray(parsed.flashcards)
			? parsed.flashcards
					.map((item: any) => ({
						front: String(item?.front || '').trim(),
						back: String(item?.back || '').trim(),
						difficulty: ['easy', 'medium', 'hard'].includes(item?.difficulty)
							? item.difficulty
							: 'medium',
					}))
					.filter(item => item.front && item.back)
					.slice(0, includeFlashcards ? 12 : 0)
			: [];

		const memorize = {
			tldr: String(parsed.tldr || '').trim(),
			expandedNotes: String(parsed.expandedNotes || '').trim(),
			keyPoints: this.asStringArray(parsed.keyPoints, 12),
			terms,
			remember: this.asStringArray(parsed.remember, 12),
			flashcards,
			openQuestions: this.asStringArray(parsed.openQuestions, 10),
			provider: ai?.provider || null,
			model: ai?.actualModel || null,
			createdAt: new Date().toISOString(),
			depth,
			locale,
		};

		if (!memorize.tldr && !memorize.expandedNotes) {
			throw new BadGatewayException('AI did not return a usable memorize payload');
		}

		record.memorizePayload = memorize;
		const saved = await this.transcriptionRepo.save(record);
		return {
			id: saved.id,
			memorize,
			transcription: saved,
		};
	}

	async summarize(user: any, id: string, dto: SummarizeTranscriptionDto) {
		const userId = String(user?.id || '');
		const record = await this.transcriptionRepo.findOne({ where: { id, userId } });
		if (!record) throw new NotFoundException('Transcription not found');

		const source = String(dto?.text ?? record.enhancedText ?? record.text ?? '').trim();
		if (!source) throw new BadRequestException('Transcript text is required');
		if (source.length > 2_000_000) {
			throw new BadRequestException('Transcript text is too long');
		}

		const locale = this.detectScriptLocale(source);
		const system = `You are a CRM assistant for So7baFit WhatsApp conversations.
Read a timeline of text tickets and voice transcripts. Infer what the person is asking for and summarize it.
Do NOT invent facts, products, prices, dates, or names that are not supported by the source.
Keep mixed Arabic/English as written.
${locale === 'ar' ? 'Respond in Arabic, the same language as the source.' : 'Respond in clear English, the same language as the source.'}
Never translate the source into a different language.
Reply with ONLY valid JSON (no markdown fences):
{
  "tldr": string,
  "request": string,
  "context": string,
  "asks": string[],
  "nextSteps": string[]
}
Rules:
- tldr: 1-2 sentences
- request: the concrete ask / ticket
- context: useful surrounding detail
- asks: distinct requests (max 8)
- nextSteps: practical follow-ups (max 6), not fabricated commitments`;

		const userMessage = `Summarize this WhatsApp selection and extract the request.\nLocale: ${locale}\n\n--- TIMELINE ---\n${source.slice(0, 100_000)}`;

		const ai = await this.aiFree.chat(user, {
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: userMessage },
			],
			allowFallback: true,
			useProjectKnowledge: false,
		} as any);

		const parsed = this.asObject(this.tryParseJson(ai?.reply));
		const summary = {
			tldr: String(parsed.tldr || '').trim(),
			request: String(parsed.request || '').trim(),
			context: String(parsed.context || '').trim(),
			asks: this.asStringArray(parsed.asks, 8),
			nextSteps: this.asStringArray(parsed.nextSteps, 6),
			provider: ai?.provider || null,
			model: ai?.actualModel || null,
			createdAt: new Date().toISOString(),
			locale,
		};

		if (!summary.tldr && !summary.request) {
			throw new BadGatewayException('AI did not return a usable summary');
		}

		record.summaryPayload = summary;
		const saved = await this.transcriptionRepo.save(record);
		return {
			id: saved.id,
			summary,
			transcription: saved,
		};
	}
}
