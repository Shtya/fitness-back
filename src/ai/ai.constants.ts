export const AI_PROVIDERS_TOKEN = Symbol('AI_PROVIDERS');

export const GEMINI_PROVIDER_ID = 'gemini';

export const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey';
export const GEMINI_BILLING_URL = 'https://aistudio.google.com/usage';
export const GEMINI_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing';

export const DEFAULT_TEXT_MODEL_ID = 'gemini-3.1-flash-lite';
export const DEFAULT_IMAGE_MODEL_ID = 'gemini-3.1-flash-lite-image';
export const PREMIUM_IMAGE_MODEL_ID = 'gemini-3.1-flash-image';
export const DEFAULT_AUDIO_MODEL_ID = 'whisper-large-v3-turbo';

export const DEFAULT_MONTHLY_COST_LIMIT = 20;
export const DEFAULT_MONTHLY_REQUEST_LIMIT = 1000;
export const DEFAULT_MONTHLY_IMAGE_LIMIT = 100;

export const WARNING_LEVELS = [80, 90, 100] as const;

export type AiModelType = 'text' | 'image' | 'audio';
export type AiUsageStatus = 'success' | 'error' | 'blocked';
export type AiCostTier = 'FREE' | 'FREE_TIER' | 'PAID' | 'PREMIUM';
export type AiModelTier = 'default' | 'premium' | 'custom';

export const AI_FEATURE_IDS = [
	'whatsapp.replies',
	'whatsapp.image',
	'whatsapp.voice-changer',
	'whatsapp.transcript',
	'transcription.stt',
	'transcription.enhance',
	'fitcoach.chat',
	'exercise.form',
	'email-memo',
	'studio.topic',
	'studio.content',
	'studio.image',
] as const;

export type AiFeatureId = (typeof AI_FEATURE_IDS)[number];

export const FEATURE_ALIASES: Record<string, AiFeatureId> = {
	whatsapp: 'whatsapp.replies',
	studio: 'studio.topic',
	'studio-image': 'studio.image',
	transcription: 'transcription.stt',
	exercise: 'exercise.form',
};

export type AiFeatureSpec = {
	id: AiFeatureId;
	name: string;
	type: AiModelType;
	defaultModelKey: string;
	page: string;
};

export const AI_PAGES = [
	{ id: 'whatsapp', href: '/dashboard/whatsapp' },
	{ id: 'transcript', href: '/dashboard/transcript' },
	{ id: 'fitcoach', href: '/dashboard/ai-free' },
	{ id: 'email-memo', href: '/dashboard/email-memo' },
	{ id: 'studio', href: '/dashboard/ai-content-studio' },
] as const;

export const AI_FEATURES: AiFeatureSpec[] = [
	{ id: 'whatsapp.replies', name: 'WhatsApp replies', type: 'text', defaultModelKey: 'auto', page: 'whatsapp' },
	{ id: 'whatsapp.image', name: 'WhatsApp images', type: 'image', defaultModelKey: 'flux', page: 'whatsapp' },
	{ id: 'whatsapp.voice-changer', name: 'WhatsApp voice changer', type: 'audio', defaultModelKey: DEFAULT_AUDIO_MODEL_ID, page: 'whatsapp' },
	{ id: 'whatsapp.transcript', name: 'WhatsApp voice transcript', type: 'audio', defaultModelKey: DEFAULT_AUDIO_MODEL_ID, page: 'whatsapp' },
	{ id: 'transcription.stt', name: 'Transcript speech-to-text', type: 'audio', defaultModelKey: DEFAULT_AUDIO_MODEL_ID, page: 'transcript' },
	{ id: 'transcription.enhance', name: 'Transcript cleanup', type: 'text', defaultModelKey: 'gpt-oss:20b', page: 'transcript' },
	{ id: 'fitcoach.chat', name: 'Fit Coach chat', type: 'text', defaultModelKey: 'auto', page: 'fitcoach' },
	{ id: 'exercise.form', name: 'Exercise AI fill', type: 'text', defaultModelKey: 'openai/gpt-3.5-turbo', page: 'fitcoach' },
	{ id: 'email-memo', name: 'Email memo', type: 'text', defaultModelKey: 'gpt-oss:20b', page: 'email-memo' },
	{ id: 'studio.topic', name: 'Studio topic', type: 'text', defaultModelKey: 'gemini-2.5-flash', page: 'studio' },
	{ id: 'studio.content', name: 'Studio content', type: 'text', defaultModelKey: 'gemini-2.5-flash', page: 'studio' },
	{ id: 'studio.image', name: 'Studio image', type: 'image', defaultModelKey: 'gemini-2.5-flash-image', page: 'studio' },
];

