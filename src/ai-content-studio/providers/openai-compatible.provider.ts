import { Injectable } from '@nestjs/common';
import {
  AIProvider,
  ImageGenerateInput,
  ImageGenerateResult,
  ProviderModelMeta,
  TextGenerateInput,
  TextGenerateResult,
  ValidateKeyResult,
  applyTemplate,
  extractByPath,
  parseAspectRatio,
} from './ai-provider';
import { PROVIDER_REGISTRY } from './providers.registry';

@Injectable()
export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai_compatible';
  readonly name = 'OpenAI-compatible';
  readonly costTier = PROVIDER_REGISTRY.openai_compatible.costTier;
  readonly capabilities = {
    supportsText: true,
    supportsImage: true,
    supportsImageToImage: false,
    supportsAspectRatio: true,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsResolution: true,
  };
  readonly apiKeyFields = ['apiKey', 'baseUrl'];

  async getModels(): Promise<ProviderModelMeta[]> {
    return PROVIDER_REGISTRY.openai_compatible.models;
  }

  async validateKey(credentials: Record<string, string>): Promise<ValidateKeyResult> {
    const baseUrl = (credentials.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    if (!credentials.apiKey && !credentials.baseUrl) {
      return { ok: false, message: 'Not configured: missing Base URL / API Key' };
    }
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: credentials.apiKey
          ? { Authorization: `Bearer ${credentials.apiKey}` }
          : {},
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, message: `OpenAI-compatible HTTP ${res.status}: ${body.slice(0, 300)}` };
      }
      return { ok: true, message: 'OpenAI-compatible endpoint reachable', models: await this.getModels() };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Validation failed' };
    }
  }

  async generateText(input: TextGenerateInput): Promise<TextGenerateResult> {
    const baseUrl = (input.credentials.baseUrl || input.custom?.baseUrl || 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    );
    const model = input.model || 'gpt-4o-mini';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.credentials.apiKey
          ? { Authorization: `Bearer ${input.credentials.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(input.system ? [{ role: 'system', content: input.system }] : []),
          { role: 'user', content: input.prompt },
        ],
        temperature: input.temperature ?? 0.8,
        max_tokens: input.maxTokens ?? 2048,
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(
        new Error((raw as any)?.error?.message || `OpenAI-compatible HTTP ${res.status}`),
        { status: res.status, code: 'OPENAI_COMPAT_ERROR', provider: 'openai_compatible', raw },
      );
    }
    return {
      text: String((raw as any)?.choices?.[0]?.message?.content || '').trim(),
      model,
      usage: (raw as any)?.usage
        ? {
            promptTokens: (raw as any).usage.prompt_tokens,
            completionTokens: (raw as any).usage.completion_tokens,
            totalTokens: (raw as any).usage.total_tokens,
          }
        : undefined,
      raw,
    };
  }

  async generateImage(input: ImageGenerateInput): Promise<ImageGenerateResult> {
    const baseUrl = (input.credentials.baseUrl || input.custom?.baseUrl || 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    );
    const model = input.model || 'dall-e-3';
    const size = parseAspectRatio(input.aspectRatio, {
      width: input.width || 1024,
      height: input.height || 1024,
    });
    const res = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.credentials.apiKey
          ? { Authorization: `Bearer ${input.credentials.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model,
        prompt: input.prompt,
        size: `${size.width}x${size.height}`,
        response_format: 'b64_json',
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(
        new Error((raw as any)?.error?.message || `Image HTTP ${res.status}`),
        { status: res.status, code: 'OPENAI_IMAGE_ERROR', provider: 'openai_compatible', raw },
      );
    }
    const b64 = (raw as any)?.data?.[0]?.b64_json;
    const url = (raw as any)?.data?.[0]?.url;
    if (b64) {
      return { imageUrl: `data:image/png;base64,${b64}`, mimeType: 'image/png', model, raw };
    }
    if (url) return { imageUrl: url, model, raw };
    throw Object.assign(new Error('No image returned'), {
      status: 502,
      code: 'NO_IMAGE',
      provider: 'openai_compatible',
      raw,
    });
  }
}

