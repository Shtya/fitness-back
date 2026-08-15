import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AiContentStudioConfigEntity,
  AiContentStudioExecutionEntity,
  PipelineStatus,
} from '../entities/ai-content-studio.entity';
import { ProviderManagerService, ModuleProviderConfig } from './provider-manager.service';
import { StudioSecretsService } from './studio-secrets.service';
import { StudioMediaService } from './studio-media.service';
import { MetaPublishService } from './meta-publish.service';
import { DesignOverlayService } from './design-overlay.service';
import { TopicResearchService, ResearchSourceId, ResearchQuery } from './topic-research.service';
import { BrowserFacebookPublisher } from './browser-facebook.publisher';
import { BrowserInstagramPublisher } from './browser-instagram.publisher';
import { applyTemplate } from '../providers/ai-provider';
import { resolveGeminiImageModel } from '../providers/gemini.provider';
import { GEMINI_MODELS } from '../config/gemini-models';
import { classifyStudioError } from '../errors/studio-client-error';
import {
  COACHIANO_BRAND,
  COACHIANO_CONTENT_PROMPT,
  COACHIANO_PERSONA_INSTRUCTIONS,
  buildImagePromptFromPost,
  nicheGuard,
} from '../brand/coachiano-brand';

export type StudioPipelineConfig = {
  automationEnabled?: boolean;
  freeMode?: boolean;
  language?: 'ar' | 'en';
  audience?: string;
  brandName?: string;
  /** Sticky-note override: when set, skip AI topic generation on full runs */
  manualTopic?: string;
  autoPublish?: boolean;
  schedule?: {
    enabled?: boolean;
    time?: string; // HH:mm 24h
    days?: string[]; // sat..fri
    timezone?: string;
  };
  /** Public web research before topic generation */
  research?: {
    enabled?: boolean;
    sources?: ResearchSourceId[];
    brief?: string;
    maxResults?: number;
  };
  topic?: ModuleProviderConfig & { prompt?: string; enabled?: boolean };
  content?: ModuleProviderConfig & { prompt?: string; enabled?: boolean };
  image?: ModuleProviderConfig & {
    prompt?: string;
    enabled?: boolean;
    aspectRatio?: string;
    resolution?: string;
    negativePrompt?: string;
  };
  design?: any;
  facebook?: { enabled?: boolean; pageId?: string; publishMode?: 'browser' | 'api' };
  instagram?: { enabled?: boolean; igUserId?: string; publishMode?: 'browser' | 'api' };
  persona?: { name?: string; role?: string; instructions?: string };
  /** manual = lock composer text; ai = generate (research is inspiration) */
  topicSource?: 'manual' | 'ai';
};

const DEFAULT_PERSONA = {
  name: 'Maged Said',
  role: 'خبير تربوي واستشاري أسري',
  instructions: COACHIANO_PERSONA_INSTRUCTIONS,
};

const DEFAULT_TOPIC_PROMPT = `أنت كوتش تربوي يخاطب أولياء أمور مصريين مغتربين في الخليج (جمهور So7baFit / أسلوب الكوتشيانو).

المطلوب: موضوع واحد فقط لمنشور اليوم — حاد، ملحّ، ومشبع بالموقف اليومي (مش فكرة عامة).

اختر زاوية من واقع المغتربين مثل:
- صراع اللهجة والهوية («إيش فيك يا أبوي» بدل «مالك يا بابا»)
- فقاعة الرفاهية والهشاشة النفسية
- شبح النزول النهائي لمصر
- الأب اللي بقى مكنة ATM
- غياب تيتا وجدو والاحتراق الوالدي
- الشاشات والحدود داخل البيت
- ضغط الدراسة والمدارس الدولية

اكتب الموضوع في جملة واحدة قوية وواضحة (14–24 كلمة) فيها موقف ملموس + إحساس/صراع، بلسان حال الأب أو الأم.
مثال للروح (لا تنسخه): هو إحنا ليه بتجيلنا صدمة خفيفة لما ابننا يقول «إيش فيك يا أبوي» بدل «مالك يا بابا»؟

ممنوع: مقدمة، تعداد، شرح، علامات اقتباس، جمل وعظية فضفاضة، أو أكثر من سطر واحد.
أعد الجملة فقط.`;

const DEFAULT_CONTENT_PROMPT = COACHIANO_CONTENT_PROMPT;

@Injectable()
export class PipelineService {
  private trendingCache = new Map<string, { topics: Array<{ title: string; angle?: string }>; at: number }>();

  constructor(
    @InjectRepository(AiContentStudioConfigEntity)
    private readonly configRepo: Repository<AiContentStudioConfigEntity>,
    @InjectRepository(AiContentStudioExecutionEntity)
    private readonly execRepo: Repository<AiContentStudioExecutionEntity>,
    private readonly providers: ProviderManagerService,
    private readonly secrets: StudioSecretsService,
    private readonly media: StudioMediaService,
    private readonly meta: MetaPublishService,
    private readonly design: DesignOverlayService,
    private readonly research: TopicResearchService,
    private readonly fbBrowser: BrowserFacebookPublisher,
    private readonly igBrowser: BrowserInstagramPublisher,
  ) {}

  defaults(): StudioPipelineConfig {
    return {
      automationEnabled: true,
      freeMode: false,
      language: 'ar',
      audience: 'Egyptian Parents',
      brandName: 'So7baFit',
      manualTopic:
        'هو إحنا ليه بتجيلنا صدمة خفيفة لما ابننا يقول «إيش فيك يا أبوي» بدل «مالك يا بابا»؟',
      autoPublish: false,
      schedule: {
        enabled: true,
        time: '21:00',
        days: ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'],
        timezone: 'Africa/Cairo',
      },
      research: {
        enabled: true,
        sources: ['google', 'facebook', 'instagram'],
        brief: 'دور على فيسبوك وإنستجرام ترندات تربية الأسر المصرية المغتربة في الخليج: الهوية، اللهجات، غياب الأجداد، الأب ATM، النزول النهائي، الشاشات.',
        maxResults: 10,
      },
      persona: { ...DEFAULT_PERSONA },
      topicSource: 'ai',
      topic: {
        enabled: true,
        provider: 'gemini',
        model: GEMINI_MODELS.topic,
        prompt: '', // extra instructions only; final prompt is built server-side
      },
      content: {
        enabled: true,
        provider: 'gemini',
        model: GEMINI_MODELS.content,
        prompt: '', // extra instructions only; final prompt is built server-side
      },
      image: {
        enabled: true,
        provider: 'gemini',
        model: GEMINI_MODELS.image,
        prompt: '', // optional extra instructions only; base visual is built from content+topic
        aspectRatio: '1:1',
        resolution: '1024x1024',
        negativePrompt:
          'text, watermark, logo, cartoon, deformed hands, extra fingers, blurry, low quality',
      },
      design: {
        enabled: false,
        mode: 'off',
        font: 'Tahoma',
        fontSize: 48,
        fontWeight: 700,
        position: 'bottom',
        alignment: 'right',
        backgroundOverlay: 0.4,
        brandColor: '#6366f1',
        textColor: '#ffffff',
      },
      facebook: { enabled: false, publishMode: 'browser' },
      instagram: { enabled: false, publishMode: 'browser' },
    };
  }

  async getConfig(userId: string) {
    const row = await this.configRepo.findOne({ where: { userId } });
    const base = this.defaults();
    if (!row) {
      return { ...base, automationEnabled: false };
    }
    return this.normalizeConfig({
      ...base,
      ...(row.configJson || {}),
      automationEnabled: row.automationEnabled,
    });
  }

