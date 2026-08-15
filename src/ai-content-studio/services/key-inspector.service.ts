import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { AiContentStudioExecutionEntity } from '../entities/ai-content-studio.entity';
import { StudioSecretsService } from './studio-secrets.service';
import { StudioCryptoService } from './studio-crypto.service';
import { GEMINI_IMAGE_FALLBACK, GEMINI_IMAGE_MODEL } from '../providers/gemini.provider';
import { GEMINI_MODELS } from '../config/gemini-models';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const CACHE_MS = 45_000;

type ModelHealth =
  | 'available'
  | 'exhausted'
  | 'not_in_plan'
  | 'listed'
  | 'invalid'
  | 'unknown';

type PlanId = 'free' | 'paid' | 'working' | 'unknown';

const STUDIO_GEMINI_MODELS = [
  { id: GEMINI_MODELS.topic, label: 'Gemini 2.5 Flash', role: 'topic', modality: 'text' as const },
  { id: GEMINI_MODELS.content, label: 'Gemini 2.5 Pro', role: 'content', modality: 'text' as const },
  { id: GEMINI_IMAGE_FALLBACK, label: 'Gemini 2.5 Flash Image (Nano Banana)', role: 'imageFallback', modality: 'image' as const },
  { id: GEMINI_IMAGE_MODEL, label: 'Gemini 3 Pro Image (Nano Banana Pro)', role: 'image', modality: 'image' as const },
];

function sinceHours(hours = 24) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function parseRetrySeconds(msg: string) {
  const m = msg.match(/retry in\s+~?([\d.]+)\s*s/i);
  return m ? Math.ceil(Number(m[1])) : 0;
}

function parseQuotaMetric(msg: string) {
  const m = msg.match(/metric:\s*([a-z0-9._/-]+)/i);
  return m?.[1] || '';
}

