import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export type ResearchSourceId = 'google' | 'facebook' | 'instagram' | 'news';

export type ResearchHit = {
  source: ResearchSourceId;
  title: string;
  snippet: string;
  url: string;
  engine: 'duckduckgo';
  author?: string;
  imageUrl?: string;
  platform?: 'facebook' | 'instagram' | 'google' | 'news' | 'web';
  handle?: string;
};

export type ResearchQuery = {
  source: ResearchSourceId;
  query: string;
};

export type ResearchPlan = {
  sources: ResearchSourceId[];
  queries: ResearchQuery[];
  intentSummary: string;
  brief: string;
};

export type ResearchResult = {
  enabled: boolean;
  ran: boolean;
  engine: 'duckduckgo' | 'none';
  plan: ResearchPlan | null;
  hits: ResearchHit[];
  bySource: Record<string, number>;
  message: string;
  /** Honest note for UI: FB/IG are public web search with site filters, not login scrapes */
  methodNote: string;
};

const ALL_SOURCES: ResearchSourceId[] = ['google', 'facebook', 'instagram', 'news'];

const SOURCE_SITE: Record<ResearchSourceId, string | null> = {
  google: null,
  facebook: 'site:facebook.com OR site:fb.com',
  instagram: 'site:instagram.com',
  news: 'تربية OR parenting OR family (أخبار OR news OR ترند OR trend)',
};

@Injectable()
export class TopicResearchService {
  private readonly logger = new Logger(TopicResearchService.name);

  /**
   * Parse natural-language brief + selected sources into concrete search queries.
   * Understands Arabic/English cues like "دور على فيسبوك"، "search Instagram for…"
   */
  parseBrief(
    brief: string,
    selectedSources: ResearchSourceId[] | undefined,
    opts: { audience?: string; brandName?: string } = {},
  ): ResearchPlan {
    const text = String(brief || '').trim();
    const mentioned = this.detectSourcesFromText(text);
    const selected = (
      selectedSources?.length ? selectedSources : (['google'] as ResearchSourceId[])
    ).filter((s) => ALL_SOURCES.includes(s)) as ResearchSourceId[];

    // Prefer sources named in the brief; otherwise use UI selection
    const finalSources = (mentioned.length ? mentioned : selected).length
      ? Array.from(new Set(mentioned.length ? mentioned : selected))
      : (['google'] as ResearchSourceId[]);

    const topicSeed = this.extractTopicSeed(text) || this.defaultSeed(opts.audience);
    const queries: ResearchQuery[] = [];

    for (const source of finalSources) {
      const site = SOURCE_SITE[source];
      if (source === 'google') {
        queries.push({
          source,
          query: `${topicSeed} تربية أسر مصرية مغتربة الخليج`,
        });
        queries.push({
          source,
          query: `${topicSeed} Egyptian expat parents Gulf parenting`,
        });
      } else if (source === 'facebook') {
        queries.push({
          source,
          query: `${topicSeed} ${site} تربية أطفال مصريين مغتربين`,
        });
      } else if (source === 'instagram') {
        queries.push({
          source,
          query: `${topicSeed} ${site} تربية أطفال مصريين مغتربين`,
        });
      } else {
        queries.push({
          source,
          query: `${topicSeed} ${site}`,
        });
      }
    }

    // Cap queries to keep latency reasonable
    const capped = queries.slice(0, 6);
    const intentSummary = text
      ? `بحث حسب طلب المستخدم: ${text.slice(0, 180)}`
      : `بحث ترندات حول: ${topicSeed}`;

    return {
      sources: finalSources,
      queries: capped,
      intentSummary,
      brief: text,
    };
  }

