import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserChatgptProvider } from '../../ai-free/providers/browser-chatgpt.provider';
import { Llm7FreeProvider } from '../../ai-free/providers/llm7-free.provider';
import { PollinationsFreeProvider } from '../../ai-free/providers/pollinations-free.provider';
import {
  AIProvider,
  ImageGenerateInput,
  ImageGenerateResult,
  TextGenerateInput,
  TextGenerateResult,
  ValidateKeyResult,
  parseAspectRatio,
} from './ai-provider';
import { PROVIDER_REGISTRY } from './providers.registry';

type FreeTextInner = {
  name: string;
  generate(request: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    model?: string;
  }): Promise<{ text: string; actualModel?: string | null }>;
};

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function sanitizeFreeModel(model?: string) {
  const m = String(model || '').trim();
  if (!m || m === 'auto') return undefined;
  // Paid/provider-specific IDs break LLM7 / Pollinations (e.g. gemini-2.5-flash).
  // Keep free-native IDs like gpt-oss:20b / llama3.1-8b.
  if (/^(gemini|claude|chatgpt|gpt-4|gpt-3\.5|o[0-9])/i.test(m) || /^openai\//i.test(m)) return undefined;
  return m;
}

async function generateTextWithInnerFallback(
  inners: FreeTextInner[],
  input: TextGenerateInput,
  logger: Logger,
): Promise<TextGenerateResult> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (input.system) messages.push({ role: 'system', content: input.system });
  messages.push({ role: 'user', content: input.prompt });
  const safeModel = sanitizeFreeModel(input.model);

  const errors: string[] = [];
  for (const inner of inners) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await inner.generate({ messages, model: safeModel });
        const text = String(result.text || '').trim();
        if (!text || text.length < 8) {
          throw new Error(`${inner.name} returned empty/short text`);
        }
        return {
          text,
          model: result.actualModel || safeModel || inner.name,
          raw: { provider: inner.name, attempt },
        };
      } catch (e: any) {
        const msg = e?.message || String(e);
        logger.warn(`${inner.name} attempt ${attempt} failed: ${msg}`);
        errors.push(`${inner.name}#${attempt}: ${msg}`);
        // Don't burn a second attempt on hard client errors.
        const hard = /unavailable|402|401|403|404|invalid_request|Payment Required/i.test(msg);
        if (attempt < 2 && !hard) await sleep(450 * attempt);
        else break;
      }
    }
  }
  throw Object.assign(new Error(errors[0] || 'All free AI providers failed'), {
    status: 503,
    code: 'ALL_FREE_PROVIDERS_FAILED',
    details: errors,
  });
}

/**
 * Studio adapters around FitCoach / AI-Free providers — no paid API keys required.
 */

@Injectable()
export class AiFreeChainStudioProvider implements AIProvider {
  readonly id = 'ai-free';
  readonly name = 'AI Free (auto)';
  readonly costTier = PROVIDER_REGISTRY['ai-free'].costTier;
  readonly capabilities = {
    supportsText: true,
    supportsImage: false,
    supportsImageToImage: false,
    supportsAspectRatio: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsResolution: false,
  };
  readonly apiKeyFields: string[] = [];
  private readonly logger = new Logger(AiFreeChainStudioProvider.name);

  constructor(
    private readonly llm7: Llm7FreeProvider,
    private readonly pollinations: PollinationsFreeProvider,
    private readonly browser: BrowserChatgptProvider,
  ) {}

  async getModels() {
    return PROVIDER_REGISTRY['ai-free'].models;
  }

  async validateKey(): Promise<ValidateKeyResult> {
    return {
      ok: true,
      message: 'No API key — auto chain: LLM7 → Pollinations → Browser ChatGPT',
      models: PROVIDER_REGISTRY['ai-free'].models,
    };
  }

  async generateText(input: TextGenerateInput): Promise<TextGenerateResult> {
    // Browser ChatGPT is intentionally excluded here — it can hang for minutes and
    // makes Generate Topic feel broken. Use dedicated browser-chatgpt provider only.
    return generateTextWithInnerFallback(
      [
        { name: 'llm7-free', generate: (r) => this.llm7.generate(r) },
        { name: 'pollinations-free', generate: (r) => this.pollinations.generate(r) },
      ],
      input,
      this.logger,
    );
  }
}

