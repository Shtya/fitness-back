import { Inject, Injectable } from '@nestjs/common';
import {
  AIProvider,
  AI_CONTENT_PROVIDER_LIST,
  ImageGenerateInput,
  TextGenerateInput,
  applyTemplate,
} from '../providers/ai-provider';
import { listRegistry, PROVIDER_REGISTRY } from '../providers/providers.registry';
import { StudioSecretsPayload } from './studio-crypto.service';
import { StudioSecretsService } from './studio-secrets.service';

export type ModuleProviderConfig = {
  provider: string;
  model?: string;
  fallbackProviders?: string[];
  custom?: TextGenerateInput['custom'] & { workflowJson?: string; name?: string };
};

/** Studio runs on Gemini. Other keyed providers stay optional; free no-key stacks are retired. */
const AUTO_TEXT_CHAIN = ['gemini'];

const HIDDEN_STUDIO_PROVIDERS = new Set([
  'ai-free',
  'llm7-free',
  'pollinations-free',
  'pollinations-image',
  'browser-chatgpt',
]);

const FREE_TEXT_PROVIDER_IDS = new Set([
  'ai-free',
  'llm7-free',
  'pollinations-free',
  'browser-chatgpt',
]);

const KEYED_TEXT_PROVIDER_IDS = new Set([
  'gemini',
  'groq',
  'huggingface',
  'cloudflare',
  'openai_compatible',
]);

function looksLikeForeignModel(providerId: string, model?: string) {
  const m = String(model || '').trim();
  if (!m || m === 'auto') return false;
  if (FREE_TEXT_PROVIDER_IDS.has(providerId)) {
    // Never send Gemini/Claude/OpenAI ChatGPT IDs into free providers.
    // Allow free-native IDs like gpt-oss:20b / llama3.1-8b.
    return /^(gemini|claude|chatgpt|gpt-4|gpt-3\.5|o[0-9])/i.test(m) || /^openai\//i.test(m);
  }
  if (providerId === 'gemini') return !/^gemini/i.test(m);
  if (providerId === 'groq') {
    return /^(gemini|claude)/i.test(m);
  }
  return false;
}

function modelForProvider(providerId: string, cfg: ModuleProviderConfig) {
  const model = cfg.model && cfg.model !== 'auto' ? String(cfg.model).trim() : '';
  if (!model) return undefined;
  // Only keep the configured model for the primary provider, and never for mismatched IDs.
  if (providerId !== cfg.provider && KEYED_TEXT_PROVIDER_IDS.has(cfg.provider || '')) {
    return undefined;
  }
  if (looksLikeForeignModel(providerId, model)) return undefined;
  return model;
}

function providerNeedsKey(provider: AIProvider) {
  return Array.isArray(provider.apiKeyFields) && provider.apiKeyFields.length > 0;
}

function hasRequiredCredentials(provider: AIProvider, credentials: Record<string, string>) {
  if (!providerNeedsKey(provider)) return true;
  return provider.apiKeyFields.some((field) => Boolean(String(credentials?.[field] || '').trim()));
}
const AUTO_IMAGE_CHAIN = ['gemini'];

/** Providers where silent downgrade to Pollinations would produce "AI junk" quality. */
const QUALITY_IMAGE_PROVIDERS = new Set([
  'gemini',
  'huggingface',
  'cloudflare',
  'comfyui',
  'openai_compatible',
]);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function expandAutoChain(primary: string | undefined, auto: string[]): string[] {
  const out: string[] = [];
  const push = (id: string) => {
    if (id && !out.includes(id)) out.push(id);
  };
  push(primary || auto[0]);
  auto.forEach(push);
  return out;
}

/** Image chain: keyed providers stay on the user's pick — no silent jump to HF/CF. */
function expandImageChain(primary?: string): string[] {
  const primaryId = primary || 'gemini';
  if (QUALITY_IMAGE_PROVIDERS.has(primaryId)) {
    return [primaryId];
  }
  return expandAutoChain(primaryId, AUTO_IMAGE_CHAIN);
}

function imageModelForProvider(providerId: string, cfg: ModuleProviderConfig) {
  if (providerId === 'gemini') {
    const raw =
      providerId === cfg.provider && cfg.model && cfg.model !== 'auto' ? String(cfg.model).trim() : '';
    if (!raw) return 'gemini-3-pro-image';
    if (raw === 'gemini-2.5-flash-image-preview') return 'gemini-2.5-flash-image';
    return raw;
  }
  if (providerId === cfg.provider) {
    return cfg.model && cfg.model !== 'auto' ? cfg.model : undefined;
  }
  if (providerId === 'pollinations-image') return 'flux';
  if (providerId === 'huggingface') return 'black-forest-labs/FLUX.1-schnell';
  if (providerId === 'cloudflare') return '@cf/black-forest-labs/flux-1-schnell';
  return undefined;
}