  async research(
    brief: string,
    selectedSources: ResearchSourceId[] | undefined,
    opts: {
      audience?: string;
      brandName?: string;
      maxResults?: number;
      topic?: string;
      queries?: ResearchQuery[];
      onProgress?: (event: {
        phase: string;
        source?: ResearchSourceId;
        query?: string;
        index?: number;
        total?: number;
        hitCount?: number;
        message: string;
        messageAr: string;
      }) => void | Promise<void>;
    } = {},
  ): Promise<ResearchResult> {
    const maxResults = Math.min(Math.max(opts.maxResults || 10, 3), 18);
    const topic = String(opts.topic || '').trim();
    const seedBrief = topic
      ? `${topic}\n${brief || ''}`.trim()
      : brief;
    const plan = this.parseBrief(seedBrief, selectedSources, opts);
    if (opts.queries?.length) {
      plan.queries = opts.queries.slice(0, 6);
      plan.intentSummary = topic
        ? `بحث مربوط بالموضوع: ${topic.slice(0, 140)}`
        : plan.intentSummary;
    }
    plan.queries = plan.queries.slice(0, 4);
    const hits: ResearchHit[] = [];
    const onProgress = opts.onProgress;

    await onProgress?.({
      phase: 'research_plan',
      total: plan.queries.length,
      message: `Planning searches across: ${plan.sources.join(', ')}`,
      messageAr: `بيحضّر البحث في: ${plan.sources.join('، ')}`,
    });

    for (let i = 0; i < plan.queries.length; i++) {
      const q = plan.queries[i];
      await onProgress?.({
        phase: 'research_search',
        source: q.source,
        query: q.query,
        index: i + 1,
        total: plan.queries.length,
        hitCount: hits.length,
        message: `Searching ${q.source} (${i + 1}/${plan.queries.length})…`,
        messageAr: `بيدور على ${q.source} (${i + 1}/${plan.queries.length})…`,
      });
      const found = await this.duckDuckGoSearch(q.query, q.source, 4);
      hits.push(...found);
      await onProgress?.({
        phase: 'research_source_done',
        source: q.source,
        query: q.query,
        index: i + 1,
        total: plan.queries.length,
        hitCount: this.dedupeHits(hits).length,
        message: `Finished ${q.source} — ${found.length} hits`,
        messageAr: `خلص ${q.source} — ${found.length} نتيجة`,
      });
      if (hits.length >= maxResults * 2) break;
    }

    const deduped = await this.enrichHits(
      this.filterHitsToTopic(this.dedupeHits(hits), topic || seedBrief).slice(0, maxResults),
    );
    const bySource: Record<string, number> = {};
    for (const h of deduped) {
      bySource[h.source] = (bySource[h.source] || 0) + 1;
    }

    const ran = true;
    const message = deduped.length
      ? `Fetched ${deduped.length} public results from: ${Object.keys(bySource).join(', ')}`
      : 'No public search hits returned (engine empty or blocked). Topic will use AI only.';

    await onProgress?.({
      phase: 'research_done',
      hitCount: deduped.length,
      message,
      messageAr: deduped.length
        ? `البحث خلص — ${deduped.length} نتيجة من ${Object.keys(bySource).join('، ')}`
        : 'مفيش نتائج من البحث — هنكمّل بالموضوع من الـ AI',
    });

    return {
      enabled: true,
      ran,
      engine: 'duckduckgo',
      plan,
      hits: deduped,
      bySource,
      message,
      methodNote:
        'Facebook/Instagram cards come from public web search + Open Graph previews (not a logged-in Meta scrape). Google/News use the same public search engine.',
    };
  }

  formatHitsForPrompt(hits: ResearchHit[]): string {
    if (!hits?.length) return '';
    return hits
      .map((h, i) => {
        const who = h.author ? ` — ${h.author}` : '';
        return `${i + 1}. [${h.source}] ${h.title}${who}\n   ${h.snippet}\n   ${h.url}`;
      })
      .join('\n');
  }

  /** Drop hits that don't share meaningful tokens with the selected topic. */
  filterHitsToTopic(hits: ResearchHit[], topic: string): ResearchHit[] {
    const tokens = this.topicTokens(topic);
    if (!tokens.length || !hits?.length) return hits || [];
    const scored = hits.map((hit) => {
      const blob = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase();
      const score = tokens.reduce((n, tok) => (blob.includes(tok) ? n + 1 : n), 0);
      const political =
        /انتخاب|برلمان|حزب|وزير الخارجية|الكنيست|حماس|حزب الله|ترامب|بايدن/.test(blob);
      return { hit, score: political ? -2 : score };
    });
    const kept = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    return (kept.length ? kept : scored.filter((s) => s.score >= 0)).map((s) => s.hit);
  }