@Injectable()
export class CustomHttpProvider implements AIProvider {
  readonly id = 'custom';
  readonly name = 'Custom Provider';
  readonly costTier = PROVIDER_REGISTRY.custom.costTier;
  readonly capabilities = {
    supportsText: true,
    supportsImage: true,
    supportsImageToImage: false,
    supportsAspectRatio: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsResolution: false,
  };
  readonly apiKeyFields = ['apiKey', 'baseUrl'];

  async getModels(): Promise<ProviderModelMeta[]> {
    return [];
  }

  async validateKey(credentials: Record<string, string>): Promise<ValidateKeyResult> {
    if (!credentials.baseUrl && !credentials.apiKey) {
      return { ok: false, message: 'Not configured: set Base URL (and API Key if required)' };
    }
    return { ok: true, message: 'Custom provider configured (runtime request will validate)' };
  }

  private async runCustom(
    input: TextGenerateInput | ImageGenerateInput,
    kind: 'text' | 'image',
  ): Promise<{ value: string; raw: unknown; model: string | null }> {
    const custom = input.custom || {};
    const baseUrl = custom.baseUrl || input.credentials.baseUrl;
    if (!baseUrl) {
      throw Object.assign(new Error('Custom Base URL not configured'), {
        status: 400,
        code: 'NOT_CONFIGURED',
      });
    }
    const method = (custom.method || 'POST').toUpperCase();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(custom.headers || {}),
    };
    if (input.credentials.apiKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${input.credentials.apiKey}`;
    }
    const vars = {
      prompt: input.prompt,
      model: input.model || '',
      negativePrompt: (input as ImageGenerateInput).negativePrompt || '',
    };
    const bodyStr = custom.bodyTemplate
      ? applyTemplate(custom.bodyTemplate, vars)
      : JSON.stringify({
          model: input.model,
          prompt: input.prompt,
          messages: [{ role: 'user', content: input.prompt }],
        });
    const res = await fetch(baseUrl, {
      method,
      headers,
      body: method === 'GET' ? undefined : bodyStr,
    });
    const contentType = res.headers.get('content-type') || '';
    if (kind === 'image' && contentType.includes('image/')) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok) {
        throw Object.assign(new Error(`Custom Image HTTP ${res.status}`), {
          status: res.status,
          code: 'CUSTOM_ERROR',
          provider: 'custom',
        });
      }
      return {
        value: `data:${contentType};base64,${buf.toString('base64')}`,
        raw: null,
        model: input.model || null,
      };
    }
    const raw = contentType.includes('application/json')
      ? await res.json().catch(() => ({}))
      : await res.text();
    if (!res.ok) {
      throw Object.assign(
        new Error(typeof raw === 'string' ? raw.slice(0, 300) : `Custom HTTP ${res.status}`),
        { status: res.status, code: 'CUSTOM_ERROR', provider: 'custom', raw },
      );
    }
    const path =
      custom.responsePath ||
      (kind === 'text'
        ? 'choices[0].message.content'
        : 'data[0].b64_json');
    const extracted = extractByPath(raw, path);
    if (extracted == null) {
      throw Object.assign(new Error(`Response path "${path}" not found`), {
        status: 502,
        code: 'PATH_NOT_FOUND',
        provider: 'custom',
        raw,
      });
    }
    let value = String(extracted);
    if (kind === 'image' && !value.startsWith('data:') && !value.startsWith('http')) {
      value = `data:image/png;base64,${value}`;
    }
    return { value, raw, model: input.model || null };
  }

  async generateText(input: TextGenerateInput): Promise<TextGenerateResult> {
    const out = await this.runCustom(input, 'text');
    return { text: out.value.trim(), model: out.model, raw: out.raw };
  }

  async generateImage(input: ImageGenerateInput): Promise<ImageGenerateResult> {
    const out = await this.runCustom(input, 'image');
    return { imageUrl: out.value, model: out.model, raw: out.raw };
  }
}
