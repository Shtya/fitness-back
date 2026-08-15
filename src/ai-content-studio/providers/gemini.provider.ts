import { Injectable } from '@nestjs/common';
import {
  AIProvider,
  ImageGenerateInput,
  ImageGenerateResult,
  ProviderModelMeta,
  TextGenerateInput,
  TextGenerateResult,
  ValidateKeyResult,
} from './ai-provider';
import { PROVIDER_REGISTRY } from './providers.registry';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_TOPIC_MODEL = 'gemini-2.5-flash';
export const GEMINI_CONTENT_MODEL = 'gemini-2.5-pro';
export const GEMINI_TEXT_MODEL = GEMINI_TOPIC_MODEL;
/** Nano Banana Pro — the image model this studio is built around. */
export const GEMINI_IMAGE_MODEL = 'gemini-3-pro-image';
export const GEMINI_IMAGE_FALLBACK = 'gemini-2.5-flash-image';

const TEXT_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
/** Never include flash-lite-image — Google free-tier quota for it is 0. */
const IMAGE_FALLBACKS = [GEMINI_IMAGE_FALLBACK];

const DEPRECATED_IMAGE_MODELS: Record<string, string> = {
  'gemini-2.0-flash-preview-image-generation': GEMINI_IMAGE_FALLBACK,
  'gemini-2.0-flash-exp-image-generation': GEMINI_IMAGE_FALLBACK,
  'gemini-2.5-flash-image-preview': GEMINI_IMAGE_FALLBACK,
  'gemini-2.0-flash-exp': GEMINI_IMAGE_FALLBACK,
  'gemini-3.1-flash-lite-image': GEMINI_IMAGE_FALLBACK,
  'gemini-3-pro-image-preview': GEMINI_IMAGE_MODEL,
  'gemini-3.1-flash-image-preview': 'gemini-3.1-flash-image',
};

const FRIENDLY_GEMINI_LABELS: Record<string, string> = {
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
  [GEMINI_IMAGE_FALLBACK]: 'Nano Banana',
  [GEMINI_IMAGE_MODEL]: 'Nano Banana Pro',
  'gemini-3.1-flash-image': 'Nano Banana 2',
};

function normalizeGeminiModelId(id: string) {
  return String(id || '')
    .replace(/^models\//, '')
    .replace(/-preview(-\d{2}-\d{2})?$/i, '')
    .replace(/-(exp|latest)$/i, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-\d{3}$/, '');
}

function geminiModelScore(id: string) {
  let score = 0;
  if (id === GEMINI_IMAGE_MODEL || id === GEMINI_IMAGE_FALLBACK || id === GEMINI_CONTENT_MODEL || id === GEMINI_TOPIC_MODEL) {
    score += 100;
  }
  if (!/-(preview|exp|latest|\d{3}|\d{4}-\d{2}-\d{2})/i.test(id)) score += 40;
  score -= id.length * 0.01;
  return score;
}

function geminiLabelKey(label: string) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(preview|experimental|latest|recommended)\b/g, '')
    .trim();
}