function shouldSkipProvider(e: any) {
  const status = Number(e?.status || 0);
  const code = String(e?.code || '');
  const msg = String(e?.message || '').toLowerCase();
  if (['EMPTY_RESPONSE', 'UNSUPPORTED', 'NOT_CONFIGURED', 'UNKNOWN_PROVIDER', 'RESOURCE_EXHAUSTED'].includes(code)) {
    return true;
  }
  if ([400, 401, 402, 403, 404, 429].includes(status)) return true;
  if (msg.includes('quota') || msg.includes('exceeded your current quota') || msg.includes('limit: 0')) {
    return true;
  }
  return false;
}

/** Prefer a real API failure over a "key not configured" skip for the final error. */
function preferError(current: any, next: any) {
  if (!current) return next;
  if (!next) return current;
  if (current?.code === 'NOT_CONFIGURED' && next?.code !== 'NOT_CONFIGURED') return next;
  if (next?.code === 'NOT_CONFIGURED' && current?.code !== 'NOT_CONFIGURED') return current;
  return next;
}

@Injectable()
export class ProviderManagerService {
  private map: Map<string, AIProvider>;

  constructor(
    @Inject(AI_CONTENT_PROVIDER_LIST) providers: AIProvider[],
    private readonly secretsService: StudioSecretsService,
  ) {
    this.map = new Map(providers.map((p) => [p.id, p]));
  }

  list() {
    return listRegistry()
      .filter((entry) => !HIDDEN_STUDIO_PROVIDERS.has(entry.id))
      .map((entry) => {
      const impl = this.map.get(entry.id);
      return {
        ...entry,
        capabilities: impl?.capabilities || {
          supportsText: entry.type !== 'image',
          supportsImage: entry.type !== 'text',
          supportsImageToImage: false,
          supportsAspectRatio: entry.type !== 'text',
          supportsNegativePrompt: false,
          supportsSeed: false,
          supportsResolution: entry.type !== 'text',
        },
      };
    });
  }

  get(id: string): AIProvider {
    const p = this.map.get(id);
    if (!p) {
      throw Object.assign(new Error(`Unknown provider: ${id}`), {
        status: 400,
        code: 'UNKNOWN_PROVIDER',
      });
    }
    return p;
  }

  async getModels(providerId: string, secrets: StudioSecretsPayload) {
    const p = this.get(providerId);
    const credentials = this.secretsService.credentialsFor(secrets, providerId);
    return p.getModels(credentials);
  }

  async validate(providerId: string, secrets: StudioSecretsPayload) {
    const p = this.get(providerId);
    const credentials = this.secretsService.credentialsFor(secrets, providerId);
    return p.validateKey(credentials);
  }

  private async withFallback<T>(
    chain: string[],
    secrets: StudioSecretsPayload,
    run: (provider: AIProvider, credentials: Record<string, string>) => Promise<T>,
    logs: any[],
  ): Promise<T & { usedProvider: string }> {
    let lastError: any;
    const unique = chain.filter((id, i, arr) => id && arr.indexOf(id) === i);

    for (let i = 0; i < unique.length; i++) {
      const id = unique[i];
      let provider: AIProvider;
      try {
        provider = this.get(id);
      } catch (e: any) {
        lastError = preferError(lastError, e);
        logs.push({
          level: 'warn',
          provider: id,
          message: e?.message || 'Unknown provider skipped',
          at: new Date().toISOString(),
        });
        continue;
      }
      const credentials = this.secretsService.credentialsFor(secrets, id);

      if (!hasRequiredCredentials(provider, credentials)) {
        const skipErr = Object.assign(new Error(`${provider.name} API key not configured`), {
          status: 400,
          code: 'NOT_CONFIGURED',
          provider: id,
        });
        // Keep the real Gemini/API failure — don't surface "Cloudflare not configured" as the cause.
        lastError = preferError(lastError, skipErr);
        logs.push({
          level: 'info',
          provider: id,
          message: `${id} skipped — API key not configured.`,
          at: new Date().toISOString(),
        });
        if (i < unique.length - 1) {
          logs.push({
            level: 'info',
            message: `${id} skipped → switching to ${unique[i + 1]}.`,
            at: new Date().toISOString(),
          });
        }
        continue;
      }

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await run(provider, credentials);
          if (i > 0 || attempt > 1) {
            logs.push({
              level: 'warn',
              message: `Recovered via ${id} (attempt ${attempt}).`,
              at: new Date().toISOString(),
            });
          }
          return { ...(result as any), usedProvider: id };
        } catch (e: any) {
          lastError = preferError(lastError, e);
          logs.push({
            level: 'error',
            provider: id,
            message: e?.message || 'Provider failed',
            status: e?.status,
            code: e?.code,
            attempt,
            at: new Date().toISOString(),
          });
          if (attempt < 2 && !shouldSkipProvider(e)) {
            await sleep(350 * attempt);
            logs.push({
              level: 'info',
              message: `Retrying ${id}…`,
              at: new Date().toISOString(),
            });
          } else {
            break;
          }
        }
      }