@Injectable()
export class Llm7FreeStudioProvider implements AIProvider {
  readonly id = 'llm7-free';
  readonly name = 'LLM7 Free';
  readonly costTier = PROVIDER_REGISTRY['llm7-free'].costTier;
  readonly capabilities = {
    supportsText: true,
    supportsImage: false,
    supportsImageToImage: false,
    supportsAspectRatio: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsResolution: false,
  };
  readonly apiKeyFields: string[] = [];

  constructor(private readonly llm7: Llm7FreeProvider) {}

  async getModels() {
    return PROVIDER_REGISTRY['llm7-free'].models;
  }

  async validateKey(): Promise<ValidateKeyResult> {
    return {
      ok: true,
      message: 'No API key required (same stack as AI Free / FitCoach)',
      models: PROVIDER_REGISTRY['llm7-free'].models,
    };
  }

  async generateText(input: TextGenerateInput): Promise<TextGenerateResult> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (input.system) messages.push({ role: 'system', content: input.system });
    messages.push({ role: 'user', content: input.prompt });
    const safeModel = sanitizeFreeModel(input.model);
    const result = await this.llm7.generate({
      messages,
      model: safeModel,
    });
    const text = String(result.text || '').trim();
    if (!text) {
      throw Object.assign(new Error('LLM7 returned empty text'), {
        status: 502,
        code: 'EMPTY_RESPONSE',
      });
    }
    return {
      text,
      model: result.actualModel || safeModel || 'llm7-free',
      raw: result,
    };
  }
}

@Injectable()
export class PollinationsFreeTextStudioProvider implements AIProvider {
  readonly id = 'pollinations-free';
  readonly name = 'Pollinations Free Text';
  readonly costTier = PROVIDER_REGISTRY['pollinations-free'].costTier;
  readonly capabilities = {
    supportsText: true,
    supportsImage: false,
    supportsImageToImage: false,
    supportsAspectRatio: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsResolution: false,
  };
  readonly apiKeyFields: string[] = [];

  constructor(private readonly pollinations: PollinationsFreeProvider) {}

  async getModels() {
    return PROVIDER_REGISTRY['pollinations-free'].models;
  }

  async validateKey(): Promise<ValidateKeyResult> {
    return {
      ok: true,
      message: 'No API key required',
      models: PROVIDER_REGISTRY['pollinations-free'].models,
    };
  }

  async generateText(input: TextGenerateInput): Promise<TextGenerateResult> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (input.system) messages.push({ role: 'system', content: input.system });
    messages.push({ role: 'user', content: input.prompt });
    const safeModel = sanitizeFreeModel(input.model);
    const result = await this.pollinations.generate({
      messages,
      model: safeModel,
    });
    const text = String(result.text || '').trim();
    if (!text) {
      throw Object.assign(new Error('Pollinations returned empty text'), {
        status: 502,
        code: 'EMPTY_RESPONSE',
      });
    }
    return {
      text,
      model: result.actualModel || safeModel || 'pollinations',
      raw: result,
    };
  }
}

@Injectable()
export class BrowserChatgptStudioProvider implements AIProvider {
  readonly id = 'browser-chatgpt';
  readonly name = 'Browser ChatGPT (Free)';
  readonly costTier = PROVIDER_REGISTRY['browser-chatgpt'].costTier;
  readonly capabilities = {
    supportsText: true,
    supportsImage: false,
    supportsImageToImage: false,
    supportsAspectRatio: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsResolution: false,
  };
  readonly apiKeyFields: string[] = [];

  constructor(private readonly browser: BrowserChatgptProvider) {}

  async getModels() {
    return PROVIDER_REGISTRY['browser-chatgpt'].models;
  }

  async validateKey(): Promise<ValidateKeyResult> {
    return {
      ok: true,
      message: 'No API key — uses headless browser ChatGPT (last-resort free fallback)',
      models: PROVIDER_REGISTRY['browser-chatgpt'].models,
    };
  }