  /** Move retired free no-key stacks to Gemini + Nano Banana Pro. */
  normalizeConfig(config: StudioPipelineConfig): StudioPipelineConfig {
    const cfg: any = { ...config };
    const FREE_TEXT = new Set(['ai-free', 'llm7-free', 'pollinations-free', 'browser-chatgpt']);
    const FREE_IMAGE = new Set(['pollinations-image']);

    if (!cfg.topic?.provider || FREE_TEXT.has(cfg.topic.provider) || cfg.topic.model === 'auto') {
      cfg.topic = { ...cfg.topic, provider: 'gemini', model: 'gemini-2.5-flash' };
    }
    if (!cfg.content?.provider || FREE_TEXT.has(cfg.content.provider) || cfg.content.model === 'auto') {
      cfg.content = { ...cfg.content, provider: 'gemini', model: 'gemini-2.5-pro' };
    }
    if (!cfg.image?.provider || FREE_IMAGE.has(cfg.image.provider) || cfg.image.provider === 'huggingface') {
      cfg.image = { ...cfg.image, provider: 'gemini', model: 'gemini-3-pro-image' };
    }
    if (cfg.image?.provider === 'gemini') {
      const nextImageModel = resolveGeminiImageModel(cfg.image.model);
      if (nextImageModel !== cfg.image.model) {
        cfg.image = { ...cfg.image, model: nextImageModel };
      }
    }
    const weakGroq = new Set([
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'qwen/qwen3-32b',
      'openai/gpt-oss-20b',
      '',
    ]);
    if (cfg.topic?.provider === 'groq' && weakGroq.has(String(cfg.topic?.model || ''))) {
      cfg.topic = { ...cfg.topic, model: 'openai/gpt-oss-120b' };
    }
    if (cfg.content?.provider === 'groq' && weakGroq.has(String(cfg.content?.model || ''))) {
      cfg.content = { ...cfg.content, model: 'openai/gpt-oss-120b' };
    }
    cfg.freeMode = false;
    if (cfg.manualTopic == null) {
      cfg.manualTopic =
        'هو إحنا ليه بتجيلنا صدمة خفيفة لما ابننا يقول «إيش فيك يا أبوي» بدل «مالك يا بابا»؟';
    }
    if (!cfg.research) {
      cfg.research = {
        enabled: true,
        sources: ['google', 'facebook', 'instagram'],
        brief:
          'دور على فيسبوك وإنستجرام ترندات تربية الأسر المصرية المغتربة في الخليج: الهوية، اللهجات، غياب الأجداد، الأب ATM، النزول النهائي، الشاشات.',
        maxResults: 10,
      };
    } else if (cfg.research.enabled == null) {
      cfg.research = { ...cfg.research, enabled: true };
    }
    if (!cfg.persona || (!cfg.persona.name && !cfg.persona.role && !cfg.persona.instructions)) {
      cfg.persona = { ...DEFAULT_PERSONA };
    }
    if (!cfg.topicSource) cfg.topicSource = 'ai';
    if (!cfg.facebook) cfg.facebook = { enabled: false, publishMode: 'browser' };
    if (!cfg.facebook.publishMode) cfg.facebook = { ...cfg.facebook, publishMode: 'browser' };
    if (!cfg.instagram) cfg.instagram = { enabled: false, publishMode: 'browser' };
    if (!cfg.instagram.publishMode) cfg.instagram = { ...cfg.instagram, publishMode: 'browser' };
    // Legacy full image prompts become empty — base prompt is always content-driven server-side
    if (this.isLegacyFullImagePrompt(cfg.image?.prompt)) {
      cfg.image = { ...cfg.image, prompt: '' };
    }
    // Node prompt fields are extra instructions only — never store the full system prompt there
    if (this.isLegacyFullTextPrompt(cfg.topic?.prompt)) {
      cfg.topic = { ...cfg.topic, prompt: '' };
    }
    if (this.isLegacyFullTextPrompt(cfg.content?.prompt)) {
      cfg.content = { ...cfg.content, prompt: '' };
    }
    if (cfg.design?.enabled == null) {
      cfg.design = { ...(cfg.design || {}), enabled: false, mode: cfg.design?.mode || 'off' };
    }
    return cfg;
  }

  /** Old configs stored the full topic/content system prompt in the node field — now extras only. */
  private isLegacyFullTextPrompt(prompt?: string) {
    const p = String(prompt || '').trim();
    if (!p) return false;
    return (
      p === DEFAULT_TOPIC_PROMPT.trim() ||
      p === DEFAULT_CONTENT_PROMPT.trim() ||
      p.includes('أنت كوتش تربوي يخاطب أولياء أمور') ||
      p.includes('اكتب منشور فيسبوك/إنستجرام بأسلوب الكوتشيانو') ||
      p.includes('سؤال الخطاف') ||
      p.includes('أسلوب «الكوتشيانو»') ||
      p.includes('أعطني موضوعاً تربوياً واحداً') ||
      p.includes('اكتب منشوراً تفاعلياً مناسباً لفيسبوك') ||
      (p.length > 350 && p.includes('هيكل مطلوب'))
    );
  }

  /** Always use the server default as the real prompt; node.prompt is optional extra roles. */
  private composeTextPrompt(baseDefault: string, extra: string | undefined, cfg: StudioPipelineConfig): string {
    const extras = this.isLegacyFullTextPrompt(extra) ? '' : String(extra || '').trim();
    let prompt = this.applyPersona(baseDefault, cfg);
    if (extras) {
      prompt = `${prompt}\n\nتعليمات إضافية من المحرر (أدوار وقيود فقط — ليست الموضوع/المنشور النهائي):\n${extras}`;
    }
    return prompt;
  }

  /** Old configs stored the full image base prompt in image.prompt — that field is now extras only. */
  private isLegacyFullImagePrompt(prompt?: string) {
    const p = String(prompt || '').trim();
    if (!p) return false;
    return (
      p.includes('Create a premium Instagram/Facebook square poster') ||
      p.includes('Create a warm modern Arabic Egyptian Islamic social media visual') ||
      (p.includes('{{topic}}') && p.length > 400 && !p.toLowerCase().includes('additional'))
    );
  }

  /**
   * Image prompt is always driven by topic + generated content.
   * cfg.image.prompt is optional extra creative direction from the editor.
   */
  private buildImagePrompt(cfg: StudioPipelineConfig, vars: Record<string, string>, extraOverride?: string) {
    const topic = String(vars.topic || '').trim();
    const content = String(vars.content || '').trim() || topic;
    const extraRaw = String(extraOverride ?? cfg.image?.prompt ?? '').trim();
    const extra = extraRaw && !this.isLegacyFullImagePrompt(extraRaw) ? applyTemplate(extraRaw, { ...vars, topic, content }) : '';
    return buildImagePromptFromPost(topic || content.slice(0, 140), content, extra);
  }

  async saveConfig(userId: string, config: StudioPipelineConfig) {
    const sanitized = this.stripSecrets(config);
    let row = await this.configRepo.findOne({ where: { userId } });
    if (!row) {
      row = this.configRepo.create({
        userId,
        configJson: sanitized,
        automationEnabled: Boolean(sanitized.automationEnabled),
      });
    } else {
      row.configJson = sanitized;
      row.automationEnabled = Boolean(sanitized.automationEnabled);
    }
    await this.configRepo.save(row);
    return this.getConfig(userId);
  }

