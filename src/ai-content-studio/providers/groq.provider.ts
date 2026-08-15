import { Injectable } from '@nestjs/common';
import {
  AIProvider,
  ProviderModelMeta,
  TextGenerateInput,
  TextGenerateResult,
  ValidateKeyResult,
} from './ai-provider';
import { PROVIDER_REGISTRY } from './providers.registry';

@Injectable()
export class GroqProvider implements AIProvider {
  readonly id = 'groq';
  readonly name = 'Groq';
  readonly costTier = PROVIDER_REGISTRY.groq.costTier;
  readonly capabilities = {
    supportsText: true,
    supportsImage: false,
    supportsImageToImage: false,
    supportsAspectRatio: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsResolution: false,
  };
  readonly apiKeyFields = ['apiKey'];

  private base = 'https://api.groq.com/openai/v1';

  async getModels(credentials?: Record<string, string>): Promise<ProviderModelMeta[]> {
    const apiKey = credentials?.apiKey;
    if (!apiKey) return PROVIDER_REGISTRY.groq.models;
    try {
      const res = await fetch(`${this.base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return PROVIDER_REGISTRY.groq.models;
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const mapped =
        data.data?.map((m) => ({
          id: m.id,
          label: m.id,
          costTier: 'FREE_TIER' as const,
          modality: 'text' as const,
        })) || [];
      return mapped.length ? mapped : PROVIDER_REGISTRY.groq.models;
    } catch {
      return PROVIDER_REGISTRY.groq.models;
    }
  }

  async validateKey(credentials: Record<string, string>): Promise<ValidateKeyResult> {
    if (!credentials.apiKey) {
      return { ok: false, message: 'Not configured: missing Groq API Key' };
    }
    try {
      const res = await fetch(`${this.base}/models`, {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, message: `Groq HTTP ${res.status}: ${body.slice(0, 300)}` };
      }
      const models = await this.getModels(credentials);
      return { ok: true, message: 'Groq key valid', models };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Groq validation failed' };
    }
  }

  async generateText(input: TextGenerateInput): Promise<TextGenerateResult> {
    const apiKey = input.credentials.apiKey;
    if (!apiKey) throw Object.assign(new Error('Groq API Key not configured'), { status: 400, code: 'NOT_CONFIGURED' });
    const model = input.model || 'openai/gpt-oss-120b';
    const messages: Array<{ role: string; content: string }> = [];
    if (input.system) messages.push({ role: 'system', content: input.system });
    messages.push({ role: 'user', content: input.prompt });
    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: input.temperature ?? 0.75,
        max_tokens: input.maxTokens ?? 4096,
      }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(
        new Error((raw as any)?.error?.message || `Groq HTTP ${res.status}`),
        { status: res.status, code: (raw as any)?.error?.code || 'GROQ_ERROR', provider: 'groq', raw },
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
}
