export const VOICE_CHANGER_PROVIDER_IDS = [
	'off',
	'ffmpeg',
	'elevenlabs',
	'clone',
	'groq',
	'openai',
	'huggingface',
	'cartesia',
] as const;

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
		id: 'off',
		needsKey: false,
		kind: 'free',
		label: 'Keep my real voice',
		labelAr: 'صوتي الحقيقي',
		description: 'Send the recording as-is. No conversion.',
		descriptionAr: 'إرسال التسجيل كما هو بدون أي تحويل.',
	},
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
		id: 'clone',
		needsKey: true,
		kind: 'trial',
		label: 'Clone a reference voice',
		labelAr: 'استنساخ صوت مرجعي',
		description:
			'Upload several samples of a voice you have permission to use. ElevenLabs learns the tone, then your WhatsApp notes are converted into that voice.',
		descriptionAr:
			'ارفع عدة تسجيلات لصوت مصرّح لك به. ElevenLabs يحلل النبرة، وبعدها الرسائل الصوتية على واتساب بتتحول لصوت الشخص ده.',
		keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
		keyHint: 'Uses the same ElevenLabs API key. Instant Voice Cloning needs a plan that allows custom clones.',
		keyHintAr: 'يستخدم نفس مفتاح ElevenLabs. استنساخ الصوت الفوري يحتاج خطة تسمح بالـ custom clones.',
		envFallback: 'ELEVENLABS_API_KEY',
		voices: [],
	},
	{
		id: 'groq',
		needsKey: true,
		kind: 'trial',
		label: 'Groq (Whisper + Arabic TTS)',
		labelAr: 'Groq (تفريغ ثم صوت عربي)',
		description:
			'Free-tier Speech-to-text then a new TTS voice. Fast. Arabic uses playai-tts-arabic. This is not a clone of your voice.',
		descriptionAr:
			'تفريغ مجاني ثم نطق بصوت جديد. سريع. العربي يستخدم playai-tts-arabic. هذا ليس استنساخاً لصوتك.',
		keyUrl: 'https://console.groq.com/keys',
		keyHint: 'Sign up at console.groq.com → API Keys → Create API Key. The free tier is enough to try.',
		keyHintAr: 'سجّل في console.groq.com → API Keys → إنشاء مفتاح. الخطة المجانية تكفي للتجربة.',
		envFallback: 'GROQ_API_KEY',
		voices: [
			{ id: 'Ahmad-PlayAI', label: 'Ahmad (Arabic)', labelAr: 'أحمد (عربي)' },
			{ id: 'Nasser-PlayAI', label: 'Nasser (Arabic)', labelAr: 'ناصر (عربي)' },
			{ id: 'Fritz-PlayAI', label: 'Fritz (English)', labelAr: 'فريتز (إنجليزي)' },
			{ id: 'Arista-PlayAI', label: 'Arista (English)', labelAr: 'أريستا (إنجليزي)' },
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
		description: 'Free Inference token. Transcribe then facebook/mms TTS. Slower, useful to compare.',
		descriptionAr: 'توكن مجاني. تفريغ ثم نطق MMS. أبطأ، مفيد للمقارنة.',
		keyUrl: 'https://huggingface.co/settings/tokens',
		keyHint: 'huggingface.co → Settings → Access Tokens → Create new token with Inference permission.',
		keyHintAr: 'huggingface.co → Settings → Access Tokens → أنشئ توكن بصلاحية Inference.',
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
		description: 'Speech-to-speech with intonation preserved. Has a free trial. Their bytes API sunsets 20 Aug 2026.',
		descriptionAr: 'يحافظ على التنغيم مع صوت جديد. فيه تجربة مجانية. واجهة bytes تتوقف 20 أغسطس 2026.',
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