/** Google lists aliases (preview / dated) with the same marketing name. Keep one stable row. */
function dedupeGeminiModels(models: ProviderModelMeta[]): ProviderModelMeta[] {
  const byFamily = new Map<string, ProviderModelMeta>();
  for (const model of models) {
    const id = String(model.id || '').replace(/^models\//, '');
    if (!id || id === 'gemini-3.1-flash-lite-image') continue;
    const stableId = normalizeGeminiModelId(id) || id;
    const family = `${model.modality || 'text'}:${stableId}`;
    const next: ProviderModelMeta = {
      ...model,
      id: stableId,
      label: FRIENDLY_GEMINI_LABELS[stableId] || FRIENDLY_GEMINI_LABELS[id] || model.label || stableId,
    };
    const prev = byFamily.get(family);
    if (!prev || geminiModelScore(id) > geminiModelScore(prev.id)) {
      byFamily.set(family, next);
    }
  }

  const byLabel = new Map<string, ProviderModelMeta>();
  for (const model of byFamily.values()) {
    const key = `${model.modality || 'text'}:${geminiLabelKey(model.label)}`;
    const prev = byLabel.get(key);
    if (!prev || geminiModelScore(model.id) > geminiModelScore(prev.id)) {
      byLabel.set(key, model);
    }
  }
  return Array.from(byLabel.values());
}

export function resolveGeminiImageModel(model?: string) {
  const id = String(model || '').trim();
  if (!id) return GEMINI_IMAGE_MODEL;
  return DEPRECATED_IMAGE_MODELS[id] || id;
}

function geminiError(message: string, status: number, code: string, raw?: unknown) {
  return Object.assign(new Error(message), { status, code, provider: 'gemini', raw });
}

function isUnavailableModel(err: any) {
  const status = Number(err?.status || 0);
  const msg = String(err?.message || '').toLowerCase();
  return (
    status === 404 ||
    msg.includes('is not found') ||
    msg.includes('not supported for') ||
    msg.includes('not found for api version')
  );
}

function isQuotaError(err: any) {
  const status = Number(err?.status || 0);
  const msg = String(err?.message || err?.raw?.error?.message || '').toLowerCase();
  const code = String(err?.code || err?.raw?.error?.status || '').toUpperCase();
  return (
    status === 429 ||
    code === 'RESOURCE_EXHAUSTED' ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('resource_exhausted') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('limit: 0')
  );
}

function isTransientUnavailable(err: any) {
  const status = Number(err?.status || 0);
  const code = String(err?.code || err?.raw?.error?.status || '').toUpperCase();
  const msg = String(err?.message || err?.raw?.error?.message || '').toLowerCase();
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    code === 'UNAVAILABLE' ||
    msg.includes('high demand') ||
    msg.includes('try again later') ||
    msg.includes('unavailable')
  );
}

