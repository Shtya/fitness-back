import {
	BadGatewayException,
	BadRequestException,
	Injectable,
	ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import * as crypto from 'crypto';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Repository } from 'typeorm';
import FormData = require('form-data');
import {
	WhatsAppVoiceChangerCredential,
	WhatsAppVoiceChangerSettings,
} from '../entities/whatsapp.entity';
import { StudioSecretsService } from '../../ai-content-studio/services/studio-secrets.service';
import type { StudioSecretsPayload } from '../../ai-content-studio/services/studio-crypto.service';
import { TranscriptionService } from '../../transcription/transcription.service';
import { runFfmpeg } from '../utils/whatsapp-voice-ogg';
import {
	VOICE_CHANGER_CATALOG,
	ffmpegPitchFilter,
	findVoiceChangerProvider,
	isVoiceChangerProviderId,
	resolveFfmpegPreset,
} from '../utils/whatsapp-voice-changer';

export type VoiceChangerUpload = {
	mimetype: string;
	originalname: string;
	path: string;
	size: number;
};

type TransformOptions = {
	provider?: string;
	preset?: string;
	pitchSemitones?: number;
	voiceId?: string;
	apiKey?: string;
};

type AudioResult = {
	buffer: Buffer;
	mimeType: string;
	fileName: string;
};

const KEY_PROVIDERS = ['elevenlabs', 'groq', 'openai', 'huggingface', 'cartesia'] as const;
type KeyProvider = (typeof KEY_PROVIDERS)[number];
type CredentialSource = 'saved' | 'studio' | 'transcription' | 'environment';
type CredentialStatus = {
	configured: boolean;
	source: CredentialSource | null;
	lastFour: string | null;
};

const STUDIO_KEY_PATH: Record<KeyProvider, (secrets: StudioSecretsPayload) => string | undefined> = {
	elevenlabs: () => undefined,
	cartesia: () => undefined,
	groq: (secrets) => secrets.groq?.apiKey,
	huggingface: (secrets) => secrets.huggingface?.apiKey,
	openai: (secrets) => secrets.openai_compatible?.apiKey,
};

const ELEVENLABS_USABLE_CATEGORIES = new Set(['premade', 'cloned', 'generated']);
const ELEVENLABS_LEGACY_LIBRARY_VOICE_IDS = new Set([
	'21m00Tcm4TlvDq8ikWAM',
	'AZnzlk1XvdvUeBnXmlld',
	'ErXwobaYiN019PkySvjV',
	'MF3mGyEYCl7XYWbV9V6O',
	'TxGEqnHWrfWFTfGW9XjX',
	'VR6AewLTigWG4xSOukaG',
	'pNInz6obpgDQGcFmaJgB',
	'yoZ06aMxZJJ28mfd3POQ',
]);
const ELEVENLABS_PAID_VOICE_MESSAGE =
	'Free ElevenLabs accounts cannot use Voice Library voices via the API. Pick a premade or cloned voice in settings, or switch to the free pitch changer.';

type ElevenLabsVoice = {
	id: string;
	name: string;
	category: string;
};

@Injectable()
export class WhatsAppVoiceChangerService {
	constructor(
		@InjectRepository(WhatsAppVoiceChangerSettings)
		private readonly settingsRepo: Repository<WhatsAppVoiceChangerSettings>,
		@InjectRepository(WhatsAppVoiceChangerCredential)
		private readonly credentialRepo: Repository<WhatsAppVoiceChangerCredential>,
		private readonly studioSecrets: StudioSecretsService,
		private readonly transcription: TranscriptionService,
	) {}

	catalog() {
		return this.cloneCatalog();
	}