  async generateText(input: TextGenerateInput): Promise<TextGenerateResult> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (input.system) messages.push({ role: 'system', content: input.system });
    messages.push({ role: 'user', content: input.prompt });
    const result = await this.browser.generate({ messages, model: input.model });
    const text = String(result.text || '').trim();
    if (!text) {
      throw Object.assign(new Error('Browser ChatGPT returned empty text'), {
        status: 502,
        code: 'EMPTY_RESPONSE',
      });
    }
    return {
      text,
      model: result.actualModel || 'browser-chatgpt',
      raw: result,
    };
  }
}

@Injectable()
export class PollinationsFreeImageStudioProvider implements AIProvider {
  readonly id = 'pollinations-image';
  readonly name = 'Pollinations Free Image';
  readonly costTier = PROVIDER_REGISTRY['pollinations-image'].costTier;
  readonly capabilities = {
    supportsText: false,
    supportsImage: true,
    supportsImageToImage: false,
    supportsAspectRatio: true,
    supportsNegativePrompt: false,
    supportsSeed: true,
    supportsResolution: true,
  };
  readonly apiKeyFields: string[] = [];
  private readonly logger = new Logger(PollinationsFreeImageStudioProvider.name);

  constructor(private readonly config: ConfigService) {}

  async getModels() {
    return PROVIDER_REGISTRY['pollinations-image'].models;
  }

  async validateKey(): Promise<ValidateKeyResult> {
    return {
      ok: true,
      message: 'No API key required for anonymous Pollinations image generation',
      models: PROVIDER_REGISTRY['pollinations-image'].models,
    };
  }

  private async fetchOnce(input: ImageGenerateInput, model: string): Promise<ImageGenerateResult> {
    const dims = parseAspectRatio(input.aspectRatio, {
      width: input.width || 1024,
      height: input.height || 1024,
    });
    const width = Math.min(Math.max(input.width || dims.width, 256), 1280);
    const height = Math.min(Math.max(input.height || dims.height, 256), 1280);
    const seed =
      typeof input.seed === 'number' && Number.isFinite(input.seed)
        ? Math.floor(input.seed)
        : Math.floor(Math.random() * 1_000_000);
    const prompt = String(input.prompt || '').slice(0, 1800);
    if (!prompt.trim()) {
      throw Object.assign(new Error('Image prompt is empty'), {
        status: 400,
        code: 'EMPTY_PROMPT',
      });
    }

    const base = (
      this.config.get<string>('AI_FREE_POLLINATIONS_IMAGE_BASE_URL') ||
      'https://image.pollinations.ai/prompt'
    ).replace(/\/$/, '');

    const qs = new URLSearchParams({
      width: String(width),
      height: String(height),
      model,
      nologo: 'true',
      enhance: 'true',
      seed: String(seed),
    });
    const url = `${base}/${encodeURIComponent(prompt)}?${qs.toString()}`;

    const timeoutMs = Math.min(
      Math.max(Number(this.config.get('AI_FREE_HTTP_TIMEOUT_MS')) || 120000, 10000),
      180000,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'image/*' },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw Object.assign(
          new Error(`Pollinations image failed (${res.status}): ${body.slice(0, 180)}`),
          { status: res.status, code: 'POLLINATIONS_IMAGE_ERROR' },
        );
      }
      const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) {
        throw Object.assign(new Error('Pollinations returned an empty image'), {
          status: 502,
          code: 'EMPTY_IMAGE',
        });
      }
      return {
        imageUrl: `data:${mimeType};base64,${buf.toString('base64')}`,
        mimeType,
        model,
        raw: { url, seed, width, height },
      };
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw Object.assign(new Error('Pollinations image timed out'), {
          status: 504,
          code: 'TIMEOUT',
        });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async generateImage(input: ImageGenerateInput): Promise<ImageGenerateResult> {
    const preferred = (input.model || 'flux').trim() || 'flux';
    const models = [preferred, preferred === 'turbo' ? 'flux' : 'turbo'].filter(
      (m, i, arr) => arr.indexOf(m) === i,
    );
    let lastError: any;
    for (const model of models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await this.fetchOnce(input, model);
        } catch (e: any) {
          lastError = e;
          this.logger.warn(`pollinations-image ${model}#${attempt}: ${e?.message || e}`);
          await sleep(400 * attempt);
        }
      }
    }
    throw lastError;
  }
}
