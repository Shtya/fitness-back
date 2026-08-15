import { Injectable } from '@nestjs/common';
import {
  AIProvider,
  ImageGenerateInput,
  ImageGenerateResult,
  ProviderModelMeta,
  TextGenerateInput,
  TextGenerateResult,
  ValidateKeyResult,
  parseAspectRatio,
} from './ai-provider';
import { PROVIDER_REGISTRY } from './providers.registry';

@Injectable()
export class CloudflareProvider implements AIProvider {
  readonly id = 'cloudflare';
  readonly name = 'Cloudflare Workers AI';
  readonly costTier = PROVIDER_REGISTRY.cloudflare.costTier;
  readonly capabilities = {
    supportsText: true,
    supportsImage: true,
    supportsImageToImage: false,
    supportsAspectRatio: true,
    supportsNegativePrompt: true,
    supportsSeed: true,
    supportsResolution: true,
  };
  readonly apiKeyFields = ['accountId', 'apiToken'];

  async getModels(): Promise<ProviderModelMeta[]> {
    return PROVIDER_REGISTRY.cloudflare.models;
  }

  private endpoint(accountId: string, model: string) {
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  }

  async validateKey(credentials: Record<string, string>): Promise<ValidateKeyResult> {
    if (!credentials.accountId || !credentials.apiToken) {
      return { ok: false, message: 'Not configured: missing Cloudflare Account ID or API Token' };
    }
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/tokens/verify`,
        { headers: { Authorization: `Bearer ${credentials.apiToken}` } },
      );
      const raw = await res.json().catch(() => ({}));
      if (!res.ok || (raw as any)?.success === false) {
        return {
          ok: false,
          message: `Cloudflare HTTP ${res.status}: ${JSON.stringify((raw as any)?.errors || raw).slice(0, 300)}`,
        };
      }
      return { ok: true, message: 'Cloudflare credentials valid', models: await this.getModels() };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Cloudflare validation failed' };
    }
  }

  async generateText(input: TextGenerateInput): Promise<TextGenerateResult> {
    const { accountId, apiToken } = input.credentials;
    if (!accountId || !apiToken) {
      throw Object.assign(new Error('Cloudflare credentials not configured'), {
        status: 400,
        code: 'NOT_CONFIGURED',
      });
    }
    const model = input.model || '@cf/meta/llama-3.1-8b-instruct';
    const res = await fetch(this.endpoint(accountId, model), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          ...(input.system ? [{ role: 'system', content: input.system }] : []),
          { role: 'user', content: input.prompt },
        ],
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok || (raw as any)?.success === false) {
      throw Object.assign(
        new Error(
          (raw as any)?.errors?.[0]?.message ||
            (raw as any)?.error ||
            `Cloudflare HTTP ${res.status}`,
        ),
        { status: res.status, code: 'CLOUDFLARE_ERROR', provider: 'cloudflare', raw },
      );
    }
    const text =
      (raw as any)?.result?.response ||
      (raw as any)?.result?.output_text ||
      '';
    return { text: String(text).trim(), model, raw };
  }

  async generateImage(input: ImageGenerateInput): Promise<ImageGenerateResult> {
    const { accountId, apiToken } = input.credentials;
    if (!accountId || !apiToken) {
      throw Object.assign(new Error('Cloudflare credentials not configured'), {
        status: 400,
        code: 'NOT_CONFIGURED',
      });
    }
    const model = input.model || '@cf/black-forest-labs/flux-1-schnell';
    const size = parseAspectRatio(input.aspectRatio, {
      width: input.width || 1024,
      height: input.height || 1024,
    });
    const res = await fetch(this.endpoint(accountId, model), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: input.prompt,
        negative_prompt: input.negativePrompt,
        width: size.width,
        height: size.height,
        seed: input.seed,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('image/')) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok) {
        throw Object.assign(new Error(`Cloudflare Image HTTP ${res.status}`), {
          status: res.status,
          code: 'CLOUDFLARE_IMAGE_ERROR',
          provider: 'cloudflare',
        });
      }
      return {
        imageUrl: `data:${contentType};base64,${buf.toString('base64')}`,
        mimeType: contentType,
        model,
      };
    }

    const raw = await res.json().catch(() => ({}));
    if (!res.ok || (raw as any)?.success === false) {
      throw Object.assign(
        new Error(
          (raw as any)?.errors?.[0]?.message ||
            (raw as any)?.error ||
            `Cloudflare Image HTTP ${res.status}`,
        ),
        { status: res.status, code: 'CLOUDFLARE_IMAGE_ERROR', provider: 'cloudflare', raw },
      );
    }
    const b64 =
      (raw as any)?.result?.image ||
      (raw as any)?.result?.[0] ||
      (typeof (raw as any)?.result === 'string' ? (raw as any).result : null);
    if (!b64) {
      throw Object.assign(new Error('Cloudflare returned no image'), {
        status: 502,
        code: 'NO_IMAGE',
        provider: 'cloudflare',
        raw,
      });
    }
    return {
      imageUrl: `data:image/png;base64,${b64}`,
      mimeType: 'image/png',
      model,
      raw,
    };
  }
}