	async getSettings(userId: string, options?: { liveCatalog?: boolean }) {
		const liveCatalog = options?.liveCatalog !== false;
		const row =
			(await this.settingsRepo.findOne({ where: { userId } })) ||
			this.settingsRepo.create({
				userId,
				configured: false,
				enabled: false,
				provider: 'off',
				preset: 'deeper',
				pitchSemitones: -6,
				voiceId: null,
			});
		const credentials = await this.credentialRepo.find({ where: { userId } });
		const studioSecrets = await this.studioSecrets.getDbSecrets(userId).catch(() => ({} as StudioSecretsPayload));
		const groqTranscript = await this.transcription
			.credentialStatus('groq')
			.then((status) => (status.source === 'database' ? { lastFour: status.lastFour || '****' } : null))
			.catch(() => null);
		const credentialStatus: Record<string, CredentialStatus> = Object.fromEntries(
			KEY_PROVIDERS.map((provider) => [
				provider,
				this.buildCredentialStatus(provider, credentials, studioSecrets, groqTranscript),
			]),
		);
		credentialStatus.clone = credentialStatus.elevenlabs;
		return {
			configured: Boolean(row.configured),
			enabled: Boolean(row.enabled),
			provider: row.provider || 'off',
			preset: row.preset || 'deeper',
			pitchSemitones: Number(row.pitchSemitones) || -6,
			voiceId: row.voiceId || null,
			credentials: credentialStatus,
			catalog: liveCatalog ? await this.catalogForUser(userId) : this.cloneCatalog(),
		};
	}

	async saveSettings(userId: string, dto: TransformOptions & { configured?: boolean; enabled?: boolean }) {
		const provider = String(dto.provider || 'off').trim();
		if (!isVoiceChangerProviderId(provider)) {
			throw new BadRequestException('Unsupported voice changer provider');
		}
		const preset = resolveFfmpegPreset(String(dto.preset || 'deeper'), dto.pitchSemitones);
		let row = await this.settingsRepo.findOne({ where: { userId } });
		if (!row) row = this.settingsRepo.create({ userId });
		row.configured = dto.configured !== false;
		row.enabled = Boolean(dto.enabled) && provider !== 'off';
		row.provider = provider;
		row.preset = preset.id;
		row.pitchSemitones = preset.pitchSemitones;
		row.voiceId = String(dto.voiceId || '').trim() || null;
		await this.settingsRepo.save(row);
		return this.getSettings(userId);
	}

	async saveCredential(userId: string, provider: string, apiKey: string) {
		const keyProvider = this.credentialProvider(provider);
		this.assertKeyProvider(keyProvider);
		const normalized = apiKey.trim();
		if (normalized.length < 8) throw new BadRequestException('API key is too short');
		let row = await this.credentialRepo.findOne({ where: { userId, provider: keyProvider } });
		if (!row) row = this.credentialRepo.create({ userId, provider: keyProvider });
		row.encryptedApiKey = this.encryptCredential(normalized);
		row.keyLastFour = normalized.slice(-4);
		await this.credentialRepo.save(row);
		return this.getSettings(userId);
	}

	async removeCredential(userId: string, provider: string) {
		const keyProvider = this.credentialProvider(provider);
		this.assertKeyProvider(keyProvider);
		await this.credentialRepo.delete({ userId, provider: keyProvider });
		return this.getSettings(userId);
	}

	async cloneVoice(userId: string, files: VoiceChangerUpload[], name: string, consent: boolean) {
		if (!consent) {
			throw new BadRequestException('Confirm you have permission to clone this voice');
		}
		const trimmed = String(name || '').trim();
		if (trimmed.length < 2) throw new BadRequestException('Give this clone a name');
		if (trimmed.length > 80) throw new BadRequestException('Clone name is too long');
		const samples = (files || []).filter((file) => file?.path);
		if (!samples.length) throw new BadRequestException('Upload at least one voice sample');
		if (samples.length > 10) throw new BadRequestException('Use up to 10 voice samples');
		const apiKey = await this.resolveApiKey(userId, 'elevenlabs');
		if (!apiKey) {
			throw new BadRequestException('Add an ElevenLabs API key first, then clone a voice');
		}
		const form = new FormData();
		form.append('name', trimmed);
		form.append(
			'description',
			'So7baFit WhatsApp reference clone. The account owner confirmed permission to use this voice.',
		);
		form.append('labels', JSON.stringify({ product: 'so7bafit', kind: 'reference' }));
		for (const file of samples) {
			form.append('files', createReadStream(file.path), {
				filename: file.originalname || 'sample.webm',
				contentType: file.mimetype || 'audio/webm',
			});
		}
		let voiceId = '';
		try {
			const response = await axios.post('https://api.elevenlabs.io/v1/voices/add', form, {
				headers: { ...form.getHeaders(), 'xi-api-key': apiKey },
				timeout: 120_000,
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
				validateStatus: (status) => status >= 200 && status < 300,
			});
			voiceId = String(response.data?.voice_id || '').trim();
		} catch (error) {
			throw this.providerError(
				error,
				'Voice clone failed. Instant Voice Cloning must be enabled on the ElevenLabs plan.',
			);
		}
		if (!voiceId) throw new BadGatewayException('ElevenLabs did not return a cloned voice');
		await this.saveSettings(userId, {
			configured: true,
			enabled: true,
			provider: 'clone',
			voiceId,
		});
		const settings = await this.getSettings(userId);
		return { voiceId, name: trimmed, ...settings };
	}

