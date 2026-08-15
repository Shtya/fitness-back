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

const DEFAULT_IMAGE_MODEL = 'black-forest-labs/FLUX.1-schnell';
/** hf-inference no longer serves FLUX — use Inference Providers (fal-ai, etc.). */
const IMAGE_PROVIDER_CHAIN = ['fal-ai', 'replicate', 'together', 'nebius'];

function uniqueIds(ids: Array<string | undefined>) {
  const out: string[] = [];
  for (const id of ids) {
    const v = String(id || '').trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

@Injectable()
export class HuggingFaceProvider implements AIProvider {
  readonly id = 'huggingface';
  readonly name = 'Hugging Face';
  readonly costTier = PROVIDER_REGISTRY.huggingface.costTier;
  readonly capabilities = {
    supportsText: true,
    supportsImage: true,
    supportsImageToImage: false,
    supportsAspectRatio: true,
    supportsNegativePrompt: true,
    supportsSeed: true,
    supportsResolution: true,
  };
  readonly apiKeyFields = ['apiKey'];

  async getModels(): Promise<ProviderModelMeta[]> {
    return PROVIDER_REGISTRY.huggingface.models;
  }

  async validateKey(credentials: Record<string, string>): Promise<ValidateKeyResult> {
    if (!credentials.apiKey) {
      return { ok: false, message: 'Not configured: missing Hugging Face token' };
    }
    try {
      const res = await fetch('https://huggingface.co/api/whoami-v2', {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, message: `Hugging Face HTTP ${res.status}: ${body.slice(0, 300)}` };
      }
      return { ok: true, message: 'Hugging Face token valid', models: await this.getModels() };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Hugging Face validation failed' };
    }
  }

  async generateText(input: TextGenerateInput): Promise<TextGenerateResult> {
    const apiKey = input.credentials.apiKey;
    if (!apiKey) {
      throw Object.assign(new Error('Hugging Face token not configured'), {
        status: 400,
        code: 'NOT_CONFIGURED',
      });
    }
    const model = input.model || 'meta-llama/Meta-Llama-3-8B-Instruct';
    const provider = input.credentials.hfProvider || 'auto';
    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider === 'hf-inference' || provider === 'auto' ? model : `${provider}/${model}`,
        messages: [
          ...(input.system ? [{ role: 'system', content: input.system }] : []),
          { role: 'user', content: input.prompt },
        ],
        max_tokens: input.maxTokens ?? 2048,
        temperature: input.temperature ?? 0.8,
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(
        new Error((raw as any)?.error || (raw as any)?.message || `HF HTTP ${res.status}`),
        { status: res.status, code: 'HF_ERROR', provider: 'huggingface', raw },
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
    const apiKey = input.credentials.apiKey;
    if (!apiKey) {
      throw Object.assign(new Error('Hugging Face token not configured'), {
        status: 400,
        code: 'NOT_CONFIGURED',
      });
    }
    const model = input.model || DEFAULT_IMAGE_MODEL;
    const preferred = String(input.credentials.hfProvider || '').trim();
    // Never force deprecated hf-inference for image models like FLUX.
    const chain = uniqueIds([
      preferred && preferred !== 'hf-inference' ? preferred : undefined,
      ...IMAGE_PROVIDER_CHAIN,
    ]);

    let lastError: any;
    for (const provider of chain) {
      try {
        return await this.generateImageViaProvider(apiKey, provider, model, input);
      } catch (e: any) {
        lastError = e;
        const status = Number(e?.status || 0);
        const msg = String(e?.message || '').toLowerCase();
        const retryable =
          status === 404 ||
          status === 410 ||
          status === 503 ||
          msg.includes('deprecated') ||
          msg.includes('no longer supported') ||
          msg.includes('not supported');
        if (!retryable) throw e;
      }
    }
    throw (
      lastError ||
      Object.assign(new Error('Hugging Face image providers failed'), {
        status: 502,
        code: 'HF_IMAGE_ERROR',
        provider: 'huggingface',
      })
    );
  }

  private async generateImageViaProvider(
    apiKey: string,
    provider: string,
    model: string,
    input: ImageGenerateInput,
  ): Promise<ImageGenerateResult> {
    const url = `https://router.huggingface.co/${provider}/${model}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'image/png, application/json',
      },
      body: JSON.stringify({
        inputs: input.prompt,
        prompt: input.prompt,
        parameters: {
          negative_prompt: input.negativePrompt,
          width: input.width || 1024,
          height: input.height || 1024,
          seed: input.seed,
        },
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      const errBody = contentType.includes('application/json')
        ? await res.json().catch(() => ({}))
        : await res.text();
      const message =
        typeof errBody === 'string'
          ? errBody.slice(0, 300)
          : (errBody as any)?.error || (errBody as any)?.message || `HF Image HTTP ${res.status}`;
      throw Object.assign(new Error(typeof message === 'string' ? message : JSON.stringify(message).slice(0, 300)), {
        status: res.status,
        code: 'HF_IMAGE_ERROR',
        provider: 'huggingface',
        raw: errBody,
      });
    }

    if (contentType.includes('application/json')) {
      const raw = await res.json();
      const fromUrl = await this.imageFromJson(raw);
      if (fromUrl) return { ...fromUrl, model, raw };
      throw Object.assign(new Error('Hugging Face returned no image'), {
        status: 502,
        code: 'NO_IMAGE',
        provider: 'huggingface',
        raw,
      });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const mime = contentType.includes('jpeg') ? 'image/jpeg' : contentType || 'image/png';
    return {
      imageUrl: `data:${mime};base64,${buf.toString('base64')}`,
      mimeType: mime,
      model,
    };
  }

  private async imageFromJson(raw: any): Promise<{ imageUrl: string; mimeType: string } | null> {
    const b64 =
      raw?.image ||
      raw?.[0]?.generated_image ||
      raw?.images?.[0]?.b64_json ||
      raw?.data?.[0]?.b64_json;
    if (b64 && typeof b64 === 'string' && !/^https?:\/\//i.test(b64)) {
      const cleaned = b64.replace(/^data:image\/\w+;base64,/, '');
      return { imageUrl: `data:image/png;base64,${cleaned}`, mimeType: 'image/png' };
    }

    const url =
      raw?.images?.[0]?.url ||
      raw?.image?.url ||
      raw?.data?.[0]?.url ||
      (typeof raw?.image === 'string' && /^https?:\/\//i.test(raw.image) ? raw.image : null);
    if (!url) return null;

    const imgRes = await fetch(url);
    if (!imgRes.ok) return null;
    const mime = imgRes.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await imgRes.arrayBuffer());
    return { imageUrl: `data:${mime};base64,${buf.toString('base64')}`, mimeType: mime };
  }
}
