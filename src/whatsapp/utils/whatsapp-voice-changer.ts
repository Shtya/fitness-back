export const VOICE_CHANGER_PROVIDER_IDS = [
	'off',
	'ffmpeg',
	'elevenlabs',
	'clone',
	'fishaudio',
	'minimax',
	'groq',
	'openai',
	'huggingface',
	'cartesia',
] as const;

export const VOICE_CLONE_ENGINES = ['elevenlabs', 'fishaudio', 'minimax'] as const;
export type VoiceCloneEngineId = (typeof VOICE_CLONE_ENGINES)[number];

export function isVoiceCloneEngineId(value: string): value is VoiceCloneEngineId {
	return (VOICE_CLONE_ENGINES as readonly string[]).includes(value);
}

export type VoiceChangerProviderId = (typeof VOICE_CHANGER_PROVIDER_IDS)[number];

export type VoiceChangerVoiceOption = {
	id: string;
	label: string;
	labelAr: string;
	category?: string;
};

export type VoiceChangerProviderCatalog = {
	id: VoiceChangerProviderId;
	needsKey: boolean;
	kind: 'free' | 'trial';
	label: string;
	labelAr: string;
	description: string;
	descriptionAr: string;
	keyUrl?: string;
	keyHint?: string;
	keyHintAr?: string;
	envFallback?: string;
	isClone?: boolean;
	voices?: VoiceChangerVoiceOption[];
};

export const FFMPEG_PRESETS = [
	{ id: 'deeper', label: 'Deeper', labelAr: 'أعمق', pitchSemitones: -6, extraFilters: [] as string[] },
	{ id: 'male', label: 'More masculine', labelAr: 'أكثر خشونة', pitchSemitones: -3, extraFilters: [] },
	{ id: 'female', label: 'More feminine', labelAr: 'أكثر نعومة', pitchSemitones: 4, extraFilters: [] },
	{ id: 'higher', label: 'Higher', labelAr: 'أحدّ', pitchSemitones: 6, extraFilters: [] },
	{ id: 'child', label: 'Younger', labelAr: 'أصغر سناً', pitchSemitones: 8, extraFilters: [] },
	{ id: 'giant', label: 'Giant', labelAr: 'عملاق', pitchSemitones: -9, extraFilters: [] },
	{
		id: 'robot',
		label: 'Robot',
		labelAr: 'روبوت',
		pitchSemitones: 0,
		extraFilters: ['vibrato=f=7.5:d=0.45', 'aphaser=in_gain=0.4:out_gain=0.7:delay=3:decay=0.4'],
	},
	{ id: 'custom', label: 'Custom pitch', labelAr: 'درجة مخصصة', pitchSemitones: -5, extraFilters: [] },
] as const;