	async transform(userId: string, file: VoiceChangerUpload, options: TransformOptions): Promise<AudioResult> {
		if (!file?.path) throw new BadRequestException('Audio file is required');
		const settings = await this.getSettings(userId, { liveCatalog: false });
		const provider = String(options.provider || settings.provider || 'off');
		if (provider === 'off') {
			return this.readUpload(file);
		}
		if (provider === 'ffmpeg') {
			return this.transformFfmpeg(file, options, settings);
		}
		const apiKey = await this.resolveApiKey(userId, provider, options.apiKey);
		if (!apiKey) {
			throw new BadRequestException(
				`Add an API key for ${provider} first. Open the voice changer settings beside the mic.`,
			);
		}
		if (provider === 'elevenlabs' || provider === 'clone') {
			return this.transformElevenLabs(file, apiKey, options.voiceId || settings.voiceId);
		}
		if (provider === 'cartesia') {
			return this.transformCartesia(file, apiKey, options.voiceId || settings.voiceId);
		}
		if (provider === 'groq') {
			return this.transformGroq(file, apiKey, options.voiceId || settings.voiceId);
		}
		if (provider === 'openai') {
			return this.transformOpenAi(file, apiKey, options.voiceId || settings.voiceId);
		}
		if (provider === 'huggingface') {
			return this.transformHuggingFace(file, apiKey, options.voiceId || settings.voiceId);
		}
		throw new BadRequestException('Unsupported voice changer provider');
	}

	private async readUpload(file: VoiceChangerUpload): Promise<AudioResult> {
		const buffer = await fs.readFile(file.path);
		return {
			buffer,
			mimeType: file.mimetype || 'audio/webm',
			fileName: file.originalname || 'voice.webm',
		};
	}

	private async transformFfmpeg(
		file: VoiceChangerUpload,
		options: TransformOptions,
		settings: Awaited<ReturnType<WhatsAppVoiceChangerService['getSettings']>>,
	): Promise<AudioResult> {
		const preset = resolveFfmpegPreset(options.preset || settings.preset, options.pitchSemitones ?? settings.pitchSemitones);
		const outputPath = await this.tempPath('ogg');
		try {
			await runFfmpeg(
				[
					'-y',
					'-i',
					file.path,
					'-vn',
					'-ac',
					'1',
					'-ar',
					'48000',
					'-af',
					ffmpegPitchFilter(preset.pitchSemitones, [...preset.extraFilters]),
					'-c:a',
					'libopus',
					'-b:a',
					'32k',
					'-application',
					'voip',
					'-f',
					'ogg',
					outputPath,
				],
				45_000,
			);
			const buffer = await fs.readFile(outputPath);
			if (!buffer.length) throw new Error('Converted audio is empty');
			return {
				buffer,
				mimeType: 'audio/ogg; codecs=opus',
				fileName: this.renamed(file.originalname, 'ogg'),
			};
		} finally {
			await fs.rm(outputPath, { force: true }).catch(() => undefined);
		}
	}

	private async transformElevenLabs(file: VoiceChangerUpload, apiKey: string, voiceId?: string | null) {
		const requested = String(voiceId || '').trim();
		const usable = await this.listElevenLabsUsableVoices(apiKey).catch(() => [] as ElevenLabsVoice[]);
		const catalogVoices = findVoiceChangerProvider('elevenlabs')?.voices || [];
		const preferred =
			(requested && !ELEVENLABS_LEGACY_LIBRARY_VOICE_IDS.has(requested) && requested) ||
			usable[0]?.id ||
			catalogVoices[0]?.id ||
			requested ||
			'';
		const recoveries = (usable.length ? usable.map((voice) => voice.id) : catalogVoices.map((voice) => voice.id))
			.filter((id) => id && id !== preferred)
			.slice(0, 3);
		const candidates = [preferred, ...recoveries].filter(Boolean);
		if (!candidates.length) {
			throw new BadRequestException(
				'No ElevenLabs voice is available. Pick a premade or cloned voice in settings.',
			);
		}
		const tried = new Set<string>();
		let lastError: unknown;
		for (const voice of candidates) {
			if (tried.has(voice)) continue;
			tried.add(voice);
			try {
				return await this.postElevenLabsSpeechToSpeech(file, apiKey, voice);
			} catch (error) {
				lastError = error;
				if (!this.isElevenLabsPaidVoiceError(error)) {
					throw this.providerError(error, 'ElevenLabs voice changer failed');
				}
			}
		}
		throw this.providerError(lastError, ELEVENLABS_PAID_VOICE_MESSAGE);
	}