function uniqueModels(preferred: string, extras: string[]) {
  const out: string[] = [];
  for (const id of [preferred, ...extras]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHardZeroQuota(err: any) {
  return /limit:\s*0/.test(String(err?.message || err?.raw?.error?.message || ''));
}

function parseRetrySeconds(err: any): number {
  const msg = String(err?.message || err?.raw?.error?.message || '');
  const named = msg.match(/retry in\s+([\d.]+)\s*s/i);
  if (named) return Math.min(50, Math.ceil(Number(named[1]) + 1));
  const details = err?.raw?.error?.details;
  if (Array.isArray(details)) {
    for (const item of details) {
      const delay = item?.retryDelay || item?.retry_delay;
      if (typeof delay === 'string') {
        const m = delay.match(/([\d.]+)\s*s/i);
        if (m) return Math.min(50, Math.ceil(Number(m[1]) + 1));
      }
      if (typeof delay === 'number' && delay > 0) return Math.min(50, Math.ceil(delay) + 1);
    }
  }
  return 0;
}

function quotaImageMessage(preferred: string, retrySeconds: number) {
  const wait =
    retrySeconds > 0
      ? ` Wait ~${retrySeconds}s then retry Image.`
      : ' Wait about a minute then retry Image.';
  return (
    `Gemini image quota is exhausted for ${preferred} (free-tier may be 0).` +
    wait +
    ` Switch the Image node to Gemini 2.5 Flash Image (Nano Banana), or enable billing in Google AI Studio for Nano Banana Pro.`
  );
}

function extractInlineImage(raw: any): { data: string; mime: string } | null {
  const parts = raw?.candidates?.[0]?.content?.parts || [];
  const inlinePart = parts.find((p: any) => p?.inlineData?.data || p?.inline_data?.data);
  const blob = inlinePart?.inlineData || inlinePart?.inline_data;
  if (blob?.data) {
    return { data: blob.data, mime: blob.mimeType || blob.mime_type || 'image/png' };
  }

  const outImg = raw?.output_image || raw?.outputImage;
  if (outImg?.data) {
    return { data: outImg.data, mime: outImg.mime_type || outImg.mimeType || 'image/png' };
  }

  const outputs = raw?.outputs || raw?.output || [];
  for (const item of Array.isArray(outputs) ? outputs : [outputs]) {
    if (!item) continue;
    const nested = item.content || item.parts || [];
    const pool = [item, ...(Array.isArray(nested) ? nested : [nested])];
    for (const n of pool) {
      const data =
        n?.data ||
        n?.inline_data?.data ||
        n?.inlineData?.data ||
        n?.image?.data ||
        n?.output_image?.data;
      if (!data) continue;
      const mime =
        n?.mime_type ||
        n?.mimeType ||
        n?.inline_data?.mime_type ||
        n?.inlineData?.mimeType ||
        n?.image?.mime_type ||
        'image/png';
      return { data, mime };
    }
  }
  return null;
}

@Injectable()
export class GeminiProvider implements AIProvider {
  readonly id = 'gemini';
  readonly name = 'Google Gemini';
  readonly costTier = PROVIDER_REGISTRY.gemini.costTier;
  readonly capabilities = {
    supportsText: true,
    supportsImage: true,
    supportsImageToImage: false,
    supportsAspectRatio: true,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsResolution: false,
  };
  readonly apiKeyFields = ['apiKey'];

  async getModels(credentials?: Record<string, string>): Promise<ProviderModelMeta[]> {
    const apiKey = credentials?.apiKey;
    if (!apiKey) return PROVIDER_REGISTRY.gemini.models;
    try {
      const res = await fetch(`${GEMINI_API}/models?key=${encodeURIComponent(apiKey)}`);
      if (!res.ok) return PROVIDER_REGISTRY.gemini.models;
      const data = (await res.json()) as {
        models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
      };
      const mapped =
        data.models
          ?.filter((m) => {
            const id = (m.name || '').replace(/^models\//, '');
            const methods = m.supportedGenerationMethods || [];
            if (id === 'gemini-3.1-flash-lite-image') return false;
            if (/^imagen/i.test(id)) return false;
            if (/image/i.test(id)) return true;
            return methods.some((x) => ['generateContent', 'generateImages'].includes(x));
          })
          .map((m) => {
            const id = (m.name || '').replace(/^models\//, '');
            const isImage =
              (m.supportedGenerationMethods || []).includes('generateImages') || /image/i.test(id);
            const stableId = normalizeGeminiModelId(id) || id;
            return {
              id,
              label: FRIENDLY_GEMINI_LABELS[stableId] || m.displayName || id,
              costTier: 'FREE_TIER' as const,
              modality: (isImage ? 'image' : 'text') as 'text' | 'image',
            };
          }) || [];
      const unique = dedupeGeminiModels(mapped);
      return unique.length ? unique : PROVIDER_REGISTRY.gemini.models;
    } catch {
      return PROVIDER_REGISTRY.gemini.models;
    }
  }

  async validateKey(credentials: Record<string, string>): Promise<ValidateKeyResult> {
    if (!credentials.apiKey) {
      return { ok: false, message: 'Not configured: missing Gemini API Key' };
    }
    try {
      const models = await this.getModels(credentials);
      const probe = await fetch(
        `${GEMINI_API}/models?key=${encodeURIComponent(credentials.apiKey)}`,
      );
      if (!probe.ok) {
        const body = await probe.text();
        return { ok: false, message: `Gemini HTTP ${probe.status}: ${body.slice(0, 300)}` };
      }
      return { ok: true, message: 'Gemini key valid', models };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Gemini validation failed' };
    }
  }

  async generateText(input: TextGenerateInput): Promise<TextGenerateResult> {
    const apiKey = input.credentials.apiKey;
    if (!apiKey) throw geminiError('Gemini API Key not configured', 400, 'NOT_CONFIGURED');
    const models = uniqueModels(input.model || GEMINI_TEXT_MODEL, TEXT_FALLBACKS);
    let lastError: any;
    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      const isLast = i === models.length - 1;
      try {
        return await this.generateTextOnce(apiKey, model, input);
      } catch (err: any) {
        let failed = err;
        lastError = failed;
        if (input.useGoogleSearch && (Number(failed?.status) === 400 || Number(failed?.status) === 404)) {
          try {
            return await this.generateTextOnce(apiKey, model, { ...input, useGoogleSearch: false });
          } catch (e2: any) {
            failed = e2;
            lastError = e2;
          }
        }
        const canTryNext =
          isQuotaError(failed) ||
          isUnavailableModel(failed) ||
          isTransientUnavailable(failed) ||
          failed?.code === 'EMPTY_RESPONSE' ||
          Boolean(input.useGoogleSearch);
        if (!canTryNext) throw failed;

        // Preferred model quota/overload → skip wait, try Flash immediately.
        if (isLast && (isQuotaError(failed) || isTransientUnavailable(failed)) && !isHardZeroQuota(failed)) {
          const wait = parseRetrySeconds(failed) || (isTransientUnavailable(failed) ? 2 : 0);
          if (wait > 0) {
            await sleep(Math.min(wait, 25) * 1000);
            try {
              return await this.generateTextOnce(apiKey, model, input);
            } catch (retryErr: any) {
              lastError = retryErr;
            }
          }
        }
      }
    }
    const retrySeconds = parseRetrySeconds(lastError);
    if (isQuotaError(lastError)) {
      throw Object.assign(
        geminiError(
          lastError?.message || 'Gemini writing quota is exhausted.',
          429,
          'RESOURCE_EXHAUSTED',
          lastError?.raw,
        ),
        { retryAfterSeconds: retrySeconds, kind: 'TEXT_QUOTA' },
      );
    }
    throw lastError;
  }

  async generateImage(input: ImageGenerateInput): Promise<ImageGenerateResult> {
    const apiKey = input.credentials.apiKey;
    if (!apiKey) throw geminiError('Gemini API Key not configured', 400, 'NOT_CONFIGURED');
    const models = uniqueModels(resolveGeminiImageModel(input.model), IMAGE_FALLBACKS);
    let lastError: any;
    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      const isLast = i === models.length - 1;
      try {
        return await this.generateImageViaContent(apiKey, model, input);
      } catch (contentErr: any) {
        lastError = contentErr;
        const canTryNext =
          isQuotaError(contentErr) ||
          isUnavailableModel(contentErr) ||
          Number(contentErr?.status) === 400;
        if (!canTryNext) throw contentErr;

        // Pro quota → skip wait, try Nano Banana Flash immediately.
        // Last model + retryable quota (not hard 0) → wait once then retry that model.
        if (isLast && isQuotaError(contentErr) && !isHardZeroQuota(contentErr)) {
          const wait = parseRetrySeconds(contentErr);
          if (wait > 0) {
            await sleep(wait * 1000);
            try {
              return await this.generateImageViaContent(apiKey, model, input);
            } catch (retryErr: any) {
              lastError = retryErr;
            }
          }
        }
      }
    }
    const retrySeconds = parseRetrySeconds(lastError);
    const kind = retrySeconds > 0 ? 'IMAGE_QUOTA_WAIT' : 'IMAGE_QUOTA_UNAVAILABLE';
    throw Object.assign(
      geminiError(
        quotaImageMessage(resolveGeminiImageModel(input.model), retrySeconds),
        429,
        'RESOURCE_EXHAUSTED',
        lastError?.raw,
      ),
      { retryAfterSeconds: retrySeconds, kind },
    );
  }

  private async generateTextOnce(
    apiKey: string,
    model: string,
    input: TextGenerateInput,
  ): Promise<TextGenerateResult> {
    const url = `${GEMINI_API}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const parts: Array<{ text: string }> = [];
    if (input.system) parts.push({ text: input.system });
    parts.push({ text: input.prompt });
    const payload: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: input.temperature ?? 0.75,
        maxOutputTokens: input.maxTokens ?? 4096,
      },
    };
    if (input.useGoogleSearch) {
      payload.tools = [{ google_search: {} }];
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw geminiError(
        (raw as any)?.error?.message || `Gemini HTTP ${res.status}`,
        res.status,
        (raw as any)?.error?.status || 'GEMINI_ERROR',
        raw,
      );
    }
    const text =
      (raw as any)?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') ||
      '';
    const trimmed = text.trim();
    if (!trimmed) {
      throw geminiError('Gemini returned empty text', 502, 'EMPTY_RESPONSE', raw);
    }
    const usageMeta = (raw as any)?.usageMetadata;
    return {
      text: trimmed,
      model,
      usage: usageMeta
        ? {
            promptTokens: usageMeta.promptTokenCount,
            completionTokens: usageMeta.candidatesTokenCount,
            totalTokens: usageMeta.totalTokenCount,
          }
        : undefined,
      raw,
    };
  }

  private async generateImageViaContent(
    apiKey: string,
    model: string,
    input: ImageGenerateInput,
  ): Promise<ImageGenerateResult> {
    // Prefer IMAGE-only first (cleaner outputs); fall back to TEXT+IMAGE for older models.
    try {
      return await this.generateImageViaContentOnce(apiKey, model, input, ['IMAGE']);
    } catch (err: any) {
      // Quota is per-model — don't burn another request on the same model.
      if (isQuotaError(err)) throw err;
      if (!isUnavailableModel(err) && Number(err?.status) !== 400) throw err;
      return this.generateImageViaContentOnce(apiKey, model, input, ['TEXT', 'IMAGE']);
    }
  }

  private async generateImageViaContentOnce(
    apiKey: string,
    model: string,
    input: ImageGenerateInput,
    responseModalities: string[],
  ): Promise<ImageGenerateResult> {
    const url = `${GEMINI_API}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const generationConfig: Record<string, unknown> = { responseModalities };
    if (input.aspectRatio) {
      generationConfig.imageConfig = { aspectRatio: input.aspectRatio };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig,
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw geminiError(
        (raw as any)?.error?.message || `Gemini Image HTTP ${res.status}`,
        res.status,
        (raw as any)?.error?.status || 'GEMINI_IMAGE_ERROR',
        raw,
      );
    }
    return this.toImageResult(raw, model);
  }

  private async generateImageViaInteractions(
    apiKey: string,
    model: string,
    input: ImageGenerateInput,
  ): Promise<ImageGenerateResult> {
    const url = `${GEMINI_API}/interactions?key=${encodeURIComponent(apiKey)}`;
    const body: Record<string, unknown> = {
      model,
      input: [{ type: 'text', text: input.prompt }],
    };
    if (input.aspectRatio) {
      body.generation_config = { image_config: { aspect_ratio: input.aspectRatio } };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw geminiError(
        (raw as any)?.error?.message || `Gemini Interactions HTTP ${res.status}`,
        res.status,
        (raw as any)?.error?.status || 'GEMINI_IMAGE_ERROR',
        raw,
      );
    }
    return this.toImageResult(raw, model);
  }

  private toImageResult(raw: any, model: string): ImageGenerateResult {
    const image = extractInlineImage(raw);
    if (!image?.data) {
      throw geminiError('Gemini returned no image data', 502, 'NO_IMAGE', raw);
    }
    return {
      imageUrl: `data:${image.mime};base64,${image.data}`,
      mimeType: image.mime,
      model,
      raw,
    };
  }
}