export type AiModelPricing = {
	inputPerMillion: number;
	outputPerMillion: number;
	imagePerUnit: number;
	currency: 'USD';
};

export type SeedAiModel = {
	modelKey: string;
	name: string;
	provider: string;
	type: AiModelType;
	pricing: AiModelPricing;
	enabled: boolean;
	isDefault: boolean;
	tier: AiModelTier;
	costTier: AiCostTier;
	usedBy: AiFeatureId[];
};

const FREE_PRICING: AiModelPricing = {
	inputPerMillion: 0,
	outputPerMillion: 0,
	imagePerUnit: 0,
	currency: 'USD',
};

function seed(model: SeedAiModel): SeedAiModel {
	return model;
}

export const SEEDED_MODELS: SeedAiModel[] = [
	seed({
		modelKey: 'gpt-oss:20b',
		name: 'GPT-OSS 20B',
		provider: 'llm7-free',
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE',
		usedBy: ['email-memo', 'studio.topic', 'whatsapp.replies'],
	}),
	seed({
		modelKey: 'llama3.1-8b',
		name: 'Llama 3.1 8B',
		provider: 'llm7-free',
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE',
		usedBy: ['studio.topic', 'whatsapp.replies'],
	}),
	seed({
		modelKey: 'pollinations',
		name: 'Pollinations Text',
		provider: 'pollinations-free',
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE',
		usedBy: ['email-memo', 'studio.topic', 'whatsapp.replies'],
	}),
	seed({
		modelKey: 'chatgpt',
		name: 'ChatGPT (browser)',
		provider: 'browser-chatgpt',
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE',
		usedBy: ['email-memo', 'studio.topic', 'whatsapp.replies'],
	}),
	seed({
		modelKey: 'auto',
		name: 'AI Free Auto',
		provider: 'ai-free',
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE',
		usedBy: ['whatsapp.replies', 'fitcoach.chat'],
	}),
	seed({
		modelKey: 'gemini-2.5-flash',
		name: 'Gemini 2.5 Flash',
		provider: GEMINI_PROVIDER_ID,
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE_TIER',
		usedBy: ['studio.topic', 'studio.content'],
	}),
	seed({
		modelKey: 'gemini-2.5-flash-lite',
		name: 'Gemini 2.5 Flash Lite',
		provider: GEMINI_PROVIDER_ID,
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE_TIER',
		usedBy: ['studio.topic', 'studio.content'],
	}),
	seed({
		modelKey: 'gemini-2.0-flash',
		name: 'Gemini 2.0 Flash',
		provider: GEMINI_PROVIDER_ID,
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE_TIER',
		usedBy: ['studio.topic', 'studio.content'],
	}),
	seed({
		modelKey: 'llama-3.3-70b-versatile',
		name: 'Llama 3.3 70B Versatile',
		provider: 'groq',
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE_TIER',
		usedBy: ['studio.topic', 'studio.content'],
	}),
	seed({
		modelKey: 'llama-3.1-8b-instant',
		name: 'Llama 3.1 8B Instant',
		provider: 'groq',
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE_TIER',
		usedBy: ['studio.topic', 'studio.content'],
	}),
	seed({
		modelKey: 'openai/gpt-oss-20b',
		name: 'GPT-OSS 20B (Groq)',
		provider: 'groq',
		type: 'text',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE_TIER',
		usedBy: ['studio.topic', 'studio.content'],
	}),
	seed({
		modelKey: 'flux',
		name: 'FLUX',
		provider: 'pollinations-image',
		type: 'image',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE',
		usedBy: ['studio.image', 'whatsapp.image'],
	}),
	seed({
		modelKey: 'turbo',
		name: 'Turbo',
		provider: 'pollinations-image',
		type: 'image',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE',
		usedBy: ['studio.image', 'whatsapp.image'],
	}),
	seed({
		modelKey: 'gemini-2.5-flash-image',
		name: 'Gemini 2.5 Flash Image',
		provider: GEMINI_PROVIDER_ID,
		type: 'image',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'FREE_TIER',
		usedBy: ['studio.image', 'whatsapp.image'],
	}),
	seed({
		modelKey: DEFAULT_AUDIO_MODEL_ID,
		name: 'Whisper Large V3 Turbo',
		provider: 'groq',
		type: 'audio',
		pricing: FREE_PRICING,
		enabled: true,
		isDefault: true,
		tier: 'default',
		costTier: 'FREE_TIER',
		usedBy: ['transcription.stt', 'whatsapp.transcript', 'whatsapp.voice-changer'],
	}),
	seed({
		modelKey: DEFAULT_TEXT_MODEL_ID,
		name: 'Gemini 3.1 Flash Lite',
		provider: GEMINI_PROVIDER_ID,
		type: 'text',
		pricing: {
			inputPerMillion: 0.25,
			outputPerMillion: 1.5,
			imagePerUnit: 0,
			currency: 'USD',
		},
		enabled: true,
		isDefault: true,
		tier: 'default',
		costTier: 'PAID',
		usedBy: [],
	}),
	seed({
		modelKey: DEFAULT_IMAGE_MODEL_ID,
		name: 'Gemini 3.1 Flash Lite Image',
		provider: GEMINI_PROVIDER_ID,
		type: 'image',
		pricing: {
			inputPerMillion: 0.25,
			outputPerMillion: 1.5,
			imagePerUnit: 0.0336,
			currency: 'USD',
		},
		enabled: true,
		isDefault: true,
		tier: 'default',
		costTier: 'PAID',
		usedBy: [],
	}),
	seed({
		modelKey: PREMIUM_IMAGE_MODEL_ID,
		name: 'Gemini 3.1 Flash Image',
		provider: GEMINI_PROVIDER_ID,
		type: 'image',
		pricing: {
			inputPerMillion: 0.5,
			outputPerMillion: 3,
			imagePerUnit: 0.067,
			currency: 'USD',
		},
		enabled: true,
		isDefault: false,
		tier: 'premium',
		costTier: 'PREMIUM',
		usedBy: ['studio.image', 'whatsapp.image'],
	}),
	seed({
		modelKey: 'openai/gpt-3.5-turbo',
		name: 'GPT-3.5 Turbo',
		provider: 'openrouter',
		type: 'text',
		pricing: {
			inputPerMillion: 0.5,
			outputPerMillion: 1.5,
			imagePerUnit: 0,
			currency: 'USD',
		},
		enabled: true,
		isDefault: false,
		tier: 'custom',
		costTier: 'PAID',
		usedBy: ['exercise.form'],
	}),
];