	private async postElevenLabsSpeechToSpeech(file: VoiceChangerUpload, apiKey: string, voice: string) {
		const form = new FormData();
		form.append('audio', createReadStream(file.path), {
			filename: file.originalname || 'voice.webm',
			contentType: file.mimetype || 'audio/webm',
		});
		form.append('model_id', 'eleven_multilingual_sts_v2');
		const response = await axios.post(
			`https://api.elevenlabs.io/v1/speech-to-speech/${encodeURIComponent(voice)}`,
			form,
			{
				params: { output_format: 'mp3_44100_128' },
				headers: { ...form.getHeaders(), 'xi-api-key': apiKey },
				responseType: 'arraybuffer',
				timeout: 90_000,
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
				validateStatus: (status) => status >= 200 && status < 300,
			},
		);
		return {
			buffer: Buffer.from(response.data),
			mimeType: 'audio/mpeg',
			fileName: this.renamed(file.originalname, 'mp3'),
		};
	}

	private cloneCatalog() {
		return VOICE_CHANGER_CATALOG.map((item) => ({
			...item,
			voices: item.voices ? item.voices.map((voice) => ({ ...voice })) : undefined,
		}));
	}

	private async catalogForUser(userId: string) {
		const catalog = this.cloneCatalog();
		const elevenlabs = catalog.find((item) => item.id === 'elevenlabs');
		const clone = catalog.find((item) => item.id === 'clone');
		const apiKey = await this.resolveApiKey(userId, 'elevenlabs');
		if (!apiKey) return catalog;
		try {
			const voices = await this.listElevenLabsUsableVoices(apiKey);
			const mapped = voices.slice(0, 48).map((voice) => ({
				id: voice.id,
				label: voice.category === 'cloned' ? `${voice.name} (clone)` : voice.name,
				labelAr: voice.category === 'cloned' ? `${voice.name} (استنساخ)` : voice.name,
				category: voice.category,
			}));
			if (elevenlabs && mapped.length) elevenlabs.voices = mapped;
			if (clone) {
				clone.voices = mapped.filter((voice) => voice.category === 'cloned');
			}
		} catch {
			/* keep the static premade list when ElevenLabs is unreachable */
		}
		return catalog;
	}