  stripSecrets(config: any) {
    const clone = JSON.parse(JSON.stringify(config || {}));
    const scrub = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      for (const key of Object.keys(obj)) {
        if (/apiKey|token|secret|password|accessToken/i.test(key)) {
          delete obj[key];
        } else if (typeof obj[key] === 'object') {
          scrub(obj[key]);
        }
      }
    };
    scrub(clone);
    return clone;
  }

  private buildVars(cfg: StudioPipelineConfig, partial: Record<string, string> = {}) {
    const now = new Date();
    const persona = cfg.persona || {};
    return {
      topic: partial.topic || '',
      content: partial.content || '',
      headline: partial.headline || '',
      research: partial.research || '',
      date: now.toISOString().slice(0, 10),
      day: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: cfg.schedule?.timezone || 'Africa/Cairo' }),
      brand_name: cfg.brandName || 'So7baFit',
      audience: cfg.audience || 'Egyptian Parents',
      language: cfg.language === 'en' ? 'English' : 'Arabic',
      persona_name: persona.name || '',
      persona_role: persona.role || '',
      persona_instructions: persona.instructions || '',
      ...partial,
    };
  }

  private applyPersona(prompt: string, cfg: StudioPipelineConfig): string {
    const p = cfg.persona || {};
    const name = String(p.name || '').trim();
    const role = String(p.role || '').trim();
    const instructions = String(p.instructions || '').trim();
    if (!name && !role && !instructions) return prompt;
    return `صوت الكاتب / هوية الشخص اللي بيتعامل مع الـ AI:
${name ? `الاسم: ${name}` : ''}
${role ? `الدور: ${role}` : ''}
${instructions ? `التعليمات الثابتة:\n${instructions}` : ''}

التزم بهذا الصوت والهوية في كل جملة. لا تخرج عنها. اكتب بقوة ووضوح — ممنوع النبرة الضعيفة أو العبارات العامة الميتة.

${prompt}`;
  }

  /** System message for text providers that support role=system. */
  private buildWritingSystem(cfg: StudioPipelineConfig) {
    const p = cfg.persona || {};
    const name = String(p.name || 'Maged Said').trim();
    const role = String(p.role || 'خبير تربوي واستشاري أسري').trim();
    const instructions = String(p.instructions || '').trim();
    return `أنت تكتب بأسلوب «الكوتشيانو» لبراند ${cfg.brandName || 'So7baFit'}.
تكتب باسم ${name} (${role}) لجمهور ${cfg.audience || 'Egyptian Parents'} — أسر مصرية مغتربة في الخليج.
اللغة: مزيج ذكي بين العامية المصرية الراقية والفصحى المبسطة. حس فكاهة مصري أصيل + عمق نفسي + لمسة إيمانية.
${instructions ? `\nهوية الصوت:\n${instructions}` : ''}
قواعد جودة صارمة:
- التزم بهيكل س / ج / سؤال التفاعل.
- كل جملة لازم تضيف معنى جديد.
- ابدأ بسؤال خطاف بلسان حال الأب أو الأم، مش بجملة عامة.
- ممنوع العبارات الميتة: «من المهم أن»، «يجب علينا»، «في عالمنا اليوم»، «التربية فن».
- اخرج نصًا جاهزًا للنشر فقط.`;
  }

  private parseResolution(res?: string) {
    if (!res || !res.includes('x')) return { width: 1024, height: 1024 };
    const [w, h] = res.split('x').map(Number);
    return { width: w || 1024, height: h || 1024 };
  }

  private formatError(e: any, module: string) {
    const classified = classifyStudioError(e, module);
    return {
      module,
      provider: e?.provider,
      status: e?.status,
      code: classified.code,
      kind: classified.kind,
      retryAfterSeconds: classified.retryAfterSeconds,
      quotaModel: classified.quotaModel,
      quotaLimit: classified.quotaLimit,
      title: classified.title,
      message: classified.message,
      suggestedAction: classified.action,
      at: new Date().toISOString(),
    };
  }

  private suggest(e: any, module: string) {
    return classifyStudioError(e, module).action;
  }

  async discoverTrendingTopics(userId: string) {
    const cfg = this.normalizeConfig(await this.getConfig(userId));
    const day = this.cairoDateKey(cfg);
    const cached = this.trendingCache.get(`${userId}:${day}`);
    if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000 && cached.topics?.length) {
      return { date: day, cached: true, topics: cached.topics };
    }
    const secrets = await this.secrets.getSecrets(userId);
    const prompt = nicheGuard(`You research CURRENT parenting conversations for Egyptian expat families in the Gulf.

Return ONLY JSON:
{"topics":[{"title":"Arabic hook-question style topic 14-24 words","angle":"one short reason this is timely"}]}

Need 7 topics, each:
- relevant to ${COACHIANO_BRAND.audience}
- recent/current (language mix, screens, grandparents absence, ATM father, school pressure, compound bubble, final return to Egypt…)
- suitable as a Facebook/Instagram post seed
- NOT political, not news crime, not generic "importance of family"

Use search if available for recency. Arabic titles.`);
    const logs: any[] = [];
    try {
      const result = await this.providers.generateTextWithFallback(
        { provider: 'gemini', model: GEMINI_MODELS.trending },
        prompt,
        secrets,
        logs,
        {},
        {
          temperature: 0.7,
          maxTokens: 1200,
          minLength: 40,
          useGoogleSearch: true,
        },
      );
      const parsed = this.extractJson(result.text) as { topics?: Array<{ title?: string; angle?: string }> };
      const topics = (parsed?.topics || [])
        .map((t) => ({ title: String(t.title || '').trim(), angle: String(t.angle || '').trim() }))
        .filter((t) => t.title.length >= 12)
        .slice(0, 8);
      if (!topics.length) throw new Error('empty trending list');
      this.trendingCache.set(`${userId}:${day}`, { topics, at: Date.now() });
      return { date: day, cached: false, topics, model: result.model };
    } catch (e: any) {
      const fallback = COACHIANO_BRAND.focusTopics.map((title) => ({
        title: `هو إحنا ليه كمغتربين بنلمس موضوع: ${title}؟`,
        angle: 'niche fallback',
      }));
      return { date: day, cached: false, topics: fallback, error: e?.message };
    }
  }

  private async planResearchQueries(
    cfg: StudioPipelineConfig,
    secrets: any,
    logs: any[],
    topic: string,
  ): Promise<ResearchQuery[] | undefined> {
    try {
      const prompt = nicheGuard(`Generate web search queries to research THIS selected topic only.

Topic:
${topic}

Return ONLY JSON:
{"queries":[{"source":"google"|"facebook"|"instagram"|"news","query":"short search string"}]}

Rules:
- 3 or 4 queries max
- Must stay on the selected topic (parenting / Egyptian expats in Gulf)
- Mix Arabic and English if useful
- Never include politics, wars, or unrelated celebrity news
- Facebook/instagram queries may include site:facebook.com or site:instagram.com`);
      const result = await this.providers.generateTextWithFallback(
        { provider: 'gemini', model: GEMINI_MODELS.searchQueries },
        prompt,
        secrets,
        logs,
        {},
        { temperature: 0.3, maxTokens: 500, minLength: 20 },
      );
      const parsed = this.extractJson(result.text) as { queries?: ResearchQuery[] };
      const allowed = new Set(['google', 'facebook', 'instagram', 'news']);
      const queries = (parsed?.queries || []).filter(
        (q) => q?.query && allowed.has(String(q.source || 'google')),
      ) as ResearchQuery[];
      return queries.length ? queries.slice(0, 4) : undefined;
    } catch {
      return undefined;
    }
  }

  private async validateGeneratedPost(opts: {
    cfg: StudioPipelineConfig;
    secrets: any;
    logs: any[];
    topic: string;
    content: string;
    research: string;
  }): Promise<{ ok: boolean; message: string; issues: string[]; fixContent?: string }> {
    try {
      const prompt = nicheGuard(`Validate this social post before publishing.

Selected topic:
${opts.topic}

Research context (claims must not contradict this; invented stats are a fail):
${opts.research || '(none)'}

Post:
${opts.content}

Return ONLY JSON:
{"ok":true|false,"issues":["..."],"message":"short","fixContent":"full rewritten post if ok is false, else empty"}

Checks:
- related to selected topic
- follows س / ج / سؤال التفاعل
- Coachiano voice (Egyptian colloquial + psychology + faith, no lectures)
- no politics
- no hallucinated studies/numbers not in research
- appropriate for Facebook & Instagram`);
      const result = await this.providers.generateTextWithFallback(
        { provider: 'gemini', model: GEMINI_MODELS.validation },
        prompt,
        opts.secrets,
        opts.logs,
        {},
        { temperature: 0.2, maxTokens: 3500, minLength: 20 },
      );
      const parsed = this.extractJson(result.text) as {
        ok?: boolean;
        issues?: string[];
        message?: string;
        fixContent?: string;
      };
      const ok = parsed?.ok !== false && !(parsed?.issues || []).length;
      const fix = String(parsed?.fixContent || '').trim();
      return {
        ok,
        message: parsed?.message || (ok ? 'On-brief' : 'Needs a rewrite'),
        issues: parsed?.issues || [],
        fixContent: !ok && fix.length > 200 ? fix : undefined,
      };
    } catch (e: any) {
      return { ok: true, message: `Quality check skipped: ${e?.message || 'error'}`, issues: [] };
    }
  }

  private extractJson(text: string): any {
    const raw = String(text || '').trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1] : raw;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  async listHistory(userId: string, limit = 30) {
    return this.execRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 100),
    });
  }

  async getExecution(userId: string, id: string) {
    return this.execRepo.findOne({ where: { id, userId } });
  }

  /** Create RUNNING execution immediately, then continue pipeline in background for live UI progress. */
  async startAsyncPipeline(
    userId: string,
    opts: {
      trigger?: string;
      publish?: boolean | { facebook?: boolean; instagram?: boolean };
      configOverride?: StudioPipelineConfig;
    } = {},
  ) {
    const exec = this.execRepo.create({
      userId,
      status: 'RUNNING',
      trigger: opts.trigger || 'manual',
      logsJson: [{ level: 'info', message: 'Pipeline started', at: new Date().toISOString() }],
      errorsJson: [],
      providersJson: {},
      modelsJson: {},
      progressJson: this.buildProgress('starting', 2, 'Starting pipeline…', 'بيبدأ التشغيل…', [
        { id: 'start', status: 'active', label: 'Start', labelAr: 'البداية' },
        { id: 'topic', status: 'pending', label: 'Topic', labelAr: 'الموضوع' },
        { id: 'research', status: 'pending', label: 'Research', labelAr: 'البحث' },
        { id: 'content', status: 'pending', label: 'Content', labelAr: 'المحتوى' },
        { id: 'image', status: 'pending', label: 'Image', labelAr: 'الصورة' },
        { id: 'validate', status: 'pending', label: 'Quality', labelAr: 'المراجعة' },
      ]),
    });
    await this.execRepo.save(exec);

    void this.runPipeline(userId, {
      ...opts,
      resumeFrom: exec.id,
      trigger: opts.trigger || 'manual',
    }).catch(async (e) => {
      try {
        const row = await this.execRepo.findOne({ where: { id: exec.id, userId } });
        if (!row || row.status === 'COMPLETED' || row.status === 'FAILED') return;
        row.status = 'FAILED';
        row.errorsJson = [
          ...(row.errorsJson || []),
          { module: 'pipeline', message: e?.message || 'Background run failed' },
        ];
        await this.execRepo.save(row);
      } catch {
        /* ignore */
      }
    });

    return this.toDto(exec);
  }

  executionToDto(exec: AiContentStudioExecutionEntity) {
    return this.toDto(exec);
  }

  async runPipeline(
    userId: string,
    opts: {
      trigger?: string;
      publish?: boolean | { facebook?: boolean; instagram?: boolean };
      configOverride?: StudioPipelineConfig;
      resumeFrom?: string;
      onlyModule?: 'topic' | 'content' | 'image' | 'design' | 'facebook' | 'instagram';
    } = {},
  ) {
    const started = Date.now();
    const cfg = this.normalizeConfig({
      ...(await this.getConfig(userId)),
      ...(opts.configOverride || {}),
    });
    const secrets = await this.secrets.getSecrets(userId);
    const logs: any[] = [];
    let exec =
      opts.resumeFrom
        ? await this.execRepo.findOne({ where: { id: opts.resumeFrom, userId } })
        : null;

    if (!exec) {
      exec = this.execRepo.create({
        userId,
        status: 'RUNNING',
        trigger: opts.trigger || 'manual',
        logsJson: [],
        errorsJson: [],
        providersJson: {},
        modelsJson: {},
      });
      await this.execRepo.save(exec);
    } else {
      exec.status = 'RUNNING';
      logs.push(...(exec.logsJson || []));
    }

    const errors: any[] = opts.onlyModule
      ? [...(exec.errorsJson || [])].filter((e) => e?.module !== opts.onlyModule)
      : [];
    const providersUsed: Record<string, string> = { ...(exec.providersJson || {}) };
    const modelsUsed: Record<string, string> = { ...(exec.modelsJson || {}) };

    const baseSteps = () => [
      { id: 'start', status: 'done' as const, label: 'Start', labelAr: 'البداية' },
      { id: 'topic', status: 'pending' as const, label: 'Topic', labelAr: 'الموضوع' },
      {
        id: 'research',
        status: (cfg.research?.enabled ? 'pending' : 'skipped') as 'pending' | 'skipped',
        label: 'Research',
        labelAr: 'البحث',
      },
      { id: 'content', status: 'pending' as const, label: 'Content', labelAr: 'المحتوى' },
      { id: 'image', status: 'pending' as const, label: 'Image', labelAr: 'الصورة' },
      { id: 'validate', status: 'pending' as const, label: 'Quality', labelAr: 'المراجعة' },
    ];

    let progressSteps = (exec.progressJson?.steps as any[])?.length
      ? [...(exec.progressJson.steps as any[])]
      : baseSteps();

    const setProgress = async (
      phase: string,
      percent: number,
      message: string,
      messageAr: string,
      stepPatch?: { id: string; status: string; detail?: string; detailAr?: string },
    ) => {
      if (stepPatch) {
        progressSteps = progressSteps.map((s) =>
          s.id === stepPatch.id
            ? {
                ...s,
                status: stepPatch.status,
                detail: stepPatch.detail || s.detail,
                detailAr: stepPatch.detailAr || s.detailAr,
              }
            : s,
        );
      }
      exec.progressJson = {
        ...this.buildProgress(phase, percent, message, messageAr, progressSteps),
        validation: exec.progressJson?.validation,
      };
      exec.logsJson = logs;
      exec.providersJson = providersUsed;
      exec.modelsJson = modelsUsed;
      exec.durationMs = Date.now() - started;
      await this.execRepo.save(exec);
    };

    const setStatus = async (status: PipelineStatus) => {
      exec.status = status;
      exec.logsJson = logs;
      exec.errorsJson = errors;
      exec.providersJson = providersUsed;
      exec.modelsJson = modelsUsed;
      exec.durationMs = Date.now() - started;
      await this.execRepo.save(exec);
    };

    const shouldRun = (module: string) => {
      if (!opts.onlyModule) return true;
      return opts.onlyModule === module;
    };

    try {
      await setProgress('starting', 4, 'Pipeline started', 'بدأ التشغيل', {
        id: 'start',
        status: 'done',
      });

      // TOPIC first — composer text is the selected topic. Generate only if the box is empty.
      if (shouldRun('topic') && cfg.topic?.enabled !== false && (!exec.topic || opts.onlyModule === 'topic')) {
        const t0 = Date.now();
        const manualTopic = String(cfg.manualTopic || '').trim();
        try {
          await setProgress('topic', 10, 'Locking today’s topic…', 'بيثبّت موضوع اليوم…', {
            id: 'topic',
            status: 'active',
          });
          if (manualTopic && opts.onlyModule !== 'topic') {
            if (opts.trigger === 'schedule' && (await this.alreadyPostedToday(userId, manualTopic, cfg))) {
              exec.topic = manualTopic;
              logs.push({
                level: 'warn',
                module: 'topic',
                message: 'Skipped: same topic already posted today',
              });
              await setProgress('topic', 18, 'Duplicate topic skipped', 'نفس موضوع اليوم — اتكسّب', {
                id: 'topic',
                status: 'skipped',
              });
              await setStatus('COMPLETED');
              return this.toDto(exec);
            }
            exec.topic = manualTopic;
            providersUsed.topic = 'composer';
            modelsUsed.topic = 'selected';
            logs.push({
              level: 'info',
              module: 'topic',
              provider: 'composer',
              message: 'Using selected composer topic',
              responseTimeMs: Date.now() - t0,
            });
            await setProgress('topic', 18, 'Topic selected', 'الموضوع اتحدد', {
              id: 'topic',
              status: 'done',
              detail: manualTopic.slice(0, 80),
            });
            await setStatus('TOPIC_GENERATED');
          } else {
            const vars = this.buildVars(cfg);
            const topicPrompt = nicheGuard(
              this.composeTextPrompt(DEFAULT_TOPIC_PROMPT, cfg.topic?.prompt, cfg),
            );
            const result = await this.providers.generateTextWithFallback(
              { ...(cfg.topic as ModuleProviderConfig), model: cfg.topic?.model || GEMINI_MODELS.topic },
              topicPrompt,
              secrets,
              logs,
              vars,
              {
                system: this.buildWritingSystem(cfg),
                temperature: 0.85,
                maxTokens: 512,
                minLength: 24,
                useGoogleSearch: true,
              },
            );
            exec.topic = result.text;
            providersUsed.topic = result.usedProvider;
            modelsUsed.topic = result.model || GEMINI_MODELS.topic;
            logs.push({
              level: 'info',
              module: 'topic',
              provider: result.usedProvider,
              model: result.model,
              responseTimeMs: Date.now() - t0,
              usage: result.usage,
            });
            await setProgress('topic', 18, 'Topic ready', 'الموضوع جاهز', {
              id: 'topic',
              status: 'done',
              detail: String(result.text || '').slice(0, 80),
            });
            await setStatus('TOPIC_GENERATED');
          }
        } catch (e: any) {
          errors.push(this.formatError(e, 'topic'));
          await setProgress('topic', 18, 'Topic failed', 'فشل الموضوع', {
            id: 'topic',
            status: 'error',
          });
          await setStatus('FAILED');
          return this.toDto(exec);
        }
      }

      if (!exec.topic) {
        const fallbackManual = String(cfg.manualTopic || '').trim();
        if (fallbackManual) {
          exec.topic = fallbackManual;
          providersUsed.topic = providersUsed.topic || 'composer';
          modelsUsed.topic = modelsUsed.topic || 'selected';
        }
      }

      // RESEARCH — Gemini queries for THIS topic, then scrape, then keep related hits only
      let researchContext = '';
      const shouldResearch =
        cfg.research?.enabled &&
        exec.topic &&
        (shouldRun('topic') || shouldRun('content') || !opts.onlyModule);
      if (shouldResearch && (!exec.researchJson?.ran || opts.onlyModule === 'topic')) {
        const rt0 = Date.now();
        try {
          await setProgress('research', 22, 'Planning search queries…', 'بيحضّر كلمات البحث…', {
            id: 'research',
            status: 'active',
          });
          const planned = await this.planResearchQueries(cfg, secrets, logs, String(exec.topic));
          const researchResult = await this.research.research(
            cfg.research?.brief || '',
            cfg.research?.sources as ResearchSourceId[] | undefined,
            {
              topic: String(exec.topic),
              audience: cfg.audience,
              brandName: cfg.brandName,
              maxResults: cfg.research?.maxResults || 8,
              queries: planned,
              onProgress: async (ev) => {
                const pct =
                  ev.phase === 'research_done'
                    ? 36
                    : 22 + Math.round(((ev.index || 1) / Math.max(ev.total || 1, 1)) * 12);
                logs.push({
                  level: 'info',
                  module: 'research',
                  message: ev.message,
                  messageAr: ev.messageAr,
                  source: ev.source,
                  at: new Date().toISOString(),
                });
                await setProgress('research', pct, ev.message, ev.messageAr, {
                  id: 'research',
                  status: 'active',
                  detail: ev.message,
                  detailAr: ev.messageAr,
                });
              },
            },
          );
          exec.researchJson = researchResult as any;
          providersUsed.research = researchResult.engine;
          researchContext = this.research.formatHitsForPrompt(researchResult.hits);
          logs.push({
            level: 'info',
            module: 'research',
            provider: researchResult.engine,
            message: researchResult.message,
            sources: researchResult.plan?.sources,
            queries: researchResult.plan?.queries,
            hitCount: researchResult.hits?.length || 0,
            bySource: researchResult.bySource,
            methodNote: researchResult.methodNote,
            responseTimeMs: Date.now() - rt0,
          });
          await setProgress(
            'research',
            38,
            researchResult.message,
            `البحث خلص (${researchResult.hits?.length || 0} نتيجة)`,
            { id: 'research', status: 'done', detail: researchResult.message },
          );
        } catch (e: any) {
          exec.researchJson = {
            enabled: true,
            ran: false,
            engine: 'none',
            hits: [],
            message: e?.message || 'Research failed',
          };
          logs.push({
            level: 'warn',
            module: 'research',
            message: e?.message || 'Research failed — continuing with selected topic',
            responseTimeMs: Date.now() - rt0,
          });
          await setProgress(
            'research',
            38,
            'Research failed — continuing',
            'البحث فشل — هنكمّل',
            { id: 'research', status: 'error', detail: e?.message },
          );
        }
      } else if (!cfg.research?.enabled) {
        exec.researchJson = {
          enabled: false,
          ran: false,
          engine: 'none',
          hits: [],
          message: 'Research/scraping is OFF',
          methodNote: 'Enable research to search the web with Gemini-planned queries.',
        };
        await setProgress('research', 20, 'Research skipped', 'البحث متوقف', {
          id: 'research',
          status: 'skipped',
        });
      } else if (exec.researchJson?.hits?.length) {
        researchContext = this.research.formatHitsForPrompt(exec.researchJson.hits);
      }

      // leftover topic seed kept for resume paths
      if (!exec.topic) {
        const fallbackManual = String(cfg.manualTopic || '').trim();
        if (fallbackManual) {
          exec.topic = fallbackManual;
          providersUsed.topic = providersUsed.topic || 'manual';
          modelsUsed.topic = modelsUsed.topic || 'sticky-note';
        }
      }

      // CONTENT
      if (
        shouldRun('content') &&
        cfg.content?.enabled !== false &&
        exec.topic &&
        (!exec.content || opts.onlyModule === 'content')
      ) {
        const t0 = Date.now();
        try {
          await setProgress('content', 48, 'Writing post content…', 'بيكتب محتوى المنشور…', {
            id: 'content',
            status: 'active',
          });
          const vars = this.buildVars(cfg, {
            topic: exec.topic,
            research: researchContext || 'لا توجد نتائج بحث إضافية — اكتب من خبرة الكوتشيانو فقط دون إحصاءات مختلقة.',
          });
          const result = await this.providers.generateTextWithFallback(
            { ...(cfg.content as ModuleProviderConfig), model: cfg.content?.model || GEMINI_MODELS.content },
            this.composeTextPrompt(DEFAULT_CONTENT_PROMPT, cfg.content?.prompt, cfg),
            secrets,
            logs,
            vars,
            {
              system: this.buildWritingSystem(cfg),
              temperature: 0.78,
              maxTokens: 4096,
              minLength: 400,
            },
          );
          exec.content = result.text;
          exec.headline = result.text.split('\n').find((l) => l.trim())?.slice(0, 90) || exec.topic;
          providersUsed.content = result.usedProvider;
          modelsUsed.content = result.model || cfg.content?.model || '';
          logs.push({
            level: 'info',
            module: 'content',
            provider: result.usedProvider,
            model: result.model,
            responseTimeMs: Date.now() - t0,
            usage: result.usage,
          });
          await setProgress('content', 58, 'Content ready', 'المحتوى جاهز', {
            id: 'content',
            status: 'done',
          });
          await setStatus('CONTENT_GENERATED');
        } catch (e: any) {
          errors.push(this.formatError(e, 'content'));
          await setProgress('content', 58, 'Content failed', 'فشل المحتوى', {
            id: 'content',
            status: 'error',
          });
          await setStatus('FAILED');
          return this.toDto(exec);
        }
      }

      // IMAGE — visual is built from generated content (+ topic); image.prompt = optional extras
      if (
        shouldRun('image') &&
        cfg.image?.enabled !== false &&
        exec.topic &&
        (!exec.imageUrl || opts.onlyModule === 'image')
      ) {
        const t0 = Date.now();
        try {
          await setProgress('image', 66, 'Generating image from content…', 'بيولّد الصورة من المحتوى…', {
            id: 'image',
            status: 'active',
          });
          const vars = this.buildVars(cfg, {
            topic: exec.topic || '',
            content: exec.content || '',
            headline: exec.headline || '',
          });
          const size = this.parseResolution(cfg.image?.resolution);
          const imagePrompt = this.buildImagePrompt(cfg, vars);
          const result = await this.providers.generateImageWithFallback(
            cfg.image as ModuleProviderConfig,
            imagePrompt,
            secrets,
            logs,
            {
              vars,
              aspectRatio: cfg.image?.aspectRatio,
              width: size.width,
              height: size.height,
              negativePrompt: cfg.image?.negativePrompt,
            },
          );
          exec.imageUrl = result.imageUrl;
          providersUsed.image = result.usedProvider;
          modelsUsed.image = result.model || cfg.image?.model || '';
          const persisted = await this.media.persistDataUrl(result.imageUrl, userId);
          if (persisted.publicUrl) exec.publicImageUrl = persisted.publicUrl;
          logs.push({
            level: 'info',
            module: 'image',
            provider: result.usedProvider,
            model: result.model,
            responseTimeMs: Date.now() - t0,
            message: exec.content
              ? 'Image prompt built from content + topic'
              : 'Image prompt built from topic (no content yet)',
          });
          await setProgress('image', 78, 'Image ready', 'الصورة جاهزة', {
            id: 'image',
            status: 'done',
          });
          await setStatus('IMAGE_GENERATED');
        } catch (e: any) {
          errors.push(this.formatError(e, 'image'));
          await setProgress('image', 78, 'Image failed', 'فشل توليد الصورة', {
            id: 'image',
            status: 'error',
          });
          await setStatus('FAILED');
          return this.toDto(exec);
        }
      }

      // Image already contains brand calligraphy — skip Design overlay unless explicitly retried.
      if (opts.onlyModule === 'design' && cfg.design?.enabled && exec.imageUrl) {
        try {
          const overlay = this.design.apply(exec.imageUrl, {
            ...cfg.design,
            topic: exec.topic || '',
            content: exec.content || '',
            headline: cfg.design?.headline || exec.headline || exec.topic || '',
          });
          exec.finalImageUrl = overlay.imageUrl;
          exec.headline = overlay.headline;
          const persisted = await this.media.persistDataUrl(overlay.imageUrl, userId);
          if (persisted.publicUrl) exec.publicImageUrl = persisted.publicUrl;
        } catch {
          exec.finalImageUrl = exec.imageUrl;
        }
      } else if (!exec.finalImageUrl) {
        exec.finalImageUrl = exec.imageUrl;
      }

      if (
        !opts.onlyModule &&
        exec.content &&
        exec.topic &&
        (exec.imageUrl || exec.finalImageUrl)
      ) {
        await setProgress('validate', 88, 'Validating post quality…', 'بيراجع جودة المنشور…', {
          id: 'validate',
          status: 'active',
        });
        const verdict = await this.validateGeneratedPost({
          cfg,
          secrets,
          logs,
          topic: String(exec.topic),
          content: String(exec.content),
          research: researchContext,
        });
        if (verdict.ok === false && verdict.fixContent) {
          exec.content = verdict.fixContent;
          exec.headline = exec.content.split('\n').find((l) => l.trim())?.slice(0, 90) || exec.topic;
          logs.push({ level: 'info', module: 'validate', message: 'Content auto-fixed after quality check' });
        }
        logs.push({
          level: verdict.ok ? 'info' : 'warn',
          module: 'validate',
          message: verdict.message,
          issues: verdict.issues,
        });
        exec.progressJson = {
          ...(exec.progressJson || {}),
          validation: { ok: verdict.ok, message: verdict.message, issues: verdict.issues },
        };
        await setProgress(
          'validate',
          94,
          verdict.ok ? 'Quality check passed' : 'Quality issues were auto-fixed',
          verdict.ok ? 'المراجعة عدّت' : 'اتصلحت مشاكل الجودة',
          { id: 'validate', status: 'done', detail: verdict.message },
        );
      } else {
        await setProgress('validate', 90, 'Quality skipped', 'المراجعة متوقفة', {
          id: 'validate',
          status: 'skipped',
        });
      }

      const publishFlag =
        typeof opts.publish === 'boolean'
          ? { facebook: opts.publish, instagram: opts.publish }
          : opts.publish || { facebook: false, instagram: false };

      const auto = cfg.autoPublish === true;
      const explicitFb = Boolean(publishFlag.facebook);
      const explicitIg = Boolean(publishFlag.instagram);
      // Node "enabled" only gates auto-publish. An explicit Publish click always runs.
      const doFb = shouldRun('facebook') && (explicitFb || (auto && Boolean(cfg.facebook?.enabled)));
      const doIg = shouldRun('instagram') && (explicitIg || (auto && Boolean(cfg.instagram?.enabled)));

      if (doFb) {
        if (!exec.content) {
          exec.facebookStatus = 'failed';
          errors.push({
            module: 'facebook',
            message: 'No caption to publish. Run the content step first, then click Publish Facebook.',
          });
        } else {
        try {
          const image = exec.finalImageUrl || exec.imageUrl;
          const published = await this.publishFacebook({
            cfg,
            secrets,
            caption: exec.content,
            imageUrl: image || exec.publicImageUrl,
          });
          const actuallyPosted =
            published.mode === 'api' || Boolean((published as any).posted) || Boolean(published.postId);
          if (!actuallyPosted) {
            throw Object.assign(
              new Error(
                (published as any).message ||
                  'Facebook did not post. Look for the Chrome window, log in if needed, then click Publish again.',
              ),
              { status: 409, module: 'facebook' },
            );
          }
          exec.facebookStatus = 'published';
          exec.facebookPostId = published.postId;
          logs.push({
            level: 'info',
            module: 'facebook',
            postId: published.postId,
            mode: published.mode || cfg.facebook?.publishMode || 'browser',
          });
          await setStatus('FACEBOOK_PUBLISHED');
        } catch (e: any) {
          exec.facebookStatus = 'failed';
          errors.push(this.formatError(e, 'facebook'));
        }
        }
      }

      if (doIg) {
        if (!exec.content) {
          exec.instagramStatus = 'failed';
          errors.push({
            module: 'instagram',
            message: 'No caption to publish. Run the content step first, then click Publish Instagram.',
          });
        } else {
        try {
          const image = exec.finalImageUrl || exec.imageUrl;
          const published = await this.publishInstagram({
            cfg,
            secrets,
            caption: exec.content,
            imageUrl: image || exec.publicImageUrl,
          });
          const actuallyPosted =
            published.mode === 'api' || Boolean((published as any).posted) || Boolean(published.mediaId);
          if (!actuallyPosted) {
            throw Object.assign(
              new Error(
                (published as any).message ||
                  'Instagram did not post. Look for the Chrome window, log in if needed, then click Publish again.',
              ),
              { status: 409, module: 'instagram' },
            );
          }
          exec.instagramStatus = 'published';
          exec.instagramMediaId = published.mediaId || ('postId' in published ? published.postId : undefined);
          logs.push({
            level: 'info',
            module: 'instagram',
            mediaId: exec.instagramMediaId,
            mode: published.mode || cfg.instagram?.publishMode || 'browser',
          });
          await setStatus('INSTAGRAM_PUBLISHED');
        } catch (e: any) {
          exec.instagramStatus = 'failed';
          errors.push(this.formatError(e, 'instagram'));
        }
        }
      }

      const failedHard = errors.some((e) =>
        ['topic', 'content', 'image'].includes(e.module) ||
        (opts.trigger === 'publish' && ['facebook', 'instagram'].includes(e.module)),
      );
      if (failedHard) {
        await setProgress('failed', 100, 'Pipeline failed', 'التشغيل فشل');
      } else {
        await setProgress('completed', 100, 'Pipeline completed', 'التشغيل خلص بنجاح');
      }
      await setStatus(failedHard ? 'FAILED' : 'COMPLETED');
      return this.toDto(exec);
    } catch (e: any) {
      errors.push(this.formatError(e, 'pipeline'));
      exec.errorsJson = errors;
      exec.logsJson = logs;
      exec.status = 'FAILED';
      exec.progressJson = this.buildProgress('failed', 100, e?.message || 'Pipeline failed', 'فشل غير متوقع', progressSteps);
      exec.durationMs = Date.now() - started;
      await this.execRepo.save(exec);
      return this.toDto(exec);
    }
  }

  async testModule(
    userId: string,
    module: 'topic' | 'content' | 'image' | 'facebook' | 'instagram' | 'comfyui' | 'research',
    body: any = {},
  ) {
    const t0 = Date.now();
    const cfg = await this.getConfig(userId);
    const secrets = await this.secrets.getSecrets(userId);
    const logs: any[] = [];

    try {
      if (module === 'research') {
        const researchResult = await this.research.research(
          body.brief ?? cfg.research?.brief ?? '',
          (body.sources || cfg.research?.sources) as ResearchSourceId[] | undefined,
          {
            audience: cfg.audience,
            brandName: cfg.brandName,
            maxResults: body.maxResults || cfg.research?.maxResults || 8,
          },
        );
        return {
          ok: true,
          module,
          provider: researchResult.engine,
          responseTimeMs: Date.now() - t0,
          result: researchResult,
          logs: [
            {
              level: 'info',
              module: 'research',
              message: researchResult.message,
              methodNote: researchResult.methodNote,
            },
          ],
        };
      }

      if (module === 'topic') {
        let topicPrompt = this.composeTextPrompt(
          DEFAULT_TOPIC_PROMPT,
          body.prompt ?? cfg.topic?.prompt,
          cfg,
        );
        let researchMeta: any = null;
        if (body.useResearch !== false && (cfg.research?.enabled || body.brief)) {
          const researchResult = await this.research.research(
            body.brief ?? cfg.research?.brief ?? '',
            (body.sources || cfg.research?.sources) as ResearchSourceId[] | undefined,
            {
              audience: cfg.audience,
              brandName: cfg.brandName,
              maxResults: cfg.research?.maxResults || 8,
            },
          );
          researchMeta = researchResult;
          const ctx = this.research.formatHitsForPrompt(researchResult.hits);
          if (ctx) {
            topicPrompt = `${topicPrompt}

---
إشارات من بحث الويب العام:
${ctx}`;
          }
          logs.push({
            level: 'info',
            module: 'research',
            message: researchResult.message,
            hitCount: researchResult.hits?.length || 0,
          });
        }
        const result = await this.providers.generateTextWithFallback(
          {
            provider: body.provider || cfg.topic?.provider || 'gemini',
            model: body.model || cfg.topic?.model,
            fallbackProviders: body.fallbackProviders || cfg.topic?.fallbackProviders,
            custom: body.custom || cfg.topic?.custom,
          },
          topicPrompt,
          secrets,
          logs,
          this.buildVars(cfg),
          {
            system: this.buildWritingSystem(cfg),
            temperature: 0.85,
            maxTokens: 512,
            minLength: 24,
          },
        );
        return {
          ok: true,
          module,
          provider: result.usedProvider,
          model: result.model,
          responseTimeMs: Date.now() - t0,
          usage: result.usage,
          result: result.text,
          research: researchMeta,
          logs,
        };
      }

      if (module === 'content') {
        const topic = body.topic || 'تحدي وقت الشاشات لدى الأطفال المغتربين';
        const result = await this.providers.generateTextWithFallback(
          {
            provider: body.provider || cfg.content?.provider || 'gemini',
            model: body.model || cfg.content?.model,
            fallbackProviders: body.fallbackProviders || cfg.content?.fallbackProviders,
            custom: body.custom || cfg.content?.custom,
          },
          this.composeTextPrompt(DEFAULT_CONTENT_PROMPT, body.prompt ?? cfg.content?.prompt, cfg),
          secrets,
          logs,
          this.buildVars(cfg, { topic }),
          {
            system: this.buildWritingSystem(cfg),
            temperature: 0.78,
            maxTokens: 4096,
            minLength: 400,
          },
        );
        return {
          ok: true,
          module,
          provider: result.usedProvider,
          model: result.model,
          responseTimeMs: Date.now() - t0,
          usage: result.usage,
          result: result.text,
          logs,
        };
      }

      if (module === 'image' || module === 'comfyui') {
        const topic = body.topic || 'دفء الأسرة المصرية المغتربة';
        const content =
          body.content ||
          'منشور تربوي دافئ عن حياة الأسرة المصرية المغتربة في الخليج، بلحظة يومية واقعية بين الأم والطفل.';
        const size = this.parseResolution(body.resolution || cfg.image?.resolution);
        const vars = this.buildVars(cfg, { topic, content });
        const imagePrompt = this.buildImagePrompt(cfg, vars, body.prompt);
        const result = await this.providers.generateImageWithFallback(
          {
            provider:
              body.provider ||
              (module === 'comfyui' ? 'comfyui' : cfg.image?.provider) ||
              'huggingface',
            model: body.model || cfg.image?.model,
            fallbackProviders: body.fallbackProviders || [],
            custom: {
              ...(body.custom || cfg.image?.custom || {}),
              workflowJson: body.workflowJson || cfg.image?.custom?.workflowJson,
            },
          },
          imagePrompt,
          secrets,
          logs,
          {
            vars,
            aspectRatio: body.aspectRatio || cfg.image?.aspectRatio,
            width: size.width,
            height: size.height,
            negativePrompt: body.negativePrompt || cfg.image?.negativePrompt,
          },
        );
        return {
          ok: true,
          module,
          provider: result.usedProvider,
          model: result.model,
          responseTimeMs: Date.now() - t0,
          result: result.imageUrl,
          logs,
        };
      }

      if (module === 'facebook') {
        const mode = cfg.facebook?.publishMode || 'browser';
        if (mode !== 'api') {
          const result = await this.fbBrowser.prepareComposer({
            caption: body.caption || body.content || '',
            imageUrl: body.imageUrl || null,
            autoPost: false,
          });
          return { ...result, module, responseTimeMs: Date.now() - t0 };
        }
        const pageId = body.pageId || cfg.facebook?.pageId || secrets.facebook?.pageId;
        const token = secrets.facebook?.accessToken;
        const result = await this.meta.testFacebook(pageId!, token!);
        return { ...result, module, responseTimeMs: Date.now() - t0 };
      }

      if (module === 'instagram') {
        const mode = cfg.instagram?.publishMode || 'browser';
        if (mode !== 'api') {
          const result = await this.igBrowser.prepareComposer({
            caption: body.caption || body.content || '',
            imageUrl: body.imageUrl || null,
            autoPost: false,
          });
          return { ...result, module, responseTimeMs: Date.now() - t0 };
        }
        const igUserId = body.igUserId || cfg.instagram?.igUserId || secrets.instagram?.igUserId;
        const token = secrets.instagram?.accessToken;
        const result = await this.meta.testInstagram(igUserId!, token!);
        return { ...result, module, responseTimeMs: Date.now() - t0 };
      }

      return { ok: false, message: `Unknown module: ${module}` };
    } catch (e: any) {
      const classified = classifyStudioError(e, module);
      return {
        ok: false,
        module,
        provider: e?.provider,
        status: e?.status,
        code: classified.code,
        kind: classified.kind,
        retryAfterSeconds: classified.retryAfterSeconds,
        title: classified.title,
        message: classified.message,
        suggestedAction: classified.action,
        at: new Date().toISOString(),
        responseTimeMs: Date.now() - t0,
        logs,
      };
    }
  }

  async testFacebookPublish(userId: string, message?: string) {
    try {
      const cfg = await this.getConfig(userId);
      const secrets = await this.secrets.getSecrets(userId);
      const published = await this.publishFacebook({
        cfg,
        secrets,
        caption: message || 'So7baFit AI Content Studio — test post',
        imageUrl: null,
      });
      return { ok: true, module: 'facebook', ...published };
    } catch (e: any) {
      const classified = classifyStudioError(e, 'facebook');
      return {
        ok: false,
        module: 'facebook',
        status: e?.status || 400,
        code: classified.code,
        kind: classified.kind,
        retryAfterSeconds: classified.retryAfterSeconds,
        title: classified.title,
        message: classified.message,
        suggestedAction: classified.action,
        loggedIn: e?.loggedIn,
        posted: e?.posted,
        at: new Date().toISOString(),
      };
    }
  }

  private facebookApiReady(cfg: StudioPipelineConfig, secrets: any) {
    const fbSecrets = secrets?.facebook || {};
    const pageId = String(cfg.facebook?.pageId || fbSecrets.pageId || '').trim();
    const token = String(fbSecrets.accessToken || '').trim();
    return { pageId, token, ready: Boolean(pageId && token) };
  }

  private instagramApiReady(cfg: StudioPipelineConfig, secrets: any) {
    const igSecrets = secrets?.instagram || {};
    const igUserId = String(cfg.instagram?.igUserId || igSecrets.igUserId || '').trim();
    const token = String(igSecrets.accessToken || '').trim();
    return { igUserId, token, ready: Boolean(igUserId && token) };
  }

  private async publishFacebook(opts: {
    cfg: StudioPipelineConfig;
    secrets: any;
    caption: string;
    imageUrl?: string | null;
  }) {
    const wantsApi = opts.cfg.facebook?.publishMode === 'api';
    const api = this.facebookApiReady(opts.cfg, opts.secrets);
    if (wantsApi && api.ready) {
      const published = await this.meta.publishFacebookPhoto({
        pageId: api.pageId,
        accessToken: api.token,
        imageUrl: opts.imageUrl || undefined,
        caption: opts.caption,
      });
      return { ...published, mode: 'api' as const };
    }
    if (wantsApi && !api.ready) {
      throw Object.assign(
        new Error(
          'Facebook API is not configured. Add Page ID and Access Token, or switch How to post → Browser (recommended).',
        ),
        { status: 400, code: 'NOT_CONFIGURED', module: 'facebook' },
      );
    }
    return this.fbBrowser.publish({ caption: opts.caption, imageUrl: opts.imageUrl });
  }

  private async publishInstagram(opts: {
    cfg: StudioPipelineConfig;
    secrets: any;
    caption: string;
    imageUrl?: string | null;
  }) {
    const wantsApi = opts.cfg.instagram?.publishMode === 'api';
    const api = this.instagramApiReady(opts.cfg, opts.secrets);
    if (wantsApi && api.ready) {
      if (!opts.imageUrl || !/^https:\/\//i.test(String(opts.imageUrl))) {
        throw Object.assign(
          new Error('Instagram API requires a public HTTPS image URL. Set AI_CONTENT_STUDIO_PUBLIC_BASE_URL.'),
          { status: 400, code: 'PUBLIC_URL_REQUIRED', module: 'instagram' },
        );
      }
      const published = await this.meta.publishInstagram({
        igUserId: api.igUserId,
        accessToken: api.token,
        imageUrl: opts.imageUrl,
        caption: opts.caption,
      });
      return { ...published, mode: 'api' as const };
    }
    if (wantsApi && !api.ready) {
      throw Object.assign(
        new Error(
          'Instagram API is not configured. Add Instagram account ID and Access Token, or switch How to post → Browser (recommended).',
        ),
        { status: 400, code: 'NOT_CONFIGURED', module: 'instagram' },
      );
    }
    return this.igBrowser.publish({ caption: opts.caption, imageUrl: opts.imageUrl });
  }

  private cairoDateKey(cfg: StudioPipelineConfig, date = new Date()) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: cfg.schedule?.timezone || 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
    } catch {
      return date.toISOString().slice(0, 10);
    }
  }

  private async alreadyPostedToday(userId: string, topic: string, cfg: StudioPipelineConfig) {
    const today = this.cairoDateKey(cfg);
    const recent = await this.execRepo.find({
      where: { userId, status: 'COMPLETED' as any },
      order: { createdAt: 'DESC' },
      take: 12,
    });
    return recent.some(
      (row) =>
        String(row.topic || '').trim() === topic &&
        this.cairoDateKey(cfg, row.createdAt) === today &&
        (row.facebookStatus === 'published' || row.instagramStatus === 'published'),
    );
  }

  private toDto(exec: AiContentStudioExecutionEntity) {
    return {
      executionId: exec.id,
      status: exec.status,
      topic: exec.topic,
      content: exec.content,
      headline: exec.headline,
      imageUrl: exec.imageUrl,
      finalImageUrl: exec.finalImageUrl,
      publicImageUrl: exec.publicImageUrl,
      providers: exec.providersJson,
      models: exec.modelsJson,
      research: exec.researchJson,
      progress: exec.progressJson,
      facebookStatus: exec.facebookStatus,
      instagramStatus: exec.instagramStatus,
      facebookPostId: exec.facebookPostId,
      instagramMediaId: exec.instagramMediaId,
      errors: exec.errorsJson,
      logs: exec.logsJson,
      durationMs: exec.durationMs,
      trigger: exec.trigger,
      createdAt: exec.createdAt,
      updatedAt: exec.updatedAt,
    };
  }

  private buildProgress(
    phase: string,
    percent: number,
    message: string,
    messageAr: string,
    steps: any[] = [],
  ) {
    return {
      phase,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      message,
      messageAr,
      steps,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Used by scheduler — find users due now. */
  async findDueConfigs(now = new Date()) {
    const rows = await this.configRepo.find({ where: { automationEnabled: true } });
    const due: AiContentStudioConfigEntity[] = [];
    for (const row of rows) {
      const cfg = { ...this.defaults(), ...(row.configJson || {}) } as StudioPipelineConfig;
      if (!cfg.schedule?.enabled) continue;
      if (this.isDue(cfg.schedule, now)) due.push(row);
    }
    return due;
  }

  isDue(
    schedule: NonNullable<StudioPipelineConfig['schedule']>,
    now: Date,
  ) {
    const tz = schedule.timezone || 'Africa/Cairo';
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const weekdayMap: Record<string, string> = {
      Sat: 'sat',
      Sun: 'sun',
      Mon: 'mon',
      Tue: 'tue',
      Wed: 'wed',
      Thu: 'thu',
      Fri: 'fri',
    };
    const day = weekdayMap[get('weekday')] || get('weekday').toLowerCase().slice(0, 3);
    const hhmm = `${get('hour')}:${get('minute')}`;
    const target = schedule.time || '21:00';
    const days = schedule.days || ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
    return days.map((d) => d.toLowerCase()).includes(day) && hhmm === target;
  }
}
