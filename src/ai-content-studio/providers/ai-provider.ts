export type ProviderCostTier =
  | 'FREE'
  | 'FREE_TIER'
  | 'LIMITED_FREE'
  | 'PAID'
  | 'SELF_HOSTED'
  | 'UNKNOWN';

export type ProviderCapabilityMap = {
  supportsText: boolean;
  supportsImage: boolean;
  supportsImageToImage: boolean;
  supportsAspectRatio: boolean;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  supportsResolution: boolean;
};

export type ProviderModelMeta = {
  id: string;
  label: string;
  costTier: ProviderCostTier;
  modality?: 'text' | 'image' | 'text-image';
};

export type TextGenerateInput = {
  prompt: string;
  model?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Gemini Google Search grounding — used for trending / research query planning. */
  useGoogleSearch?: boolean;
  credentials: Record<string, string>;
  custom?: {
    baseUrl?: string;
    method?: string;
    headers?: Record<string, string>;
    bodyTemplate?: string;
    responsePath?: string;
  };
};

export type TextGenerateResult = {
  text: string;
  model: string | null;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  raw?: unknown;
};

export type ImageGenerateInput = {
  prompt: string;
  model?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  seed?: number;
  credentials: Record<string, string>;
  custom?: {
    baseUrl?: string;
    method?: string;
    headers?: Record<string, string>;
    bodyTemplate?: string;
    responsePath?: string;
    workflowJson?: string;
  };
};

export type ImageGenerateResult = {
  /** data URL or remote URL */
  imageUrl: string;
  mimeType?: string;
  model: string | null;
  raw?: unknown;
};

export type ValidateKeyResult = {
  ok: boolean;
  message: string;
  models?: ProviderModelMeta[];
};

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  readonly costTier: ProviderCostTier;
  readonly capabilities: ProviderCapabilityMap;
  readonly apiKeyFields: string[];
  getModels(credentials?: Record<string, string>): Promise<ProviderModelMeta[]>;
  validateKey(credentials: Record<string, string>): Promise<ValidateKeyResult>;
  generateText?(input: TextGenerateInput): Promise<TextGenerateResult>;
  generateImage?(input: ImageGenerateInput): Promise<ImageGenerateResult>;
}

export const AI_CONTENT_PROVIDER_LIST = Symbol('AI_CONTENT_PROVIDER_LIST');

export function parseAspectRatio(
  aspectRatio?: string,
  fallback = { width: 1024, height: 1024 },
) {
  if (!aspectRatio || !aspectRatio.includes(':')) return fallback;
  const [a, b] = aspectRatio.split(':').map((n) => Number(n));
  if (!a || !b) return fallback;
  const base = 1024;
  if (a >= b) {
    return { width: base, height: Math.round((base * b) / a) };
  }
  return { width: Math.round((base * a) / b), height: base };
}

export function extractByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: any = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function applyTemplate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v == null ? '' : String(v);
  });
}