/** @deprecated Use SEEDED_MODELS. Kept so existing imports keep working. */
export const SEEDED_GEMINI_MODELS = SEEDED_MODELS;

const CATALOG_BY_KEY = new Map(SEEDED_MODELS.map((model) => [model.modelKey, model]));

export function catalogFor(modelKey: string): SeedAiModel | undefined {
	return CATALOG_BY_KEY.get(String(modelKey || '').trim());
}

export function featureSpec(feature: string): AiFeatureSpec | undefined {
	const id = (FEATURE_ALIASES[feature] || feature) as AiFeatureId;
	return AI_FEATURES.find((item) => item.id === id);
}

export type KnownProviderMeta = {
	id: string;
	name: string;
	supportsText: boolean;
	supportsImage: boolean;
	supportsAudio: boolean;
	keyUrl: string;
	billingUrl: string;
	pricingUrl: string;
	implemented: boolean;
	needsKey: boolean;
};

export const KNOWN_PROVIDER_META: KnownProviderMeta[] = [
	{
		id: GEMINI_PROVIDER_ID,
		name: 'Google Gemini',
		supportsText: true,
		supportsImage: true,
		supportsAudio: false,
		keyUrl: AI_STUDIO_KEY_URL,
		billingUrl: GEMINI_BILLING_URL,
		pricingUrl: GEMINI_PRICING_URL,
		implemented: true,
		needsKey: true,
	},
	{
		id: 'openai',
		name: 'OpenAI / ChatGPT',
		supportsText: true,
		supportsImage: true,
		supportsAudio: true,
		keyUrl: 'https://platform.openai.com/api-keys',
		billingUrl: 'https://platform.openai.com/settings/organization/billing',
		pricingUrl: 'https://openai.com/api/pricing',
		implemented: false,
		needsKey: true,
	},
	{
		id: 'anthropic',
		name: 'Anthropic',
		supportsText: true,
		supportsImage: false,
		supportsAudio: false,
		keyUrl: 'https://console.anthropic.com/settings/keys',
		billingUrl: 'https://console.anthropic.com/settings/billing',
		pricingUrl: 'https://www.anthropic.com/pricing',
		implemented: false,
		needsKey: true,
	},
	{
		id: 'llm7-free',
		name: 'LLM7 Free',
		supportsText: true,
		supportsImage: false,
		supportsAudio: false,
		keyUrl: 'https://api.llm7.io',
		billingUrl: '',
		pricingUrl: 'https://api.llm7.io',
		implemented: false,
		needsKey: false,
	},
	{
		id: 'pollinations-free',
		name: 'Pollinations Free Text',
		supportsText: true,
		supportsImage: false,
		supportsAudio: false,
		keyUrl: 'https://pollinations.ai',
		billingUrl: '',
		pricingUrl: 'https://pollinations.ai',
		implemented: false,
		needsKey: false,
	},
	{
		id: 'pollinations-image',
		name: 'Pollinations Free Image',
		supportsText: false,
		supportsImage: true,
		supportsAudio: false,
		keyUrl: 'https://pollinations.ai',
		billingUrl: '',
		pricingUrl: 'https://pollinations.ai',
		implemented: false,
		needsKey: false,
	},
	{
		id: 'ai-free',
		name: 'AI Free Auto',
		supportsText: true,
		supportsImage: false,
		supportsAudio: false,
		keyUrl: '',
		billingUrl: '',
		pricingUrl: '',
		implemented: false,
		needsKey: false,
	},
	{
		id: 'browser-chatgpt',
		name: 'Browser ChatGPT',
		supportsText: true,
		supportsImage: false,
		supportsAudio: false,
		keyUrl: '',
		billingUrl: '',
		pricingUrl: '',
		implemented: false,
		needsKey: false,
	},
	{
		id: 'groq',
		name: 'Groq',
		supportsText: true,
		supportsImage: false,
		supportsAudio: true,
		keyUrl: 'https://console.groq.com/keys',
		billingUrl: 'https://console.groq.com/settings/billing',
		pricingUrl: 'https://groq.com/pricing',
		implemented: false,
		needsKey: true,
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		supportsText: true,
		supportsImage: false,
		supportsAudio: false,
		keyUrl: 'https://openrouter.ai/keys',
		billingUrl: 'https://openrouter.ai/settings/credits',
		pricingUrl: 'https://openrouter.ai/models',
		implemented: false,
		needsKey: true,
	},
];

export function providerMeta(providerId: string): KnownProviderMeta | undefined {
	return KNOWN_PROVIDER_META.find((item) => item.id === providerId);
}

export function providerNeedsKey(providerId: string): boolean {
	const meta = providerMeta(providerId);
	return meta ? meta.needsKey : true;
}