export const VOICE_CHANGER_CATALOG: VoiceChangerProviderCatalog[] = [
	{
		id: 'ffmpeg',
		needsKey: false,
		kind: 'free',
		label: 'Free pitch changer',
		labelAr: 'تغيير الدرجة مجاناً',
		description:
			'Changes pitch locally with FFmpeg. Best free option for Arabic because it keeps your words and timing.',
		descriptionAr:
			'يغيّر درجة الصوت على السيرفر بـ FFmpeg. أفضل خيار مجاني للعربي لأنه يحافظ على كلماتك وإيقاعك.',
	},
	{
		id: 'elevenlabs',
		needsKey: true,
		kind: 'trial',
		label: 'ElevenLabs Voice Changer',
		labelAr: 'ElevenLabs تغيير الصوت',
		description:
			'Speech-to-speech. Free API plans can only use premade or cloned voices, not Voice Library voices.',
		descriptionAr:
			'يحافظ على الإحساس والإيقاع ويبدّل المتحدث. الخطة المجانية للـ API تسمح فقط بالأصوات الجاهزة أو المستنسخة، وليس أصوات المكتبة.',
		keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
		keyHint: 'Create a free account → Profile menu → API Keys → Create key. Free tier includes monthly credits.',
		keyHintAr: 'حساب مجاني → قائمة الحساب → API Keys → إنشاء مفتاح. الخطة المجانية فيها رصيد شهري.',
		envFallback: 'ELEVENLABS_API_KEY',
		voices: [
			{ id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George', labelAr: 'جورج' },
			{ id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah', labelAr: 'سارة' },
			{ id: 'nPczCjzI2devNBz1zQrb', label: 'Brian', labelAr: 'برايان' },
			{ id: 'Xb7hH8MSUJpSbSDYk0k2', label: 'Alice', labelAr: 'أليس' },
			{ id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel', labelAr: 'دانيال' },
			{ id: 'pFZP5JQG7iQjIQuC4Bku', label: 'Lily', labelAr: 'ليلي' },
			{ id: 'iP95p4xoKVk53GoZ742B', label: 'Chris', labelAr: 'كريس' },
		],
	},
	{
		id: 'fishaudio',
		needsKey: true,
		kind: 'free',
		isClone: true,
		label: 'Fish Audio',
		labelAr: 'Fish Audio',
		description:
			'Hosted voice clone from ~10–30 seconds of audio. Free developer TTS uses s2.1-pro-free. Playback transcribes the note then speaks it in the cloned voice, so a Groq key helps.',
		descriptionAr:
			'استنساخ مستضاف من حوالي 10–30 ثانية. مجاني للمطورين بـ s2.1-pro-free. التشغيل بيفرغ الرسالة وبعدين ينطقها بالصوت المستنسخ، فمفتاح Groq بيساعد.',
		keyUrl: 'https://fish.audio/developers/',
		keyHint:
			'fish.audio → Developers → API key. Use model s2.1-pro-free. Cloning is included. A Groq key (free) is used to transcribe the WhatsApp note before speaking it.',
		keyHintAr:
			'fish.audio → Developers → API key. استخدم s2.1-pro-free. الاستنساخ مضمّن. مفتاح Groq المجاني بيستخدم لتفريغ رسالة واتساب قبل نطقها.',
		envFallback: 'FISH_AUDIO_API_KEY',
		voices: [],
	},
	{
		id: 'minimax',
		needsKey: true,
		kind: 'free',
		isClone: true,
		label: 'MiniMax',
		labelAr: 'MiniMax',
		description:
			'Clone from about 10 seconds of audio. Uses speech-2.8-hd (Coding Plan compatible). Playback transcribes then speaks; save Groq for Arabic notes.',
		descriptionAr:
			'استنساخ من حوالي 10 ثواني. يستخدم speech-2.8-hd (متوافق مع Coding Plan). التشغيل بيفرغ ثم ينطق؛ احفظ Groq للعربي.',
		keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
		keyHint:
			'platform.minimax.io → API Keys. About 10 seconds of clean speech. A Groq key transcribes the WhatsApp note first.',
		keyHintAr:
			'platform.minimax.io → API Keys. حوالي 10 ثواني كلام واضح. مفتاح Groq بيفرغ رسالة واتساب أولاً.',
		envFallback: 'MINIMAX_API_KEY',
		voices: [],
	},
	{
		id: 'groq',
		needsKey: true,
		kind: 'trial',
		label: 'Groq (Whisper + Arabic TTS)',
		labelAr: 'Groq (تفريغ ثم صوت عربي)',
		description:
			'Free-tier Speech-to-text then Orpheus TTS. Fast. Arabic uses canopylabs/orpheus-arabic-saudi. This is not a clone of your voice.',
		descriptionAr:
			'تفريغ مجاني ثم نطق Orpheus. سريع. العربي يستخدم canopylabs/orpheus-arabic-saudi. هذا ليس استنساخاً لصوتك.',
		keyUrl: 'https://console.groq.com/keys',
		keyHint: 'Sign up at console.groq.com → API Keys → Create API Key. The free tier is enough to try.',
		keyHintAr: 'سجّل في console.groq.com → API Keys → إنشاء مفتاح. الخطة المجانية تكفي للتجربة.',
		envFallback: 'GROQ_API_KEY',
		voices: [
			{ id: 'abdullah', label: 'Abdullah (Arabic)', labelAr: 'عبدالله (عربي)', category: 'arabic' },
			{ id: 'aisha', label: 'Aisha (Arabic)', labelAr: 'عائشة (عربي)', category: 'arabic' },
			{ id: 'fahad', label: 'Fahad (Arabic)', labelAr: 'فهد (عربي)', category: 'arabic' },
			{ id: 'sultan', label: 'Sultan (Arabic)', labelAr: 'سلطان (عربي)', category: 'arabic' },
			{ id: 'lulwa', label: 'Lulwa (Arabic)', labelAr: 'لؤلؤة (عربي)', category: 'arabic' },
			{ id: 'noura', label: 'Noura (Arabic)', labelAr: 'نورة (عربي)', category: 'arabic' },
			{ id: 'troy', label: 'Troy (English)', labelAr: 'تروي (إنجليزي)' },
			{ id: 'hannah', label: 'Hannah (English)', labelAr: 'هانا (إنجليزي)' },
			{ id: 'austin', label: 'Austin (English)', labelAr: 'أوستن (إنجليزي)' },
			{ id: 'autumn', label: 'Autumn (English)', labelAr: 'أوتم (إنجليزي)' },
		],
	},
	{
		id: 'openai',
		needsKey: true,
		kind: 'trial',
		label: 'OpenAI (Whisper + TTS)',
		labelAr: 'OpenAI (تفريغ ثم نطق)',
		description: 'Transcribe then speak with alloy/nova/onyx. Paid after free trial credits. Not a vocal clone.',
		descriptionAr: 'تفريغ ثم نطق بأصوات alloy/nova/onyx. مدفوع بعد الرصيد التجريبي. ليس استنساخاً صوتياً.',
		keyUrl: 'https://platform.openai.com/api-keys',
		keyHint: 'platform.openai.com → API keys → Create new secret key. Needs a billing-ready OpenAI account.',
		keyHintAr: 'platform.openai.com → API keys → إنشاء مفتاح. يحتاج حساب OpenAI جاهز للدفع.',
		envFallback: 'OPENAI_API_KEY',
		voices: [
			{ id: 'alloy', label: 'Alloy', labelAr: 'Alloy' },
			{ id: 'nova', label: 'Nova', labelAr: 'Nova' },
			{ id: 'onyx', label: 'Onyx', labelAr: 'Onyx' },
			{ id: 'echo', label: 'Echo', labelAr: 'Echo' },
			{ id: 'shimmer', label: 'Shimmer', labelAr: 'Shimmer' },
		],
	},
	{
		id: 'huggingface',
		needsKey: true,
		kind: 'trial',
		label: 'Hugging Face (Whisper + MMS TTS)',
		labelAr: 'Hugging Face (تفريغ ثم نطق)',
		description: 'Free Inference token. Transcribe then facebook/mms TTS. Needs an Inference Providers token, not a read-only Hub token.',
		descriptionAr: 'توكن مجاني. تفريغ ثم نطق MMS. يحتاج توكن بصلاحية Inference Providers مش توكن قراءة فقط.',
		keyUrl: 'https://huggingface.co/settings/tokens',
		keyHint: 'huggingface.co → Settings → Access Tokens → Create a token with Inference Providers permission.',
		keyHintAr: 'huggingface.co → Settings → Access Tokens → أنشئ توكن بصلاحية Inference Providers.',
		envFallback: 'HUGGINGFACE_API_KEY',
		voices: [
			{ id: 'facebook/mms-tts-ara', label: 'Arabic TTS', labelAr: 'نطق عربي' },
			{ id: 'facebook/mms-tts-eng', label: 'English TTS', labelAr: 'نطق إنجليزي' },
		],
	},
	{
		id: 'cartesia',
		needsKey: true,
		kind: 'trial',
		label: 'Cartesia Voice Changer',
		labelAr: 'Cartesia تغيير الصوت',
		description:
			'Speech-to-speech with intonation preserved. Cartesia discontinued this API on 20 Aug 2026 — keep a key saved if your plan still works, otherwise use ElevenLabs or the free pitch changer.',
		descriptionAr:
			'يحافظ على التنغيم مع صوت جديد. Cartesia أوقفت واجهة Voice Changer في 20 أغسطس 2026. لو المفتاح لسه شغال استخدمه، وإلا ElevenLabs أو تغيير الدرجة المجاني.',
		keyUrl: 'https://play.cartesia.ai/keys',
		keyHint: 'play.cartesia.ai → sign up → API keys. Paste a cartesia voice ID if you cloned one.',
		keyHintAr: 'play.cartesia.ai → حساب → API keys. الصق voice ID لو عملت clone.',
		envFallback: 'CARTESIA_API_KEY',
		voices: [
			{ id: '694f9389-aac1-45b6-b726-9d9369183238', label: 'Default (premade)', labelAr: 'صوت جاهز' },
		],
	},
];

export function isVoiceChangerProviderId(value: string): value is VoiceChangerProviderId {
	return (VOICE_CHANGER_PROVIDER_IDS as readonly string[]).includes(value);
}

export function findVoiceChangerProvider(id: string) {
	return VOICE_CHANGER_CATALOG.find((item) => item.id === id) || null;
}

export function isArabicVoiceText(text: string) {
	return /[\u0600-\u06FF]/.test(String(text || ''));
}

const GROQ_ARABIC_VOICES = new Set(['abdullah', 'aisha', 'fahad', 'sultan', 'lulwa', 'noura']);
const GROQ_ENGLISH_VOICES = new Set(['troy', 'hannah', 'austin', 'autumn', 'diana', 'daniel']);
const GROQ_TTS_ARABIC_MODEL = 'canopylabs/orpheus-arabic-saudi';
const GROQ_TTS_ENGLISH_MODEL = 'canopylabs/orpheus-v1-english';
const GROQ_VOICE_ALIASES: Record<string, string> = {
	'Ahmad-PlayAI': 'abdullah',
	'Nasser-PlayAI': 'fahad',
	'Amira-PlayAI': 'aisha',
	'Khalid-PlayAI': 'sultan',
	'Fritz-PlayAI': 'troy',
	'Arista-PlayAI': 'hannah',
};

export function normalizeGroqVoice(voiceId: string | null | undefined) {
	const requested = String(voiceId || '').trim();
	if (!requested) return '';
	return GROQ_VOICE_ALIASES[requested] || requested.toLowerCase();
}

export function resolveGroqSpeech(voiceId: string | null | undefined, text: string) {
	const arabic = isArabicVoiceText(text);
	const requested = normalizeGroqVoice(voiceId);
	if (arabic) {
		return {
			model: GROQ_TTS_ARABIC_MODEL,
			voice: GROQ_ARABIC_VOICES.has(requested) ? requested : 'abdullah',
			responseFormat: 'wav' as const,
		};
	}
	return {
		model: GROQ_TTS_ENGLISH_MODEL,
		voice: GROQ_ENGLISH_VOICES.has(requested) ? requested : 'troy',
		responseFormat: 'wav' as const,
	};
}

export const HUGGINGFACE_INFERENCE_URL = 'https://router.huggingface.co/hf-inference/models';

export function atempoChain(rate: number): string[] {
	const filters: string[] = [];
	let remaining = rate;
	while (remaining > 2.0001) {
		filters.push('atempo=2.0');
		remaining /= 2;
	}
	while (remaining < 0.5) {
		filters.push('atempo=0.5');
		remaining *= 2;
	}
	filters.push(`atempo=${remaining.toFixed(5)}`);
	return filters;
}

export function resolveFfmpegPreset(presetId: string, pitchSemitones?: number | null) {
	const preset = FFMPEG_PRESETS.find((item) => item.id === presetId) || FFMPEG_PRESETS[0];
	const semitones =
		preset.id === 'custom' && Number.isFinite(Number(pitchSemitones))
			? Math.max(-12, Math.min(12, Math.round(Number(pitchSemitones))))
			: preset.pitchSemitones;
	return { ...preset, pitchSemitones: semitones };
}

export function ffmpegPitchFilter(semitones: number, extraFilters: string[] = []): string {
	const ratio = 2 ** (semitones / 12);
	return [
		`asetrate=48000*${ratio.toFixed(6)}`,
		'aresample=48000',
		...atempoChain(1 / ratio),
		...extraFilters,
	].join(',');
}

export const FISH_AUDIO_API = 'https://api.fish.audio';
export const FISH_AUDIO_TTS_MODEL = 's2.1-pro-free';
export const MINIMAX_API = 'https://api.minimax.io';
/** speech-2.6-hd returns 1008/2056 on Coding Plan keys; 2.8-hd is the current default. */
export const MINIMAX_TTS_MODEL = 'speech-2.8-hd';
export const MINIMAX_CLONE_PREVIEW_TEXT =
	'This is a short voice preview to verify the cloned voice sounds natural and clear.';

export function resolveMiniMaxSpeechModel() {
	const configured = String(process.env.MINIMAX_TTS_MODEL || '').trim();
	return configured || MINIMAX_TTS_MODEL;
}

export function resolveMiniMaxGroupId() {
	return String(process.env.MINIMAX_GROUP_ID || '').trim();
}

export function minimaxApiPath(path: string, groupId?: string | null) {
	const normalized = path.startsWith('/') ? path : `/${path}`;
	const base = `${MINIMAX_API}${normalized}`;
	const gid = String(groupId ?? resolveMiniMaxGroupId()).trim();
	if (!gid) return base;
	const separator = base.includes('?') ? '&' : '?';
	return `${base}${separator}GroupId=${encodeURIComponent(gid)}`;
}

export function minimaxVoiceIdFromName(name: string) {
	const slug = String(name || 'voice')
		.normalize('NFKD')
		.replace(/[^\w]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 32);
	const base = /^[A-Za-z]/.test(slug) ? slug : `V${slug || 'oice'}`;
	return `${base}_${Date.now().toString(36)}`.slice(0, 64);
}
