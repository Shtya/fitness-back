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
import { runFfmpeg, probeAudioSeconds } from '../utils/whatsapp-voice-ogg';
import {
	VOICE_CHANGER_CATALOG,
	FISH_AUDIO_API,
	FISH_AUDIO_TTS_MODEL,
	MINIMAX_API,
	MINIMAX_TTS_MODEL,
	ffmpegPitchFilter,
	findVoiceChangerProvider,
	HUGGINGFACE_INFERENCE_URL,
	isVoiceChangerProviderId,
	minimaxVoiceIdFromName,
	resolveFfmpegPreset,
	resolveGroqSpeech,
	normalizeGroqVoice,
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

const KEY_PROVIDERS = ['elevenlabs', 'fishaudio', 'minimax', 'groq', 'openai', 'huggingface', 'cartesia'] as const;
type KeyProvider = (typeof KEY_PROVIDERS)[number];
type CredentialSource = 'saved' | 'studio' | 'transcription' | 'environment';
type CredentialStatus = {
	configured: boolean;
	source: CredentialSource | null;
	lastFour: string | null;
};

const STUDIO_KEY_PATH: Record<KeyProvider, (secrets: StudioSecretsPayload) => string | undefined> = {
	elevenlabs: () => undefined,
	fishaudio: () => undefined,
	minimax: () => undefined,
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
const ELEVENLABS_CLONE_PERMISSION_MESSAGE =
	'This ElevenLabs API key cannot clone voices. Restricted key limits and Instant Voice Cloning are different: at elevenlabs.io → Settings → API Keys open THIS key, turn Restricted off, and enable Voices / Instant Voice Cloning. Starter (or higher) is required. You can also clone the voice on the ElevenLabs website, then pick it here.';
const ELEVENLABS_CLONE_SHORT_AUDIO_MESSAGE =
	'ElevenLabs Instant Voice Cloning needs about 60 seconds of clean speech in total. Upload more clips or record longer samples, then try again.';

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
		const storedProvider = row.provider || 'off';
		const provider = storedProvider === 'clone' ? 'off' : storedProvider;
		const credentials = await this.credentialRepo.find({ where: { userId } });
		const studioSecrets = await this.studioSecrets.getDbSecrets(userId).catch(() => ({} as StudioSecretsPayload));
		const groqTranscript = await this.readGroqTranscriptStatus();
		const credentialStatus: Record<string, CredentialStatus> = Object.fromEntries(
			KEY_PROVIDERS.map((providerId) => [
				providerId,
				this.buildCredentialStatus(providerId, credentials, studioSecrets, groqTranscript),
			]),
		);
		return {
			configured: Boolean(row.configured),
			enabled: Boolean(row.enabled) && provider !== 'off',
			provider,
			preset: row.preset || 'deeper',
			pitchSemitones: Number(row.pitchSemitones) || -6,
			voiceId: provider === 'groq' ? normalizeGroqVoice(row.voiceId) || null : row.voiceId || null,
			credentials: credentialStatus,
			catalog: liveCatalog ? await this.catalogForUser(userId) : this.cloneCatalog(),
		};
	}

	async saveSettings(userId: string, dto: TransformOptions & { configured?: boolean; enabled?: boolean }) {
		const provider =
			String(dto.provider || 'off').trim() === 'clone' ? 'off' : String(dto.provider || 'off').trim();
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
		if (findVoiceChangerProvider(provider)?.needsKey) {
			const apiKey = await this.resolveApiKey(userId, provider, dto.apiKey);
			if (!apiKey) {
				throw new BadRequestException(
					`Save an API key for ${provider} first. Opening the model is allowed; using it requires a saved key.`,
				);
			}
		}
		await this.settingsRepo.save(row);
		return this.getSettings(userId);
	}

	async saveCredential(userId: string, provider: string, apiKey: string) {
		const keyProvider = this.credentialProvider(provider);
		this.assertKeyProvider(keyProvider);
		const normalized = apiKey.trim();
		if (normalized.length < 8) throw new BadRequestException('API key is too short');
		await this.syncSharedApiKey(userId, keyProvider, normalized);
		if (keyProvider === 'elevenlabs' || keyProvider === 'cartesia' || !(await this.hasSharedApiKey(userId, keyProvider))) {
			let row = await this.credentialRepo.findOne({ where: { userId, provider: keyProvider } });
			if (!row) row = this.credentialRepo.create({ userId, provider: keyProvider });
			row.encryptedApiKey = this.encryptCredential(normalized);
			row.keyLastFour = normalized.slice(-4);
			await this.credentialRepo.save(row);
		} else {
			await this.credentialRepo.delete({ userId, provider: keyProvider });
		}
		return this.getSettings(userId);
	}

	async removeCredential(userId: string, provider: string) {
		const keyProvider = this.credentialProvider(provider);
		this.assertKeyProvider(keyProvider);
		await this.credentialRepo.delete({ userId, provider: keyProvider });
		return this.getSettings(userId);
	}

	async cloneVoice(
		userId: string,
		files: VoiceChangerUpload[],
		name: string,
		consent: boolean,
		cloneProvider = '',
	) {
		if (!consent) {
			throw new BadRequestException('Confirm you have permission to clone this voice');
		}
		const trimmed = String(name || '').trim();
		if (trimmed.length < 2) throw new BadRequestException('Give this clone a name');
		if (trimmed.length > 80) throw new BadRequestException('Clone name is too long');
		const samples = (files || []).filter((file) => file?.path);
		if (!samples.length) throw new BadRequestException('Upload at least one voice sample');
		if (samples.length > 10) throw new BadRequestException('Use up to 10 voice samples');
		const engine = this.cloneEngine(cloneProvider);
		const apiKey = await this.resolveApiKey(userId, engine);
		if (!apiKey) {
			throw new BadRequestException(
				engine === 'fishaudio'
					? 'Add a Fish Audio API key first, then clone a voice'
					: 'Add a MiniMax API key first, then clone a voice',
			);
		}
		const prepared: Array<{ path: string; originalname: string; mime: string; temp?: string; seconds: number }> = [];
		for (const file of samples) {
			prepared.push(await this.prepareCloneSample(file));
		}
		const totalSeconds = prepared.reduce((sum, sample) => sum + (sample.seconds || 0), 0);
		const minimumSeconds = engine === 'minimax' ? 10 : 8;
		if (totalSeconds > 0 && totalSeconds < minimumSeconds) {
			throw new BadRequestException(
				engine === 'minimax'
					? 'MiniMax cloning needs at least 10 seconds of clean speech. Upload a longer sample, then try again.'
					: 'Fish Audio cloning needs at least 8 seconds of clean speech. Upload a longer sample, then try again.',
			);
		}
		let voiceId = '';
		try {
			voiceId =
				engine === 'minimax'
					? await this.cloneMiniMax(apiKey, trimmed, prepared)
					: await this.cloneFishAudio(apiKey, trimmed, prepared);
		} finally {
			await Promise.all(
				prepared.map((sample) =>
					sample.temp ? fs.rm(sample.temp, { force: true }).catch(() => undefined) : Promise.resolve(),
				),
			);
		}
		if (!voiceId) throw new BadGatewayException('Voice clone did not return an id');
		await this.saveSettings(userId, {
			configured: true,
			enabled: true,
			provider: engine,
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
		if (provider === 'fishaudio') {
			return this.transformFishAudio(userId, file, apiKey, options.voiceId || settings.voiceId);
		}
		if (provider === 'minimax') {
			return this.transformMiniMax(userId, file, apiKey, options.voiceId || settings.voiceId);
		}
		if (provider === 'cartesia') {
			return this.transformCartesia(file, apiKey, options.voiceId || settings.voiceId);
		}
		if (provider === 'groq') {
			return this.transformGroq(file, apiKey, options.voiceId || settings.voiceId);
		}
		if (provider === 'openai') {
			return this.transformOpenAi(userId, file, apiKey, options.voiceId || settings.voiceId);
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

	private cloneEngine(value: string | undefined) {
		const raw = String(value || '').trim().toLowerCase();
		if (raw === 'fishaudio' || raw === 'minimax') return raw;
		throw new BadRequestException(
			'Clone a voice with Fish Audio or MiniMax. Instant Voice Cloning from ElevenLabs is not available in this panel.',
		);
	}

	private async cloneElevenLabs(
		apiKey: string,
		name: string,
		prepared: Array<{ path: string; originalname: string; mime: string }>,
	) {
		try {
			const form = new FormData();
			form.append('name', name);
			form.append(
				'description',
				'So7baFit WhatsApp reference clone. The account owner confirmed permission to use this voice.',
			);
			form.append('labels', JSON.stringify({ language: 'ar', source: 'so7bafit' }));
			for (const sample of prepared) {
				form.append('files', createReadStream(sample.path), {
					filename: sample.originalname,
					contentType: sample.mime,
				});
			}
			const response = await axios.post('https://api.elevenlabs.io/v1/voices/add', form, {
				headers: { ...form.getHeaders(), 'xi-api-key': apiKey },
				timeout: 120_000,
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
				validateStatus: (status) => status >= 200 && status < 300,
			});
			return String(response.data?.voice_id || '').trim();
		} catch (error) {
			if (this.isElevenLabsCloneShortAudioError(error)) {
				throw new BadRequestException(ELEVENLABS_CLONE_SHORT_AUDIO_MESSAGE);
			}
			if (this.isElevenLabsClonePermissionError(error)) {
				throw new BadRequestException(await this.explainElevenLabsClonePermission(apiKey, error));
			}
			throw this.providerError(error, 'Voice clone failed');
		}
	}

	private async cloneFishAudio(
		apiKey: string,
		name: string,
		prepared: Array<{ path: string; originalname: string; mime: string }>,
	) {
		const form = new FormData();
		form.append('type', 'tts');
		form.append('title', name);
		form.append('train_mode', 'fast');
		form.append('visibility', 'private');
		form.append('enhance_audio_quality', 'true');
		form.append(
			'description',
			'So7baFit WhatsApp reference clone. The account owner confirmed permission to use this voice.',
		);
		for (const sample of prepared) {
			form.append('voices', createReadStream(sample.path), {
				filename: sample.originalname,
				contentType: sample.mime,
			});
		}
		try {
			const response = await axios.post(`${FISH_AUDIO_API}/model`, form, {
				headers: { ...form.getHeaders(), Authorization: `Bearer ${apiKey}` },
				timeout: 120_000,
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
				validateStatus: (status) => status >= 200 && status < 300,
			});
			return String(response.data?._id || response.data?.id || '').trim();
		} catch (error) {
			throw this.providerError(error, 'Fish Audio voice clone failed');
		}
	}

	private async cloneMiniMax(
		apiKey: string,
		name: string,
		prepared: Array<{ path: string; originalname: string; mime: string; seconds: number }>,
	) {
		const samplePath = await this.pickOrConcatCloneSamples(prepared);
		const temps = samplePath !== prepared[0]?.path ? [samplePath] : [];
		try {
			const upload = new FormData();
			upload.append('purpose', 'voice_clone');
			upload.append('file', createReadStream(samplePath), {
				filename: 'clone.wav',
				contentType: 'audio/wav',
			});
			const uploaded = await axios.post(`${MINIMAX_API}/v1/files/upload`, upload, {
				headers: { ...upload.getHeaders(), Authorization: `Bearer ${apiKey}` },
				timeout: 90_000,
				maxBodyLength: Infinity,
				maxContentLength: Infinity,
			});
			this.assertMiniMaxOk(uploaded.data, 'MiniMax sample upload failed');
			const fileId = uploaded.data?.file?.file_id;
			if (fileId == null) throw new BadGatewayException('MiniMax did not return a file id');
			const voiceId = minimaxVoiceIdFromName(name);
			const cloned = await axios.post(
				`${MINIMAX_API}/v1/voice_clone`,
				{
					file_id: fileId,
					voice_id: voiceId,
					model: MINIMAX_TTS_MODEL,
					need_noise_reduction: true,
					need_volumn_normalization: true,
				},
				{
					headers: { Authorization: `Bearer ${apiKey}` },
					timeout: 120_000,
				},
			);
			this.assertMiniMaxOk(cloned.data, 'MiniMax voice clone failed');
			return String(cloned.data?.voice_id || voiceId).trim();
		} catch (error) {
			if (error instanceof BadRequestException || error instanceof BadGatewayException) throw error;
			throw this.providerError(error, 'MiniMax voice clone failed');
		} finally {
			await Promise.all(temps.map((item) => fs.rm(item, { force: true }).catch(() => undefined)));
		}
	}

	private async pickOrConcatCloneSamples(
		prepared: Array<{ path: string; seconds: number }>,
	) {
		if (prepared.length === 1) return prepared[0].path;
		const longest = [...prepared].sort((a, b) => (b.seconds || 0) - (a.seconds || 0))[0];
		if ((longest?.seconds || 0) >= 10) return longest.path;
		const outputPath = await this.tempPath('wav');
		const args = ['-y'];
		for (const sample of prepared) args.push('-i', sample.path);
		args.push(
			'-filter_complex',
			`concat=n=${prepared.length}:v=0:a=1`,
			'-ac',
			'1',
			'-ar',
			'44100',
			outputPath,
		);
		try {
			await runFfmpeg(args, 45_000);
			return outputPath;
		} catch {
			await fs.rm(outputPath, { force: true }).catch(() => undefined);
			return longest.path;
		}
	}

	private async transformFishAudio(
		userId: string,
		file: VoiceChangerUpload,
		apiKey: string,
		voiceId?: string | null,
	) {
		const reference = String(voiceId || '').trim();
		if (!reference) {
			throw new BadRequestException('Clone a Fish Audio voice first, then convert a note.');
		}
		const text = await this.transcribeSpeech(userId, file);
		try {
			const response = await axios.post(
				`${FISH_AUDIO_API}/v1/tts`,
				{
					text: text.slice(0, 4000),
					reference_id: reference,
					format: 'mp3',
					mp3_bitrate: 128,
					latency: 'normal',
					normalize: true,
				},
				{
					headers: {
						Authorization: `Bearer ${apiKey}`,
						model: FISH_AUDIO_TTS_MODEL,
						'Content-Type': 'application/json',
					},
					responseType: 'arraybuffer',
					timeout: 90_000,
					validateStatus: (status) => status >= 200 && status < 300,
				},
			);
			return {
				buffer: Buffer.from(response.data),
				mimeType: 'audio/mpeg',
				fileName: this.renamed(file.originalname, 'mp3'),
			};
		} catch (error) {
			throw this.providerError(error, 'Fish Audio speech failed');
		}
	}

	private async transformMiniMax(
		userId: string,
		file: VoiceChangerUpload,
		apiKey: string,
		voiceId?: string | null,
	) {
		const voice = String(voiceId || '').trim();
		if (!voice) {
			throw new BadRequestException('Clone a MiniMax voice first, then convert a note.');
		}
		const text = await this.transcribeSpeech(userId, file);
		try {
			const response = await axios.post(
				`${MINIMAX_API}/v1/t2a_v2`,
				{
					model: MINIMAX_TTS_MODEL,
					text: text.slice(0, 4000),
					stream: false,
					language_boost: 'auto',
					output_format: 'hex',
					voice_setting: { voice_id: voice, speed: 1, vol: 1, pitch: 0 },
					audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
				},
				{
					headers: { Authorization: `Bearer ${apiKey}` },
					timeout: 90_000,
				},
			);
			this.assertMiniMaxOk(response.data, 'MiniMax speech failed');
			const hex = String(response.data?.data?.audio || '').trim();
			if (!hex) throw new BadGatewayException('MiniMax did not return audio');
			return {
				buffer: Buffer.from(hex, 'hex'),
				mimeType: 'audio/mpeg',
				fileName: this.renamed(file.originalname, 'mp3'),
			};
		} catch (error) {
			if (error instanceof BadRequestException || error instanceof BadGatewayException) throw error;
			throw this.providerError(error, 'MiniMax speech failed');
		}
	}

	private async transcribeSpeech(userId: string, file: VoiceChangerUpload) {
		const attempts: Array<{ label: string; run: () => Promise<string> }> = [];
		const groq = await this.resolveApiKey(userId, 'groq');
		if (groq) attempts.push({ label: 'Groq', run: () => this.transcribeGroq(file, groq) });
		const openai = await this.resolveApiKey(userId, 'openai');
		if (openai) attempts.push({ label: 'OpenAI', run: () => this.transcribeOpenAi(file, openai) });
		const huggingface = await this.resolveApiKey(userId, 'huggingface');
		if (huggingface) {
			attempts.push({ label: 'Hugging Face', run: () => this.transcribeHuggingFace(file, huggingface) });
		}
		if (!attempts.length) {
			throw new BadRequestException(
				'Fish Audio and MiniMax clone the voice then respeak the words. Save a free Groq key first so the WhatsApp note can be transcribed.',
			);
		}
		let lastError: unknown;
		for (const [index, attempt] of attempts.entries()) {
			try {
				return await attempt.run();
			} catch (error) {
				lastError = error;
				const last = index === attempts.length - 1;
				if (last || !this.isRecoverableTranscriptionError(error)) {
					throw error instanceof BadRequestException || error instanceof BadGatewayException
						? error
						: this.providerError(error, `${attempt.label} transcription failed`);
				}
			}
		}
		throw this.providerError(lastError, 'Speech transcription failed');
	}

	private async listFishAudioVoices(apiKey: string) {
		const response = await axios.get(`${FISH_AUDIO_API}/model`, {
			params: { self: true, page_size: 50 },
			headers: { Authorization: `Bearer ${apiKey}` },
			timeout: 20_000,
			validateStatus: (status) => status >= 200 && status < 300,
		});
		const items = Array.isArray(response.data)
			? response.data
			: response.data?.items || response.data?.models || [];
		return (items as Array<{ _id?: string; id?: string; title?: string; name?: string; type?: string }>)
			.map((item) => {
				if (item.type && item.type !== 'tts') return null;
				const id = String(item._id || item.id || '').trim();
				const label = String(item.title || item.name || id).trim();
				if (!id) return null;
				return { id, label, labelAr: label, category: 'cloned' };
			})
			.filter(Boolean) as Array<{ id: string; label: string; labelAr: string; category: string }>;
	}

	private async listMiniMaxVoices(apiKey: string) {
		const response = await axios.post(
			`${MINIMAX_API}/v1/get_voice`,
			{ voice_type: 'voice_cloning' },
			{
				headers: { Authorization: `Bearer ${apiKey}` },
				timeout: 20_000,
			},
		);
		this.assertMiniMaxOk(response.data, 'MiniMax voice list failed');
		const items =
			response.data?.voice_cloning ||
			response.data?.cloned_voices ||
			response.data?.voices ||
			[];
		return (items as Array<{ voice_id?: string; voice_name?: string; name?: string }>)
			.map((item) => {
				const id = String(item.voice_id || '').trim();
				const label = String(item.voice_name || item.name || id).trim();
				if (!id) return null;
				return { id, label, labelAr: label, category: 'cloned' };
			})
			.filter(Boolean) as Array<{ id: string; label: string; labelAr: string; category: string }>;
	}

	private assertMiniMaxOk(payload: unknown, fallback: string) {
		const code = Number((payload as any)?.base_resp?.status_code);
		if (Number.isFinite(code) && code !== 0) {
			const message = String((payload as any)?.base_resp?.status_msg || fallback).trim();
			throw new BadGatewayException(`${fallback}: ${message.slice(0, 220)}`);
		}
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
		const fish = catalog.find((item) => item.id === 'fishaudio');
		const minimax = catalog.find((item) => item.id === 'minimax');
		const elevenKey = await this.resolveApiKey(userId, 'elevenlabs');
		if (elevenKey) {
			try {
				const voices = await this.listElevenLabsUsableVoices(elevenKey);
				const mapped = voices.slice(0, 48).map((voice) => ({
					id: voice.id,
					label: voice.category === 'cloned' ? `${voice.name} (clone)` : voice.name,
					labelAr: voice.category === 'cloned' ? `${voice.name} (استنساخ)` : voice.name,
					category: voice.category,
				}));
				if (elevenlabs && mapped.length) elevenlabs.voices = mapped;
			} catch {
				/* keep the static premade list when ElevenLabs is unreachable */
			}
		}
		const fishKey = await this.resolveApiKey(userId, 'fishaudio');
		if (fish && fishKey) {
			try {
				const voices = await this.listFishAudioVoices(fishKey);
				if (voices.length) fish.voices = voices;
			} catch {
				/* keep empty until a clone succeeds */
			}
		}
		const miniKey = await this.resolveApiKey(userId, 'minimax');
		if (minimax && miniKey) {
			try {
				const voices = await this.listMiniMaxVoices(miniKey);
				if (voices.length) minimax.voices = voices;
			} catch {
				/* keep empty until a clone succeeds */
			}
		}
		const settings = await this.settingsRepo.findOne({ where: { userId } });
		if (settings?.voiceId && settings.provider === 'fishaudio' && fish && !(fish.voices || []).some((voice) => voice.id === settings.voiceId)) {
			fish.voices = [{ id: settings.voiceId, label: 'Cloned voice', labelAr: 'صوت مستنسخ', category: 'cloned' }, ...(fish.voices || [])];
		}
		if (settings?.voiceId && settings.provider === 'minimax' && minimax && !(minimax.voices || []).some((voice) => voice.id === settings.voiceId)) {
			minimax.voices = [{ id: settings.voiceId, label: 'Cloned voice', labelAr: 'صوت مستنسخ', category: 'cloned' }, ...(minimax.voices || [])];
		}
		return catalog;
	}

	private async prepareCloneSample(file: VoiceChangerUpload) {
		const wavPath = await this.tempPath('wav');
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
					'44100',
					'-sample_fmt',
					's16',
					'-f',
					'wav',
					wavPath,
				],
				45_000,
			);
			return {
				path: wavPath,
				originalname: this.renamed(file.originalname, 'wav'),
				mime: 'audio/wav',
				temp: wavPath,
				seconds: await probeAudioSeconds(wavPath),
			};
		} catch {
			await fs.rm(wavPath, { force: true }).catch(() => undefined);
			return {
				path: file.path,
				originalname: file.originalname || 'sample.webm',
				mime: file.mimetype || 'audio/webm',
				seconds: await probeAudioSeconds(file.path),
			};
		}
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

	private isElevenLabsClonePermissionError(error: unknown) {
		const payload = this.decodeAxiosErrorBody(error);
		const snippet = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
		const haystack = [
			snippet,
			this.extractProviderMessage(payload),
			this.readErrorField(payload, 'code'),
			this.readErrorField(payload, 'status'),
			error instanceof Error ? error.message : '',
		].join(' ');
		return /create_instant_voice_clone|instant voice cloning must be enabled/i.test(haystack);
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
			const status = Number(error?.response?.status) || 0;
			const detail = String(this.extractProviderMessage(this.decodeAxiosErrorBody(error)) || '');
			if (status === 404 || status === 410 || /sunset|deprecated|discontinued/i.test(detail)) {
				throw new BadGatewayException(
					'Cartesia Voice Changer was discontinued on 20 Aug 2026. Use ElevenLabs or the free pitch changer.',
				);
			}
			throw this.providerError(error, 'Cartesia voice changer failed');
		}
	}

	private async transformGroq(file: VoiceChangerUpload, apiKey: string, voiceId?: string | null) {
		const text = await this.transcribeGroq(file, apiKey);
		const { model, voice, responseFormat } = resolveGroqSpeech(voiceId, text);
		try {
			const response = await axios.post(
				'https://api.groq.com/openai/v1/audio/speech',
				{ model, voice, input: text.slice(0, 4000), response_format: responseFormat },
				{
					headers: { Authorization: `Bearer ${apiKey}` },
					responseType: 'arraybuffer',
					timeout: 60_000,
				},
			);
			return {
				buffer: Buffer.from(response.data),
				mimeType: responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg',
				fileName: this.renamed(file.originalname, responseFormat),
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

	private async transformOpenAi(
		userId: string,
		file: VoiceChangerUpload,
		apiKey: string,
		voiceId?: string | null,
	) {
		try {
			const text = await this.transcribeOpenAi(file, apiKey);
			const voice = String(voiceId || '').trim() || 'alloy';
			const models = ['gpt-4o-mini-tts', 'tts-1'] as const;
			let lastError: unknown;
			for (const model of models) {
				try {
					const response = await axios.post(
						'https://api.openai.com/v1/audio/speech',
						{ model, voice, input: text.slice(0, 4000) },
						{
							headers: { Authorization: `Bearer ${apiKey}` },
							responseType: 'arraybuffer',
							timeout: 60_000,
							validateStatus: (status) => status >= 200 && status < 300,
						},
					);
					return {
						buffer: Buffer.from(response.data),
						mimeType: 'audio/mpeg',
						fileName: this.renamed(file.originalname, 'mp3'),
					};
				} catch (error: any) {
					lastError = error;
					if (!this.isRecoverableTranscriptionError(error)) break;
				}
			}
			throw this.providerError(lastError, 'OpenAI text-to-speech failed');
		} catch (error) {
			if (!this.isRecoverableTranscriptionError(error)) throw error;
			const groq = await this.resolveApiKey(userId, 'groq');
			if (groq) return this.transformGroq(file, groq, null);
			const huggingface = await this.resolveApiKey(userId, 'huggingface');
			if (huggingface) return this.transformHuggingFace(file, huggingface, null);
			throw new BadRequestException(
				'OpenAI quota is exhausted. Save a free Groq key, or use the free pitch changer.',
			);
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
				`${HUGGINGFACE_INFERENCE_URL}/${model}`,
				{ inputs: text.slice(0, 1500) },
				{
					headers: { Authorization: `Bearer ${apiKey}` },
					responseType: 'arraybuffer',
					timeout: 120_000,
				},
			);
			const mime = String(response.headers['content-type'] || '');
			if (mime.includes('application/json')) {
				throw this.providerError(
					{ response: { data: Buffer.from(response.data).toString('utf8') } },
					'Hugging Face TTS failed',
				);
			}
			return {
				buffer: Buffer.from(response.data),
				mimeType: mime || 'audio/wav',
				fileName: this.renamed(file.originalname, 'wav'),
			};
		} catch (error: any) {
			throw this.providerError(error, 'Hugging Face TTS failed');
		}
	}

	private async transcribeHuggingFace(file: VoiceChangerUpload, apiKey: string) {
		const prepared = await this.prepareCloneSample(file);
		try {
			const form = new FormData();
			form.append('file', createReadStream(prepared.path), {
				filename: prepared.originalname || 'voice.wav',
				contentType: prepared.mime || 'audio/wav',
			});
			form.append('model', 'openai/whisper-large-v3');
			try {
				const response = await axios.post('https://router.huggingface.co/v1/audio/transcriptions', form, {
					headers: { ...form.getHeaders(), Authorization: `Bearer ${apiKey}` },
					timeout: 120_000,
					maxBodyLength: Infinity,
					maxContentLength: Infinity,
				});
				const text = String(response.data?.text || '').trim();
				if (text) return text;
			} catch {
				/* fall through to the hf-inference ASR payload */
			}

			const wav = await fs.readFile(prepared.path);
			const response = await axios.post(
				`${HUGGINGFACE_INFERENCE_URL}/openai/whisper-large-v3`,
				{ inputs: wav.toString('base64') },
				{
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json',
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
		} finally {
			if (prepared.temp) await fs.rm(prepared.temp, { force: true }).catch(() => undefined);
		}
	}

	private isRecoverableTranscriptionError(error: unknown) {
		const message = `${error instanceof Error ? error.message : ''} ${this.extractProviderMessage(this.decodeAxiosErrorBody(error)) || ''}`;
		if (/could not hear any speech/i.test(message)) return false;
		const status = Number(
			(error as any)?.response?.status ||
				(typeof (error as any)?.getStatus === 'function' ? (error as any).getStatus() : 0) ||
				(error as any)?.status ||
				0,
		);
		if (status === 400 || status === 402 || status === 403 || status === 429 || status === 503) return true;
		return /quota|billing|insufficient_quota|exceeded your current quota|decommissioned|no longer supported|plan and billing|transcription failed|status code 400/i.test(
			message,
		);
	}

	private isElevenLabsCloneShortAudioError(error: unknown) {
		const payload = this.decodeAxiosErrorBody(error);
		const snippet = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
		return /too_short|too short|at least (1 minute|60 seconds)|minimum of 60|duration.*(?:low|short)|not enough audio/i.test(
			snippet,
		);
	}

	private async explainElevenLabsClonePermission(apiKey: string, error: unknown) {
		const payload = this.decodeAxiosErrorBody(error);
		const detail = this.extractProviderMessage(payload);
		try {
			const response = await axios.get('https://api.elevenlabs.io/v1/user/subscription', {
				headers: { 'xi-api-key': apiKey },
				timeout: 12_000,
				validateStatus: (status) => status >= 200 && status < 300,
			});
			const tier = String(response.data?.tier || response.data?.plan || '').trim();
			if (tier && /free|starter|trial/i.test(tier) === false) {
				return `${ELEVENLABS_CLONE_PERMISSION_MESSAGE} Current plan: ${tier}. ${detail}`.trim();
			}
			if (tier) {
				return `${ELEVENLABS_CLONE_PERMISSION_MESSAGE} Current plan: ${tier}. Instant Voice Cloning is not included on this plan.`;
			}
		} catch {
			/* keep the default clone permission copy */
		}
		return detail || ELEVENLABS_CLONE_PERMISSION_MESSAGE;
	}

	private async readGroqTranscriptStatus(): Promise<{ lastFour: string; source: CredentialSource } | null> {
		try {
			const status = await this.transcription.credentialStatus('groq');
			if (!status?.configured) return null;
			return {
				lastFour: status.lastFour || '****',
				source: status.source === 'database' ? 'transcription' : 'environment',
			};
		} catch {
			return null;
		}
	}

	private async syncSharedApiKey(userId: string, provider: string, apiKey: string) {
		if (provider === 'groq') {
			await this.transcription.saveCredential(userId, 'groq', apiKey);
			await this.studioSecrets.upsertSecrets(userId, { groq: { apiKey } }).catch(() => undefined);
			return;
		}
		if (provider === 'openai') {
			await this.studioSecrets.upsertSecrets(userId, { openai_compatible: { apiKey } });
			return;
		}
		if (provider === 'huggingface') {
			await this.studioSecrets.upsertSecrets(userId, { huggingface: { apiKey } });
		}
	}

	private async hasSharedApiKey(userId: string, provider: string) {
		if (provider === 'groq') {
			const stored = await this.transcription.tryReadStoredApiKey('groq');
			if (stored?.key) return true;
		}
		const studio = await this.studioSecrets.getDbSecrets(userId).catch(() => ({} as StudioSecretsPayload));
		return Boolean(this.studioApiKey(provider, studio));
	}

	private envApiKey(provider: string) {
		const id = this.credentialProvider(provider);
		const envName =
			findVoiceChangerProvider(id)?.envFallback || findVoiceChangerProvider(provider)?.envFallback;
		return envName ? String(process.env[envName] || '').trim() : '';
	}

	private credentialProvider(provider: string) {
		return provider === 'clone' ? 'elevenlabs' : provider;
	}

	private buildCredentialStatus(
		provider: KeyProvider,
		credentials: WhatsAppVoiceChangerCredential[],
		studioSecrets: StudioSecretsPayload,
		groqTranscript: { lastFour: string; source: CredentialSource } | null,
	): CredentialStatus {
		if (provider === 'groq' && groqTranscript) {
			return { configured: true, source: groqTranscript.source, lastFour: groqTranscript.lastFour };
		}
		const studioKey = this.studioApiKey(provider, studioSecrets);
		if (studioKey) {
			return { configured: true, source: 'studio', lastFour: this.keyLastFour(studioKey) };
		}
		const stored = credentials.find((item) => item.provider === provider);
		if (stored?.encryptedApiKey) {
			return { configured: true, source: 'saved', lastFour: stored.keyLastFour || null };
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

	private keyLastFour(value: string) {
		if (value.length <= 4) return '****';
		return value.slice(-4);
	}

	private async resolveApiKey(userId: string, provider: string, override?: string | null) {
		if (override?.trim()) return override.trim();
		const keyProvider = this.credentialProvider(provider);
		if (keyProvider === 'groq') {
			const transcript = await this.transcription.tryReadStoredApiKey('groq');
			if (transcript?.key) return transcript.key;
		}
		const studioSecrets = await this.studioSecrets.getDbSecrets(userId).catch(() => ({} as StudioSecretsPayload));
		const studioKey = this.studioApiKey(keyProvider, studioSecrets);
		if (studioKey) return studioKey;
		const stored = await this.credentialRepo.findOne({ where: { userId, provider: keyProvider } });
		if (stored?.encryptedApiKey) return this.decryptCredential(stored.encryptedApiKey);
		return this.envApiKey(keyProvider) || null;
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
		try {
			const payload = Buffer.from(value, 'base64');
			const iv = payload.subarray(0, 12);
			const tag = payload.subarray(12, 28);
			const ciphertext = payload.subarray(28);
			const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
			decipher.setAuthTag(tag);
			return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
		} catch {
			throw new BadRequestException(
				'This saved API key cannot be decrypted. Save the key again from voice changer settings.',
			);
		}
	}

	private providerError(error: unknown, fallback: string) {
		if (fallback === ELEVENLABS_CLONE_PERMISSION_MESSAGE || this.isElevenLabsClonePermissionError(error)) {
			return new BadRequestException(ELEVENLABS_CLONE_PERMISSION_MESSAGE);
		}
		if (this.isElevenLabsCloneShortAudioError(error)) {
			return new BadRequestException(ELEVENLABS_CLONE_SHORT_AUDIO_MESSAGE);
		}
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
		if (typeof root.base_resp?.status_msg === 'string') return root.base_resp.status_msg;
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