function classifyGeminiBody(status: number, raw: any): {
  health: ModelHealth;
  message: string;
  metric?: string;
  retryAfterSeconds?: number;
  tierHint?: 'free' | 'paid';
} {
  const msg = String(raw?.error?.message || raw?.error?.status || '');
  const code = String(raw?.error?.status || '');
  const metric = parseQuotaMetric(msg);
  const retryAfterSeconds = parseRetrySeconds(msg);
  const blob = `${msg} ${code}`.toUpperCase();
  const tierHint: 'free' | 'paid' | undefined = /PAID_TIER/.test(blob)
    ? 'paid'
    : /FREE_TIER/.test(blob)
      ? 'free'
      : undefined;

  if (status >= 200 && status < 300) {
    return { health: 'available', message: 'ok', tierHint };
  }
  if (/API_KEY_INVALID|API_KEY_EXPIRED|API_KEY_INVALID/.test(blob) || status === 400 && /API KEY/i.test(msg)) {
    return { health: 'invalid', message: msg.slice(0, 220) || 'Invalid API key' };
  }
  if (status === 404) {
    return { health: 'not_in_plan', message: 'Model is not available on this key' };
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|QUOTA/i.test(blob)) {
    if (/limit:\s*0/.test(msg)) {
      return { health: 'not_in_plan', message: msg.slice(0, 220), metric, retryAfterSeconds, tierHint: tierHint || 'free' };
    }
    return { health: 'exhausted', message: msg.slice(0, 220), metric, retryAfterSeconds, tierHint };
  }
  if (status === 403 && /BILLING|PERMISSION/i.test(blob)) {
    return { health: 'not_in_plan', message: msg.slice(0, 220), tierHint: 'paid' };
  }
  return { health: 'unknown', message: msg.slice(0, 220) || `HTTP ${status}` };
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const raw = await res.json().catch(() => ({}));
    return { status: res.status, raw, ok: res.ok };
  } catch (e: any) {
    return { status: 0, raw: { error: { message: e?.message || 'Network error' } }, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class KeyInspectorService {
  private cache = new Map<string, { at: number; payload: any }>();

  constructor(
    private readonly secrets: StudioSecretsService,
    private readonly crypto: StudioCryptoService,
    @InjectRepository(AiContentStudioExecutionEntity)
    private readonly execRepo: Repository<AiContentStudioExecutionEntity>,
  ) {}

  async inspectAll(userId: string, force = false) {
    const secrets = await this.secrets.getSecrets(userId);
    const ids = ['gemini', 'groq', 'huggingface', 'facebook', 'instagram'].filter((id) => {
      const block = secrets[id] || {};
      return Object.values(block).some((v) => String(v || '').trim());
    });
    const list = ids.length ? ids : ['gemini'];
    const providers: Record<string, any> = {};
    await Promise.all(
      list.map(async (id) => {
        providers[id] = await this.inspectProvider(userId, id, force);
      }),
    );
    return { inspectedAt: new Date().toISOString(), providers };
  }

  async inspectProvider(userId: string, providerId: string, force = false) {
    const cacheKey = `${userId}:${providerId}`;
    const hit = this.cache.get(cacheKey);
    if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.payload;

    const secrets = await this.secrets.getSecrets(userId);
    let payload: any;
    if (providerId === 'gemini') payload = await this.inspectGemini(userId, secrets.gemini?.apiKey);
    else if (providerId === 'groq') payload = await this.inspectGroq(secrets.groq?.apiKey);
    else if (providerId === 'huggingface') payload = await this.inspectHuggingFace(secrets.huggingface?.apiKey);
    else if (providerId === 'facebook' || providerId === 'instagram') {
      payload = await this.inspectMeta(providerId, secrets[providerId]?.accessToken);
    } else {
      payload = { provider: providerId, configured: false, status: 'unsupported' };
    }

    this.cache.set(cacheKey, { at: Date.now(), payload });
    return payload;
  }

  private async inspectGemini(userId: string, apiKey?: string) {
    if (!String(apiKey || '').trim()) {
      return {
        provider: 'gemini',
        configured: false,
        status: 'missing',
        hint: null,
        expires: { kind: 'none', label: 'Google API keys do not expire until you revoke them.' },
        plan: { id: 'unknown' as PlanId, label: 'No key saved' },
        models: [],
        usage: await this.studioUsage(userId, 'gemini'),
      };
    }

    const hint = this.crypto.maskSecret(apiKey);
    const listed = await fetchJson(`${GEMINI_API}/models?key=${encodeURIComponent(apiKey!)}`);
    if (!listed.ok) {
      const cls = classifyGeminiBody(listed.status, listed.raw);
      const invalid = cls.health === 'invalid' || listed.status === 400 || listed.status === 401 || listed.status === 403;
      return {
        provider: 'gemini',
        configured: true,
        status: invalid ? 'invalid' : 'error',
        hint,
        fingerprint: hint,
        expires: { kind: invalid ? 'revoked' : 'none', label: invalid ? 'This key is invalid or revoked.' : 'Google API keys do not expire until you revoke them.' },
        plan: { id: 'unknown' as PlanId, label: 'Could not read plan' },
        message: cls.message,
        models: [],
        usage: await this.studioUsage(userId, 'gemini'),
        docs: this.geminiDocs(),
      };
    }

    const remoteModels = (listed.raw?.models || [])
      .map((m: any) => String(m?.name || '').replace(/^models\//, ''))
      .filter(Boolean);
    const listedSet = new Set(remoteModels);

    const probes = await Promise.all(
      STUDIO_GEMINI_MODELS.map(async (def) => {
        const probe = await this.probeGeminiModel(apiKey!, def.id, listedSet.has(def.id));
        return { ...def, ...probe, listed: listedSet.has(def.id) };
      }),
    );

    const extraModels = remoteModels
      .filter((id: string) => /gemini/i.test(id) && !STUDIO_GEMINI_MODELS.some((d) => d.id === id))
      .slice(0, 18)
      .map((id: string) => ({
        id,
        label: id,
        role: 'other',
        modality: /image/i.test(id) ? 'image' : 'text',
        health: 'listed' as ModelHealth,
        listed: true,
      }));

    const plan = this.inferGeminiPlan(probes);
    const ready = probes.some((p) => p.health === 'available');
    const exhausted = probes.some((p) => p.health === 'exhausted');

    return {
      provider: 'gemini',
      configured: true,
      status: ready ? (exhausted ? 'limited' : 'valid') : exhausted ? 'exhausted' : 'valid',
      hint,
      fingerprint: hint,
      expires: {
        kind: 'none',
        label: 'Google API keys do not expire. They stay valid until you revoke or delete them in AI Studio.',
      },
      plan,
      models: [...probes, ...extraModels],
      usage: await this.studioUsage(userId, 'gemini'),
      docs: this.geminiDocs(),
    };
  }

  private async probeGeminiModel(apiKey: string, model: string, listed: boolean) {
    const tokenUrl = `${GEMINI_API}/models/${model}:countTokens?key=${encodeURIComponent(apiKey)}`;
    const counted = await fetchJson(
      tokenUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
      },
      10000,
    );
    if (counted.ok) {
      return { health: 'available' as ModelHealth, message: 'Ready on this key' };
    }
    const cls = classifyGeminiBody(counted.status, counted.raw);
    if (cls.health === 'invalid' || cls.health === 'exhausted' || cls.health === 'not_in_plan') {
      return { health: cls.health, message: cls.message, metric: cls.metric, retryAfterSeconds: cls.retryAfterSeconds, tierHint: cls.tierHint };
    }
    const meta = await fetchJson(`${GEMINI_API}/models/${model}?key=${encodeURIComponent(apiKey)}`, {}, 8000);
    if (meta.ok) {
      return {
        health: (listed ? 'listed' : 'available') as ModelHealth,
        message: 'Listed on this key. Live generate quota is checked when you run Image/Content.',
      };
    }
    const metaCls = classifyGeminiBody(meta.status, meta.raw);
    return {
      health: listed ? 'listed' : metaCls.health,
      message: metaCls.message || cls.message,
      metric: metaCls.metric || cls.metric,
      retryAfterSeconds: metaCls.retryAfterSeconds || cls.retryAfterSeconds,
      tierHint: metaCls.tierHint || cls.tierHint,
    };
  }

  private inferGeminiPlan(probes: Array<{ id: string; health: ModelHealth; tierHint?: string }>) {
    const joinedHints = probes.map((p) => p.tierHint).filter(Boolean);
    const pro = probes.find((p) => p.id === GEMINI_IMAGE_MODEL);
    const flashImg = probes.find((p) => p.id === GEMINI_IMAGE_FALLBACK);
    const flash = probes.find((p) => p.id === GEMINI_MODELS.topic);

    if (pro?.health === 'available') {
      return { id: 'paid' as PlanId, label: 'Paid (Nano Banana Pro is enabled)', confidence: 'high' };
    }
    if (pro?.health === 'not_in_plan' && (flash?.health === 'available' || flashImg?.health === 'available' || flashImg?.health === 'listed')) {
      return {
        id: 'free' as PlanId,
        label: 'Free tier — Nano Banana Pro is not included',
        confidence: 'high',
      };
    }
    if (joinedHints.includes('paid')) {
      return { id: 'paid' as PlanId, label: 'Paid tier', confidence: 'medium' };
    }
    if (joinedHints.includes('free') || flash?.health === 'available') {
      return { id: 'free' as PlanId, label: 'Free tier', confidence: 'medium' };
    }
    if (probes.some((p) => p.health === 'available' || p.health === 'listed')) {
      return { id: 'working' as PlanId, label: 'Working — billing tier not published on the key', confidence: 'low' };
    }
    return { id: 'unknown' as PlanId, label: 'Unknown', confidence: 'low' };
  }

  private geminiDocs() {
    return {
      rateLimits: 'https://ai.dev/rate-limit',
      usage: 'https://aistudio.google.com/usage',
      billing: 'https://aistudio.google.com/apikey',
    };
  }

  private async inspectGroq(apiKey?: string) {
    if (!String(apiKey || '').trim()) {
      return { provider: 'groq', configured: false, status: 'missing', models: [] };
    }
    const hint = this.crypto.maskSecret(apiKey);
    const res = await fetchJson('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return {
        provider: 'groq',
        configured: true,
        status: 'invalid',
        hint,
        expires: { kind: 'unknown', label: 'Groq keys stay valid until revoked.' },
        plan: { id: 'unknown', label: 'Could not read Groq key' },
        message: String(res.raw?.error?.message || `HTTP ${res.status}`).slice(0, 220),
        models: [],
      };
    }
    const models = (res.raw?.data || []).slice(0, 24).map((m: any) => ({
      id: m.id,
      label: m.id,
      modality: 'text',
      health: 'listed' as ModelHealth,
    }));
    return {
      provider: 'groq',
      configured: true,
      status: 'valid',
      hint,
      expires: { kind: 'none', label: 'Groq API keys do not expire until you revoke them.' },
      plan: { id: 'working', label: 'Developer key (typically free-tier credits)' },
      models,
    };
  }

  private async inspectHuggingFace(apiKey?: string) {
    if (!String(apiKey || '').trim()) {
      return { provider: 'huggingface', configured: false, status: 'missing', models: [] };
    }
    const hint = this.crypto.maskSecret(apiKey);
    const res = await fetchJson('https://huggingface.co/api/whoami-v2', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return {
        provider: 'huggingface',
        configured: true,
        status: 'invalid',
        hint,
        expires: { kind: 'unknown', label: 'Could not read this Hugging Face token.' },
        plan: { id: 'unknown', label: 'Invalid token' },
        models: [],
      };
    }
    const expiresAt = res.raw?.auth?.accessToken?.expiresAt || res.raw?.auth?.accessToken?.expires_at || null;
    const kind = expiresAt ? 'dated' : 'none';
    return {
      provider: 'huggingface',
      configured: true,
      status: 'valid',
      hint,
      identity: res.raw?.name || res.raw?.email || null,
      expires: {
        kind,
        at: expiresAt,
        label: expiresAt
          ? `Expires ${new Date(expiresAt).toISOString()}`
          : 'This Hugging Face token has no expiry date.',
      },
      plan: { id: 'working', label: res.raw?.auth?.type || 'Hugging Face token' },
      models: [],
    };
  }

  private async inspectMeta(provider: 'facebook' | 'instagram', token?: string) {
    if (!String(token || '').trim()) {
      return { provider, configured: false, status: 'missing' };
    }
    const hint = this.crypto.maskSecret(token);
    const url = `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token!)}&access_token=${encodeURIComponent(token!)}`;
    const res = await fetchJson(url);
    const data = res.raw?.data || {};
    const expiresUnix = Number(data.expires_at || 0);
    const isValid = data.is_valid === true;
    const never = expiresUnix === 0;
    const expired = !never && expiresUnix * 1000 < Date.now();
    return {
      provider,
      configured: true,
      status: !isValid || expired ? 'invalid' : 'valid',
      hint,
      expires: {
        kind: never ? 'none' : expired ? 'expired' : 'dated',
        at: never ? null : new Date(expiresUnix * 1000).toISOString(),
        label: never
          ? 'This Meta token does not expire (until revoked).'
          : expired
            ? 'This Meta token has expired.'
            : `Expires ${new Date(expiresUnix * 1000).toLocaleString()}`,
      },
      plan: { id: 'working', label: data.type || 'Meta Graph token' },
      scopes: Array.isArray(data.scopes) ? data.scopes : [],
      models: [],
    };
  }

  private async studioUsage(userId: string, provider: string) {
    const since = sinceHours(24);
    const rows = await this.execRepo.find({
      where: { userId, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'DESC' },
      take: 80,
    });
    let textRequests = 0;
    let imageRequests = 0;
    let tokens = 0;
    let lastQuota: any = null;
    for (const row of rows) {
      for (const log of row.logsJson || []) {
        if (provider && log?.provider && log.provider !== provider) continue;
        const usage = log?.usage || {};
        tokens += Number(usage.totalTokens || 0);
        if (log?.module === 'image') imageRequests += 1;
        else if (['topic', 'content', 'research', 'validate'].includes(String(log?.module || ''))) textRequests += 1;
      }
      for (const err of row.errorsJson || []) {
        if (err?.status === 429 || /quota|exhausted/i.test(String(err?.message || err?.kind || ''))) {
          if (!lastQuota) lastQuota = { at: err.at || row.createdAt, module: err.module, kind: err.kind, message: err.title || err.message };
        }
      }
    }
    return {
      scope: 'studio_last_24h',
      textRequests,
      imageRequests,
      tokens,
      runs: rows.length,
      lastQuotaError: lastQuota,
      note: 'Google does not publish remaining RPM/RPD on the API key. This is this studio’s usage in the last 24 hours. Exact remaining is on AI Studio.',
    };
  }
}