  private topicTokens(topic: string): string[] {
    const stop = new Set([
      'هو', 'إحنا', 'ليه', 'لما', 'من', 'في', 'على', 'عن', 'مع', 'أو', 'هذا', 'هذه',
      'the', 'and', 'for', 'with', 'that', 'this',
    ]);
    return String(topic || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((w) => w.trim())
      .filter((w) => w.length >= 4 && !stop.has(w))
      .slice(0, 12);
  }

  private detectSourcesFromText(text: string): ResearchSourceId[] {
    const t = text.toLowerCase();
    const out: ResearchSourceId[] = [];
    if (/فيسبوك|فيس بوك|facebook|\bfb\b/.test(t)) out.push('facebook');
    if (/انستا|إنستا|انستجرام|إنستجرام|instagram|\big\b/.test(t)) out.push('instagram');
    if (/جوجل|غوغل|google|ويب|web search|دور على جوجل|ابحث في جوجل/.test(t)) out.push('google');
    if (/أخبار|اخبار|ترند|ترندات|news|trend/.test(t)) out.push('news');
    return out;
  }

  private extractTopicSeed(text: string): string {
    if (!text) return '';
    let cleaned = text
      .replace(/اعملي|اعمل|دور|ابحث|سيرش|search|على|عن|في|من|ترندات|ترند|trends?/gi, ' ')
      .replace(/فيسبوك|فيس بوك|facebook|انستجرام|إنستجرام|instagram|جوجل|غوغل|google|أخبار|اخبار|news/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 4) {
      // keep original minus source words only
      cleaned = text
        .replace(/فيسبوك|فيس بوك|facebook|انستجرام|إنستجرام|instagram|جوجل|غوغل|google/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return cleaned.slice(0, 120);
  }

  private defaultSeed(audience?: string) {
    return `تحديات تربية ${audience || 'أولياء الأمور المصريين المغتربين في الخليج'}`;
  }

  private async duckDuckGoSearch(
    query: string,
    source: ResearchSourceId,
    limit: number,
  ): Promise<ResearchHit[]> {
    try {
      const { data } = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        timeout: 6500,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; So7baFitContentStudio/1.0; +https://so7bafit.local)',
        },
      });
      const html = String(data || '');
      const re =
        /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<td[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/td>)/gi;
      const hits: ResearchHit[] = [];
      let match: RegExpExecArray | null;
      while ((match = re.exec(html)) && hits.length < limit) {
        const url = this.cleanDdgUrl(match[1]);
        const title = this.stripTags(match[2]);
        const snippet = this.stripTags(match[3] || match[4] || '');
        if (!url || !title) continue;
        if (!this.urlMatchesSource(url, source)) continue;
        hits.push(this.decorateHit({
          source,
          title: title.slice(0, 220),
          snippet: snippet.slice(0, 420),
          url,
          engine: 'duckduckgo',
        }));
      }
      // If site filter was too strict and returned nothing, keep unfiltered DDG rows tagged as source
      if (!hits.length && source !== 'google') {
        const loose = await this.duckDuckGoLoose(query, source, limit);
        return loose;
      }
      return hits;
    } catch (e: any) {
      this.logger.warn(`Research search failed (${source}): ${e?.message || e}`);
      return [];
    }
  }

