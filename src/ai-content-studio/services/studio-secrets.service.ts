import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AiContentStudioSecretsEntity } from '../entities/ai-content-studio.entity';
import { StudioCryptoService, StudioSecretsPayload } from './studio-crypto.service';

@Injectable()
export class StudioSecretsService {
  constructor(
    @InjectRepository(AiContentStudioSecretsEntity)
    private readonly repo: Repository<AiContentStudioSecretsEntity>,
    private readonly crypto: StudioCryptoService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Optional shared .env keys for single-tenant local demos only.
   * Multi-user: each user must save keys from the Studio UI (not .env).
   * Enable with AI_CONTENT_STUDIO_USE_ENV_KEYS=true
   */
  envFallback(): StudioSecretsPayload {
    return {
      gemini: { apiKey: this.config.get('GEMINI_API_KEY') || this.config.get('GOOGLE_AI_API_KEY') || undefined },
      groq: { apiKey: this.config.get('GROQ_API_KEY') || undefined },
      cloudflare: {
        accountId: this.config.get('CLOUDFLARE_ACCOUNT_ID') || undefined,
        apiToken: this.config.get('CLOUDFLARE_API_TOKEN') || undefined,
      },
      huggingface: { apiKey: this.config.get('HUGGINGFACE_API_KEY') || this.config.get('HF_TOKEN') || undefined },
      openai_compatible: {
        apiKey: this.config.get('OPENAI_API_KEY') || undefined,
        baseUrl: this.config.get('OPENAI_BASE_URL') || undefined,
      },
      comfyui: {
        baseUrl: this.config.get('COMFYUI_URL') || undefined,
        checkpoint: this.config.get('COMFYUI_CHECKPOINT') || undefined,
      },
      facebook: {
        pageId: this.config.get('FACEBOOK_PAGE_ID') || undefined,
        accessToken: this.config.get('FACEBOOK_ACCESS_TOKEN') || undefined,
      },
      instagram: {
        igUserId: this.config.get('INSTAGRAM_BUSINESS_ACCOUNT_ID') || undefined,
        accessToken: this.config.get('INSTAGRAM_ACCESS_TOKEN') || undefined,
      },
    };
  }

  private useEnvKeys() {
    return String(this.config.get('AI_CONTENT_STUDIO_USE_ENV_KEYS') || '').toLowerCase() === 'true';
  }

  private merge(a: StudioSecretsPayload, b: StudioSecretsPayload): StudioSecretsPayload {
    const out: StudioSecretsPayload = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (!v) continue;
      out[k] = { ...(out[k] || {}), ...Object.fromEntries(Object.entries(v).filter(([, val]) => val)) };
    }
    return out;
  }

  /** Secrets saved by this user in the Studio UI (DB only). */
  async getDbSecrets(userId: string): Promise<StudioSecretsPayload> {
    const row = await this.repo.findOne({ where: { userId } });
    if (!row?.encryptedPayload) return {};
    try {
      return this.crypto.decrypt(row.encryptedPayload) || {};
    } catch {
      return {};
    }
  }

  private geminiEnvKey() {
    return this.config.get('GEMINI_API_KEY') || this.config.get('GOOGLE_AI_API_KEY') || '';
  }

  /**
   * If the user has no Gemini key yet, copy GEMINI_API_KEY from .env into their studio secrets
   * so the UI opens already configured.
   */
  async ensureGeminiFromEnv(userId: string) {
    const envKey = String(this.geminiEnvKey() || '').trim();
    const fromDb = await this.getDbSecrets(userId);
    if (fromDb.gemini?.apiKey || !envKey) {
      return this.getMasked(userId);
    }
    await this.upsertSecrets(userId, { gemini: { apiKey: envKey } });
    return this.getMasked(userId);
  }

  /**
   * Effective secrets for API calls.
   * Gemini env key is always a fallback so the studio can open ready-to-run.
   * Other providers stay per-user unless AI_CONTENT_STUDIO_USE_ENV_KEYS=true.
   */
  async getSecrets(userId: string): Promise<StudioSecretsPayload> {
    const fromDb = await this.getDbSecrets(userId);
    const geminiEnv = String(this.geminiEnvKey() || '').trim();
    const geminiFallback = geminiEnv ? { gemini: { apiKey: geminiEnv } } : {};
    if (!this.useEnvKeys()) {
      return this.merge(geminiFallback, fromDb);
    }
    return this.merge(this.envFallback(), fromDb);
  }

  async upsertSecrets(userId: string, patch: StudioSecretsPayload) {
    // Never bake shared .env keys into a user's encrypted row.
    const current = await this.getDbSecrets(userId);
    const cleaned: StudioSecretsPayload = {};
    for (const [provider, fields] of Object.entries(patch || {})) {
      if (!fields || typeof fields !== 'object') continue;
      const next: Record<string, string> = { ...(current[provider] || {}) } as any;
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined || v === null) continue;
        const raw = String(v);
        if (raw === '') continue; // keep existing
        if (raw === '__CLEAR__') {
          delete next[k];
          continue;
        }
        next[k] = this.normalizeSecretValue(raw);
      }
      cleaned[provider] = next;
    }
    const merged = { ...current, ...cleaned };
    let row = await this.repo.findOne({ where: { userId } });
    const encryptedPayload = this.crypto.encrypt(merged);
    if (!row) {
      row = this.repo.create({
        userId,
        encryptedPayload,
      });
    } else {
      row.encryptedPayload = encryptedPayload;
    }
    await this.repo.save(row);
    return this.maskedStatus(merged);
  }

  /** Strip copy/paste noise (Bearer, zero-width chars, Hugging Face hf_… token from a blob). */
  private normalizeSecretValue(raw: string) {
    let s = String(raw || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/^\s*Bearer\s+/i, '')
      .trim();
    const hf = s.match(/hf_[A-Za-z0-9]+/);
    if (hf) return hf[0];
    return s.replace(/\s+/g, ' ').trim();
  }

  maskedStatus(secrets: StudioSecretsPayload) {
    const status: Record<string, any> = {};
    for (const [provider, fields] of Object.entries(secrets)) {
      if (!fields) continue;
      const entry: Record<string, any> = { configured: false, fields: {} };
      let any = false;
      for (const [k, v] of Object.entries(fields)) {
        const has = Boolean(v);
        any = any || has;
        entry.fields[k] = {
          configured: has,
          hint: this.crypto.maskSecret(v),
        };
      }
      entry.configured = any;
      status[provider] = entry;
    }
    return {
      message: 'Secrets are stored securely on the server.',
      secrets: status,
    };
  }

  async getMasked(userId: string) {
    const fromDb = await this.getDbSecrets(userId);
    const geminiEnv = String(this.geminiEnvKey() || '').trim();
    const secrets =
      geminiEnv && !fromDb.gemini?.apiKey
        ? { ...fromDb, gemini: { ...(fromDb.gemini || {}), apiKey: geminiEnv } }
        : fromDb;
    return this.maskedStatus(secrets);
  }

  credentialsFor(secrets: StudioSecretsPayload, providerId: string): Record<string, string> {
    const block = secrets[providerId] || {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(block)) {
      if (v) out[k] = v;
    }
    return out;
  }
}
