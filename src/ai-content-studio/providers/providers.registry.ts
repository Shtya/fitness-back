import { ProviderCostTier, ProviderModelMeta } from './ai-provider';

export type RegistryEntry = {
  id: string;
  name: string;
  type: 'text' | 'image' | 'text-image';
  apiKeyRequired: boolean;
  costTier: ProviderCostTier;
  helpUrl: string;
  getKeyUrl: string;
  helpSteps: string[];
  freeTierNote: string;
  requiredPermissions?: string[];
  models: ProviderModelMeta[];
  credentialFields: Array<{
    key: string;
    label: string;
    secret?: boolean;
    placeholder?: string;
  }>;
};

/** Static registry — runtime providers may refresh models dynamically. */
export const PROVIDER_REGISTRY: Record<string, RegistryEntry> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'text-image',
    apiKeyRequired: true,
    costTier: 'FREE_TIER',
    helpUrl: 'https://aistudio.google.com/apikey',
    getKeyUrl: 'https://aistudio.google.com/apikey',
    helpSteps: [
      'افتح Google AI Studio.',
      'سجّل الدخول بحساب Google.',
      'أنشئ API Key.',
      'احفظ المفتاح في إعدادات الـ Server-side secrets داخل هذه الصفحة (Replace).',
    ],
    freeTierNote:
      'أنشئ API Key من Google AI Studio. توجد حاليًا فئة مجانية لبعض نماذج Gemini مع حدود استخدام.',
    requiredPermissions: ['Generative Language API'],
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (best Arabic)', costTier: 'FREE_TIER', modality: 'text' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', costTier: 'PAID', modality: 'text' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', costTier: 'FREE_TIER', modality: 'text' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', costTier: 'FREE_TIER', modality: 'text' },
      { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image (Nano Banana)', costTier: 'FREE_TIER', modality: 'image' },
      { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image (Nano Banana 2)', costTier: 'LIMITED_FREE', modality: 'image' },
      { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image (Nano Banana Pro) — recommended', costTier: 'PAID', modality: 'image' },
    ],
    credentialFields: [{ key: 'apiKey', label: 'API Key', secret: true }],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    type: 'text',
    apiKeyRequired: true,
    costTier: 'FREE_TIER',
    helpUrl: 'https://console.groq.com/keys',
    getKeyUrl: 'https://console.groq.com/keys',
    helpSteps: [
      'أنشئ حسابًا في Groq Console.',
      'افتح قسم API Keys.',
      'أنشئ مفتاحًا جديدًا.',
      'احفظه في Server-side secrets فقط.',
    ],
    freeTierNote:
      'أنشئ حسابًا في Groq Console ثم أنشئ API Key من قسم API Keys. الخطة المجانية لها حدود استخدام.',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (best Groq writing)', costTier: 'FREE_TIER', modality: 'text' },
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', costTier: 'FREE_TIER', modality: 'text' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', costTier: 'FREE_TIER', modality: 'text' },
      { id: 'qwen/qwen3.6-27b', label: 'Qwen3.6 27B', costTier: 'FREE_TIER', modality: 'text' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', costTier: 'FREE_TIER', modality: 'text' },
    ],
    credentialFields: [{ key: 'apiKey', label: 'API Key', secret: true }],
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    type: 'text-image',
    apiKeyRequired: true,
    costTier: 'FREE_TIER',
    helpUrl: 'https://developers.cloudflare.com/workers-ai/get-started/rest-api/',
    getKeyUrl: 'https://dash.cloudflare.com/?to=/:account/workers/ai',
    helpSteps: [
      'افتح Cloudflare Dashboard.',
      'انسخ Account ID.',
      'أنشئ API Token بصلاحيات Workers AI.',
      'احفظ Account ID و Token في Server-side secrets.',
    ],
    freeTierNote:
      'يمكن استخدام Workers AI على خطة Free ضمن الحصة المجانية الحالية. الحصة والحدود قابلة للتغيير من Cloudflare.',
    models: [
      { id: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct', costTier: 'FREE_TIER', modality: 'text' },
      { id: '@cf/qwen/qwen2.5-coder-32b-instruct', label: 'Qwen2.5 Coder 32B', costTier: 'PAID', modality: 'text' },
      { id: '@cf/black-forest-labs/flux-1-schnell', label: 'FLUX.1 Schnell', costTier: 'FREE_TIER', modality: 'image' },
      { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', label: 'SDXL Base 1.0', costTier: 'FREE_TIER', modality: 'image' },
    ],
    credentialFields: [
      { key: 'accountId', label: 'Account ID', secret: false, placeholder: 'Cloudflare Account ID' },
      { key: 'apiToken', label: 'API Token', secret: true },
    ],
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    type: 'text-image',
    apiKeyRequired: true,
    costTier: 'LIMITED_FREE',
    helpUrl: 'https://huggingface.co/settings/tokens',
    getKeyUrl: 'https://huggingface.co/settings/tokens',
    helpSteps: [
      'Open Hugging Face Settings -> Access Tokens.',
      'Create a token with Inference Providers permission.',
      'Save the token from Studio API keys (per user) - not from the .env file.',
    ],
    freeTierNote:
      'Hugging Face offers limited free credits. FLUX runs via fal-ai, not the deprecated hf-inference route.',
    models: [
      { id: 'meta-llama/Meta-Llama-3-8B-Instruct', label: 'Llama 3 8B Instruct', costTier: 'LIMITED_FREE', modality: 'text' },
      { id: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen2.5 7B Instruct', costTier: 'LIMITED_FREE', modality: 'text' },
      { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 Schnell (via fal-ai)', costTier: 'LIMITED_FREE', modality: 'image' },
      { id: 'stabilityai/stable-diffusion-xl-base-1.0', label: 'SDXL Base', costTier: 'LIMITED_FREE', modality: 'image' },
    ],
    credentialFields: [
      { key: 'apiKey', label: 'HF Token', secret: true },
      { key: 'hfProvider', label: 'Inference Provider', secret: false, placeholder: 'fal-ai (recommended)' },
    ],
  },
  openai_compatible: {
    id: 'openai_compatible',
    name: 'OpenAI-compatible',
    type: 'text-image',
    apiKeyRequired: true,
    costTier: 'UNKNOWN',
    helpUrl: 'https://platform.openai.com/docs/api-reference',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    helpSteps: [
      'وفّر Base URL متوافق مع OpenAI (مثلاً /v1).',
      'ضع API Key إن كان مطلوبًا.',
      'حدّد اسم الـ Model.',
    ],
    freeTierNote: 'يعتمد على المزود الذي تستخدمه. لا تفترض وجود فئة مجانية.',
    models: [
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini', costTier: 'PAID', modality: 'text' },
      { id: 'gpt-image-1', label: 'gpt-image-1', costTier: 'PAID', modality: 'image' },
    ],
    credentialFields: [
      { key: 'apiKey', label: 'API Key', secret: true },
      { key: 'baseUrl', label: 'Base URL', secret: false, placeholder: 'https://api.openai.com/v1' },
    ],
  },
  comfyui: {
    id: 'comfyui',
    name: 'Local ComfyUI',
    type: 'image',
    apiKeyRequired: false,
    costTier: 'SELF_HOSTED',
    helpUrl: 'https://github.com/comfyanonymous/ComfyUI',
    getKeyUrl: 'https://github.com/comfyanonymous/ComfyUI',
    helpSteps: [
      'شغّل ComfyUI محليًا أو على GPU خاص.',
      'افتح الواجهة (افتراضيًا http://127.0.0.1:8188).',
      'صدّر Workflow JSON وضعه في الحقل.',
      'اختبر الاتصال ثم Generate Test Image.',
    ],
    freeTierNote: 'Self-hosted — لا توجد تكلفة API لكل صورة إذا كنت تشغّل GPU خاص بك.',
    models: [],
    credentialFields: [
      { key: 'baseUrl', label: 'ComfyUI URL', secret: false, placeholder: 'http://127.0.0.1:8188' },
      { key: 'checkpoint', label: 'Checkpoint / Model', secret: false },
    ],
  },
  custom: {
    id: 'custom',
    name: 'Custom Provider',
    type: 'text-image',
    apiKeyRequired: false,
    costTier: 'UNKNOWN',
    helpUrl: '',
    getKeyUrl: '',
    helpSteps: [
      'عرّف Name و Base URL.',
      'ضع Headers و Body Template مع {{prompt}} و {{model}}.',
      'حدّد Response JSON Path مثل choices[0].message.content.',
    ],
    freeTierNote: 'يعتمد بالكامل على الـ API المخصص الذي توفّره.',
    models: [],
    credentialFields: [
      { key: 'apiKey', label: 'API Key', secret: true },
      { key: 'baseUrl', label: 'Base URL', secret: false },
    ],
  },
  'llm7-free': {
    id: 'llm7-free',
    name: 'LLM7 Free (no key)',
    type: 'text',
    apiKeyRequired: false,
    costTier: 'FREE',
    helpUrl: 'https://api.llm7.io',
    getKeyUrl: '',
    helpSteps: [
      'لا يحتاج API Key — نفس مزوّد صفحة AI Free.',
      'يعمل مباشرة مع نماذج مفتوحة مثل gpt-oss:20b.',
      'إن فشل الاتصال يُفضّل التحويل تلقائيًا إلى Pollinations Free.',
    ],
    freeTierNote: 'مجاني بدون مفتاح — نفس مسار FitCoach / AI Free.',
    models: [
      { id: 'gpt-oss:20b', label: 'GPT-OSS 20B', costTier: 'FREE', modality: 'text' },
      { id: 'llama3.1-8b', label: 'Llama 3.1 8B', costTier: 'FREE', modality: 'text' },
    ],
    credentialFields: [],
  },
  'ai-free': {
    id: 'ai-free',
    name: 'AI Free Auto (no key)',
    type: 'text',
    apiKeyRequired: false,
    costTier: 'FREE',
    helpUrl: '',
    getKeyUrl: '',
    helpSteps: [
      'سلسلة تلقائية بدون مفتاح: LLM7 → Pollinations → Browser ChatGPT.',
      'يعيد المحاولة تلقائيًا عند فشل أي مزوّد.',
      'نفس منطق صفحة AI Free / FitCoach.',
    ],
    freeTierNote: 'مجاني بالكامل — الأفضل للتشغيل الأول بدون إعدادات.',
    models: [
      { id: 'auto', label: 'Auto (best available)', costTier: 'FREE', modality: 'text' },
      { id: 'gpt-oss:20b', label: 'Prefer GPT-OSS 20B', costTier: 'FREE', modality: 'text' },
    ],
    credentialFields: [],
  },
  'pollinations-free': {
    id: 'pollinations-free',
    name: 'Pollinations Free Text (no key)',
    type: 'text',
    apiKeyRequired: false,
    costTier: 'FREE',
    helpUrl: 'https://pollinations.ai',
    getKeyUrl: '',
    helpSteps: [
      'لا يحتاج API Key.',
      'مناسب كنسخة احتياطية قصيرة للنص.',
      'نفس مزوّد الاحتياط في صفحة AI Free.',
    ],
    freeTierNote: 'مجاني بدون مفتاح — نص قصير مجهول عبر Pollinations.',
    models: [{ id: 'pollinations', label: 'Pollinations Text', costTier: 'FREE', modality: 'text' }],
    credentialFields: [],
  },
  'browser-chatgpt': {
    id: 'browser-chatgpt',
    name: 'Browser ChatGPT (Free)',
    type: 'text',
    apiKeyRequired: false,
    costTier: 'FREE',
    helpUrl: '',
    getKeyUrl: '',
    helpSteps: [
      'لا يحتاج API Key — يفتح ChatGPT عبر متصفح headless.',
      'أبطأ من LLM7/Pollinations ويُستخدم كاحتياط أخير.',
      'قد يحتاج Chrome مثبتًا على السيرفر.',
    ],
    freeTierNote: 'مجاني بدون مفتاح — احتياط أخير مثل WhatsApp AI Free.',
    models: [{ id: 'chatgpt', label: 'ChatGPT (browser)', costTier: 'FREE', modality: 'text' }],
    credentialFields: [],
  },
  'pollinations-image': {
    id: 'pollinations-image',
    name: 'Pollinations Free Image (no key)',
    type: 'image',
    apiKeyRequired: false,
    costTier: 'FREE',
    helpUrl: 'https://pollinations.ai',
    getKeyUrl: '',
    helpSteps: [
      'لا يحتاج API Key.',
      'يُولّد الصورة عبر image.pollinations.ai.',
      'يعيد المحاولة مع نموذج turbo إذا فشل flux.',
    ],
    freeTierNote: 'مجاني بدون مفتاح — مناسب للتجربة الأولى بدون إعدادات.',
    models: [
      { id: 'flux', label: 'FLUX', costTier: 'FREE', modality: 'image' },
      { id: 'turbo', label: 'Turbo', costTier: 'FREE', modality: 'image' },
    ],
    credentialFields: [],
  },
};

export function listRegistry(filter?: 'text' | 'image' | 'text-image') {
  return Object.values(PROVIDER_REGISTRY).filter((p) => {
    if (!filter) return true;
    if (filter === 'text') return p.type === 'text' || p.type === 'text-image';
    if (filter === 'image') return p.type === 'image' || p.type === 'text-image';
    return true;
  });
}