  private async duckDuckGoLoose(
    query: string,
    source: ResearchSourceId,
    limit: number,
  ): Promise<ResearchHit[]> {
    try {
      const { data } = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        timeout: 6500,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; So7baFitContentStudio/1.0; +https://so7bafit.local)',
        },
      });
      const html = String(data || '');
      const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const hits: ResearchHit[] = [];
      let match: RegExpExecArray | null;
      while ((match = re.exec(html)) && hits.length < limit) {
        const url = this.cleanDdgUrl(match[1]);
        const title = this.stripTags(match[2]);
        if (!url || !title) continue;
        hits.push(this.decorateHit({
          source,
          title: title.slice(0, 220),
          snippet: '',
          url,
          engine: 'duckduckgo',
        }));
      }
      return hits;
    } catch {
      return [];
    }
  }

  private urlMatchesSource(url: string, source: ResearchSourceId): boolean {
    const u = url.toLowerCase();
    if (source === 'facebook') return /facebook\.com|fb\.com|fb\.watch/.test(u);
    if (source === 'instagram') return /instagram\.com/.test(u);
    if (source === 'news') {
      return /news|article|bbc|cnn|alarabiya|skynews|youm7|masrawy|الجزيرة|الشرق|reuters|guardian|nytimes/.test(
        u,
      );
    }
    return true;
  }

  private dedupeHits(hits: ResearchHit[]): ResearchHit[] {
    const seen = new Set<string>();
    const out: ResearchHit[] = [];
    for (const h of hits) {
      const key = (h.url || h.title).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(h);
    }
    return out;
  }

  private cleanDdgUrl(raw: string): string {
    try {
      const u = new URL(raw, 'https://duckduckgo.com');
      if (u.pathname.includes('/l/') && u.searchParams.get('uddg')) {
        return decodeURIComponent(u.searchParams.get('uddg') || raw);
      }
      return raw.startsWith('http') ? raw : `https:${raw}`;
    } catch {
      return raw;
    }
  }

  private decorateHit(hit: ResearchHit): ResearchHit {
    const platform =
      hit.source === 'facebook' || /facebook\.com|fb\.com|fb\.watch/i.test(hit.url)
        ? 'facebook'
        : hit.source === 'instagram' || /instagram\.com/i.test(hit.url)
          ? 'instagram'
          : hit.source === 'news'
            ? 'news'
            : hit.source === 'google'
              ? 'google'
              : 'web';
    const author = this.guessAuthor(hit.title, platform);
    return {
      ...hit,
      platform,
      author,
      handle: author ? `@${author.replace(/\s+/g, '').slice(0, 22)}` : undefined,
    };
  }

  private guessAuthor(title: string, platform: ResearchHit['platform']) {
    const raw = String(title || '').trim();
    if (!raw) return platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : '';
    const cleaned = raw
      .replace(/\s*[|\-–—]\s*(Facebook|Instagram|Twitter|X|YouTube).*$/i, '')
      .replace(/\s+on\s+(Facebook|Instagram).*$/i, '')
      .trim();
    return cleaned.slice(0, 48) || raw.slice(0, 48);
  }

  private async enrichHits(hits: ResearchHit[]): Promise<ResearchHit[]> {
    const decorated = hits.map((h) => this.decorateHit(h));
    const og = await Promise.all(decorated.map((hit) => this.fetchOpenGraph(hit.url)));
    return decorated.map((hit, i) => {
      const meta = og[i];
      if (!meta) return hit;
      return {
        ...hit,
        title: meta.title || hit.title,
        snippet: meta.description || hit.snippet,
        imageUrl: meta.image || hit.imageUrl,
        author: meta.author || hit.author,
      };
    });
  }

  private async fetchOpenGraph(url: string): Promise<{
    title?: string;
    description?: string;
    image?: string;
    author?: string;
  } | null> {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
      const { data } = await axios.get(url, {
        timeout: 3500,
        maxRedirects: 3,
        responseType: 'text',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const html = String(data || '').slice(0, 80_000);
      const pick = (keys: string[]) => {
        for (const key of keys) {
          const re = new RegExp(
            `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
            'i',
          );
          const alt = new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
            'i',
          );
          const m = html.match(re) || html.match(alt);
          if (m?.[1]) return this.stripTags(m[1]);
        }
        return '';
      };
      const title = pick(['og:title', 'twitter:title']) || this.stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const description = pick(['og:description', 'twitter:description', 'description']);
      let image = pick(['og:image', 'twitter:image', 'og:image:url']);
      if (image && image.startsWith('//')) image = `https:${image}`;
      const author = pick(['og:site_name', 'article:author', 'author']);
      if (!title && !description && !image) return null;
      return { title: title.slice(0, 220), description: description.slice(0, 420), image, author: author.slice(0, 48) };
    } catch {
      return null;
    }
  }

  private stripTags(html: string): string {
    return String(html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