      if (i < unique.length - 1) {
        logs.push({
          level: 'info',
          message: `${id} failed → switching to ${unique[i + 1]}.`,
          at: new Date().toISOString(),
        });
      }
    }
    throw lastError;
  }

  async generateTextWithFallback(
    cfg: ModuleProviderConfig,
    prompt: string,
    secrets: StudioSecretsPayload,
    logs: any[] = [],
    vars: Record<string, string> = {},
    opts: {
      system?: string;
      temperature?: number;
      maxTokens?: number;
      minLength?: number;
      useGoogleSearch?: boolean;
    } = {},
  ) {
    const chain = expandAutoChain(cfg.provider || 'gemini', AUTO_TEXT_CHAIN);
    const rendered = applyTemplate(prompt, vars);
    const minLength = Math.max(8, Number(opts.minLength) || 8);
    return this.withFallback(
      chain,
      secrets,
      async (provider, credentials) => {
        if (!provider.generateText) {
          throw Object.assign(new Error(`${provider.name} does not support text`), {
            status: 400,
            code: 'UNSUPPORTED',
            provider: provider.id,
          });
        }
        const result = await provider.generateText({
          prompt: rendered,
          model: modelForProvider(provider.id, cfg),
          system: opts.system,
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
          useGoogleSearch: opts.useGoogleSearch && provider.id === 'gemini',
          credentials,
          custom: cfg.custom,
        });
        const text = String(result?.text || '').trim();
        if (!text || text.length < minLength) {
          throw Object.assign(
            new Error(
              `${provider.name} returned text that is too short/weak (${text.length} chars; need ≥${minLength})`,
            ),
            {
              status: 502,
              code: 'EMPTY_RESPONSE',
              provider: provider.id,
            },
          );
        }
        return result;
      },
      logs,
    );
  }

  async generateImageWithFallback(
    cfg: ModuleProviderConfig,
    prompt: string,
    secrets: StudioSecretsPayload,
    logs: any[] = [],
    opts: {
      vars?: Record<string, string>;
      aspectRatio?: string;
      width?: number;
      height?: number;
      negativePrompt?: string;
      seed?: number;
    } = {},
  ) {
    const rawChain = expandImageChain(cfg.provider || 'gemini');
    // Keep primary always; drop keyed peers that have no credentials (avoids fake Cloudflare errors).
    const chain = rawChain.filter((id, idx) => {
      if (idx === 0) return true;
      const provider = this.map.get(id);
      if (!provider) return false;
      if (!providerNeedsKey(provider)) return true;
      return hasRequiredCredentials(provider, this.secretsService.credentialsFor(secrets, id));
    });
    const rendered = applyTemplate(prompt, opts.vars || {});
    return this.withFallback(
      chain,
      secrets,
      async (provider, credentials) => {
        if (!provider.generateImage) {
          throw Object.assign(new Error(`${provider.name} does not support image`), {
            status: 400,
            code: 'UNSUPPORTED',
            provider: provider.id,
          });
        }
        const input: ImageGenerateInput = {
          prompt: rendered,
          model: imageModelForProvider(provider.id, cfg),
          credentials,
          aspectRatio: opts.aspectRatio,
          width: opts.width,
          height: opts.height,
          negativePrompt: opts.negativePrompt,
          seed: opts.seed,
          custom: cfg.custom,
        };
        return provider.generateImage(input);
      },
      logs,
    );
  }

  helpFor(providerId: string) {
    return PROVIDER_REGISTRY[providerId] || null;
  }
}