	private async listElevenLabsUsableVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
		const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
			headers: { 'xi-api-key': apiKey },
			params: { show_legacy: false },
			timeout: 20_000,
		});
		const voices = Array.isArray(response.data?.voices) ? response.data.voices : [];
		const usable: ElevenLabsVoice[] = [];
		for (const voice of voices) {
			const id = String(voice?.voice_id || '').trim();
			if (!id) continue;
			if (voice?.is_legacy === true) continue;
			if (ELEVENLABS_LEGACY_LIBRARY_VOICE_IDS.has(id)) continue;
			const category = String(voice?.category || '').toLowerCase();
			if (category && !ELEVENLABS_USABLE_CATEGORIES.has(category)) continue;
			usable.push({
				id,
				name: String(voice?.name || 'Voice').trim() || 'Voice',
				category: category || 'premade',
			});
		}
		usable.sort((left, right) => {
			const rank = (category: string) => (category === 'premade' ? 0 : category === 'cloned' ? 1 : 2);
			return rank(left.category) - rank(right.category) || left.name.localeCompare(right.name);
		});
		return usable;
	}

	private isElevenLabsPaidVoiceError(error: unknown) {
		const payload = this.decodeAxiosErrorBody(error);
		const snippet = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
		const code = this.readErrorField(payload, 'code');
		const status = this.readErrorField(payload, 'status');
		return (
			code === 'paid_plan_required' ||
			status === 'payment_required' ||
			/paid_plan_required|payment_required|library voices/i.test(snippet)
		);
	}

	private readErrorField(payload: unknown, key: string): string | null {
		if (!payload || typeof payload !== 'object') return null;
		const root = payload as Record<string, any>;
		const detail = root.detail && typeof root.detail === 'object' ? root.detail : null;
		const value = detail?.[key] ?? root[key];
		return value == null ? null : String(value);
	}

	private async transformCartesia(file: VoiceChangerUpload, apiKey: string, voiceId?: string | null) {
		const voice =
			String(voiceId || '').trim() || findVoiceChangerProvider('cartesia')?.voices?.[0]?.id || '';
		const form = new FormData();
		form.append('clip', createReadStream(file.path), {
			filename: file.originalname || 'voice.webm',
			contentType: file.mimetype || 'audio/webm',
		});
		form.append('voice[id]', voice);
		form.append('output_format[container]', 'mp3');
		form.append('output_format[sample_rate]', '44100');
		form.append('output_format[bit_rate]', '128000');
		try {
			const response = await axios.post('https://api.cartesia.ai/voice-changer/bytes', form, {
				headers: {
					...form.getHeaders(),
					Authorization: `Bearer ${apiKey}`,
					'Cartesia-Version': '2024-11-13',
				},
				responseType: 'arraybuffer',
				timeout: 90_000,
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
			});
			return {
				buffer: Buffer.from(response.data),
				mimeType: 'audio/mpeg',
				fileName: this.renamed(file.originalname, 'mp3'),
			};
		} catch (error: any) {
			throw this.providerError(error, 'Cartesia voice changer failed');
		}
	}

	private async transformGroq(file: VoiceChangerUpload, apiKey: string, voiceId?: string | null) {
		const text = await this.transcribeGroq(file, apiKey);
		const arabic = this.isArabic(text);
		const catalog = findVoiceChangerProvider('groq');
		const voice = String(voiceId || '').trim() || (arabic ? 'Ahmad-PlayAI' : catalog?.voices?.[2]?.id || 'Fritz-PlayAI');
		const model = /arabic|ahmad|nasser/i.test(voice) || arabic ? 'playai-tts-arabic' : 'playai-tts';
		try {
			const response = await axios.post(
				'https://api.groq.com/openai/v1/audio/speech',
				{ model, voice, input: text.slice(0, 4000), response_format: 'mp3' },
				{
					headers: { Authorization: `Bearer ${apiKey}` },
					responseType: 'arraybuffer',
					timeout: 60_000,
				},
			);
			return {
				buffer: Buffer.from(response.data),
				mimeType: 'audio/mpeg',
				fileName: this.renamed(file.originalname, 'mp3'),
			};
		} catch (error: any) {
			throw this.providerError(error, 'Groq text-to-speech failed');
		}
	}

	private async transcribeGroq(file: VoiceChangerUpload, apiKey: string) {
		const form = new FormData();
		form.append('file', createReadStream(file.path), {
			filename: file.originalname || 'voice.webm',
			contentType: file.mimetype || 'audio/webm',
		});
		form.append('model', process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo');
		form.append('response_format', 'json');
		try {
			const response = await axios.post(
				'https://api.groq.com/openai/v1/audio/transcriptions',
				form,
				{
					headers: { ...form.getHeaders(), Authorization: `Bearer ${apiKey}` },
					timeout: 90_000,
					maxBodyLength: Infinity,
					maxContentLength: Infinity,
				},
			);
			const text = String(response.data?.text || '').trim();
			if (!text) throw new BadRequestException('Groq could not hear any speech in that recording');
			return text;
		} catch (error: any) {
			if (error instanceof BadRequestException) throw error;
			throw this.providerError(error, 'Groq transcription failed');
		}
	}

	private async transformOpenAi(file: VoiceChangerUpload, apiKey: string, voiceId?: string | null) {
		const text = await this.transcribeOpenAi(file, apiKey);
		const voice = String(voiceId || '').trim() || 'alloy';
		try {
			const response = await axios.post(
				'https://api.openai.com/v1/audio/speech',
				{ model: 'gpt-4o-mini-tts', voice, input: text.slice(0, 4000) },
				{
					headers: { Authorization: `Bearer ${apiKey}` },
					responseType: 'arraybuffer',
					timeout: 60_000,
				},
			);
			return {
				buffer: Buffer.from(response.data),
				mimeType: 'audio/mpeg',
				fileName: this.renamed(file.originalname, 'mp3'),
			};
		} catch (error: any) {
			throw this.providerError(error, 'OpenAI text-to-speech failed');
		}
	}

	private async transcribeOpenAi(file: VoiceChangerUpload, apiKey: string) {
		const form = new FormData();
		form.append('file', createReadStream(file.path), {
			filename: file.originalname || 'voice.webm',
			contentType: file.mimetype || 'audio/webm',
		});
		form.append('model', 'whisper-1');
		try {
			const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
				headers: { ...form.getHeaders(), Authorization: `Bearer ${apiKey}` },
				timeout: 90_000,
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
			});
			const text = String(response.data?.text || '').trim();
			if (!text) throw new BadRequestException('OpenAI could not hear any speech in that recording');
			return text;
		} catch (error: any) {
			if (error instanceof BadRequestException) throw error;
			throw this.providerError(error, 'OpenAI transcription failed');
		}
	}

	private async transformHuggingFace(file: VoiceChangerUpload, apiKey: string, voiceId?: string | null) {
		const text = await this.transcribeHuggingFace(file, apiKey);
		const model =
			String(voiceId || '').trim() ||
			(this.isArabic(text) ? 'facebook/mms-tts-ara' : 'facebook/mms-tts-eng');
		try {
			const response = await axios.post(
				`https://api-inference.huggingface.co/models/${model}`,
				{ inputs: text.slice(0, 1500) },
				{
					headers: { Authorization: `Bearer ${apiKey}` },
					responseType: 'arraybuffer',
					timeout: 120_000,
				},
			);
			return {
				buffer: Buffer.from(response.data),
				mimeType: String(response.headers['content-type'] || 'audio/wav'),
				fileName: this.renamed(file.originalname, 'wav'),
			};
		} catch (error: any) {
			throw this.providerError(error, 'Hugging Face TTS failed');
		}
	}

	private async transcribeHuggingFace(file: VoiceChangerUpload, apiKey: string) {
		const buffer = await fs.readFile(file.path);
		try {
			const response = await axios.post(
				'https://api-inference.huggingface.co/models/openai/whisper-large-v3',
				buffer,
				{
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': file.mimetype || 'audio/webm',
					},
					timeout: 120_000,
					maxBodyLength: Infinity,
					maxContentLength: Infinity,
				},
			);
			const text = String(response.data?.text || response.data?.[0]?.generated_text || '').trim();
			if (!text) throw new BadRequestException('Hugging Face could not hear any speech in that recording');
			return text;
		} catch (error: any) {
			if (error instanceof BadRequestException) throw error;
			throw this.providerError(error, 'Hugging Face transcription failed');
		}
	}

	private credentialProvider(provider: string) {
		return provider === 'clone' ? 'elevenlabs' : provider;
	}

	private buildCredentialStatus(
		provider: KeyProvider,
		credentials: WhatsAppVoiceChangerCredential[],
		studioSecrets: StudioSecretsPayload,
		groqTranscript: { lastFour: string } | null,
	): CredentialStatus {
		const stored = credentials.find((item) => item.provider === provider);
		if (stored?.encryptedApiKey) {
			return { configured: true, source: 'saved', lastFour: stored.keyLastFour || null };
		}
		const studioKey = this.studioApiKey(provider, studioSecrets);
		if (studioKey) {
			return { configured: true, source: 'studio', lastFour: this.keyLastFour(studioKey) };
		}
		if (provider === 'groq' && groqTranscript) {
			return { configured: true, source: 'transcription', lastFour: groqTranscript.lastFour };
		}
		const envKey = this.envApiKey(provider);
		if (envKey) {
			return { configured: true, source: 'environment', lastFour: this.keyLastFour(envKey) };
		}
		return { configured: false, source: null, lastFour: null };
	}

	private studioApiKey(provider: string, secrets: StudioSecretsPayload) {
		const reader = STUDIO_KEY_PATH[this.credentialProvider(provider) as KeyProvider];
		return reader?.(secrets)?.trim() || null;
	}

	private envApiKey(provider: string) {
		const envName = findVoiceChangerProvider(this.credentialProvider(provider))?.envFallback;
		return envName ? process.env[envName]?.trim() || null : null;
	}

	private keyLastFour(value: string) {
		if (value.length <= 4) return '****';
		return value.slice(-4);
	}

	private async resolveApiKey(userId: string, provider: string, override?: string | null) {
		if (override?.trim()) return override.trim();
		const keyProvider = this.credentialProvider(provider);
		const stored = await this.credentialRepo.findOne({ where: { userId, provider: keyProvider } });
		if (stored?.encryptedApiKey) return this.decryptCredential(stored.encryptedApiKey);
		const studioSecrets = await this.studioSecrets.getDbSecrets(userId).catch(() => ({} as StudioSecretsPayload));
		const studioKey = this.studioApiKey(keyProvider, studioSecrets);
		if (studioKey) return studioKey;
		if (keyProvider === 'groq') {
			const transcript = await this.transcription.tryReadStoredApiKey('groq');
			if (transcript?.key) return transcript.key;
		}
		return this.envApiKey(keyProvider);
	}

	private assertKeyProvider(provider: string) {
		if (!KEY_PROVIDERS.includes(provider as (typeof KEY_PROVIDERS)[number])) {
			throw new BadRequestException('This provider does not use an API key');
		}
	}

	private encryptionKey() {
		const configured = process.env.WHATSAPP_SESSION_ENCRYPTION_KEY?.trim();
		if (configured) {
			const key = Buffer.from(configured, 'base64');
			if (key.length === 32) return key;
		}
		const jwtSecret = process.env.JWT_SECRET;
		if (!jwtSecret) {
			throw new ServiceUnavailableException('Configure JWT_SECRET before saving voice changer keys');
		}
		return crypto.createHash('sha256').update(`so7bafit:whatsapp-voice-changer:${jwtSecret}`).digest();
	}

	private encryptCredential(value: string) {
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
		const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
		return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
	}

	private decryptCredential(value: string) {
		const payload = Buffer.from(value, 'base64');
		const iv = payload.subarray(0, 12);
		const tag = payload.subarray(12, 28);
		const ciphertext = payload.subarray(28);
		const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
	}

	private providerError(error: unknown, fallback: string) {
		if (fallback === ELEVENLABS_PAID_VOICE_MESSAGE) {
			return new BadGatewayException(ELEVENLABS_PAID_VOICE_MESSAGE);
		}
		if (fallback.startsWith('ElevenLabs') && this.isElevenLabsPaidVoiceError(error)) {
			return new BadGatewayException(ELEVENLABS_PAID_VOICE_MESSAGE);
		}
		const payload = this.decodeAxiosErrorBody(error);
		const detail =
			this.extractProviderMessage(payload) ||
			(error instanceof Error ? error.message : '') ||
			fallback;
		const text = String(detail).replace(/\s+/g, ' ').trim();
		if (!text || text === fallback) return new BadGatewayException(fallback);
		return new BadGatewayException(`${fallback}: ${text.slice(0, 280)}`);
	}

	private decodeAxiosErrorBody(error: unknown): unknown {
		const data = (error as any)?.response?.data;
		if (data == null) return null;
		const text = this.axiosDataToText(data);
		if (text) {
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		}
		if (typeof data === 'object') return data;
		return null;
	}

	private axiosDataToText(data: unknown): string {
		if (typeof data === 'string') return data;
		if (Buffer.isBuffer(data)) return data.toString('utf8');
		if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
		if (ArrayBuffer.isView(data)) {
			return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
		}
		return '';
	}

	private extractProviderMessage(payload: unknown): string {
		if (!payload) return '';
		if (typeof payload === 'string') return payload.slice(0, 280);
		if (typeof payload !== 'object') return '';
		const root = payload as Record<string, any>;
		const detail = root.detail;
		if (typeof detail === 'string') return detail;
		if (typeof detail?.message === 'string') return detail.message;
		if (typeof root.error?.message === 'string') return root.error.message;
		if (typeof root.message === 'string') return root.message;
		return '';
	}

	private isArabic(text: string) {
		return /[\u0600-\u06FF]/.test(text);
	}

	private renamed(original: string | undefined, extension: string) {
		const base = String(original || 'voice').replace(/\.[^.]+$/, '');
		return `${base}.${extension}`;
	}

	private async tempPath(extension: string) {
		return path.join(os.tmpdir(), `wa-voice-changer-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
	}
}
