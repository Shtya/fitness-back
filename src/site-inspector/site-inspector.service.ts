import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { User } from "../../entities/global.entity";
import { AiFreeService } from "../ai-free/ai-free.service";
import { BrowserCollectResult, SiteBrowser } from "./browser-collector";
import { colorSaturation, normalizeColor } from "./color-utils";
import { analyzeClassTokens, analyzeCss, CssSource } from "./css-analyzer";
import { AnalyzeSiteDto, SiteInsightsDto } from "./dto/site-inspector.dto";
import { extractStaticHtml, StaticHtml } from "./html-static";
import {
  buildAnimations,
  buildAssets,
  buildComponents,
  buildDesign,
  buildNetwork,
  buildResponsive,
  buildSeo,
  buildSource,
  findSourceMapUrls,
  staticToPage,
} from "./report-builder";
import { detectTechnologies } from "./tech-signatures";
import { parsePublicUrl, resolvePublicHost, safeFetch, SafeFetchResult } from "./url-guard";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_INSIGHT_SUMMARY = 7000;

@Injectable()
export class SiteInspectorService implements OnModuleDestroy {
  private readonly logger = new Logger(SiteInspectorService.name);
  private readonly rateBuckets = new Map<string, number[]>();
  private readonly browser: SiteBrowser;

  constructor(
    private readonly config: ConfigService,
    private readonly aiFree: AiFreeService,
  ) {
    const concurrency = Math.min(Math.max(Number(this.config.get("SITE_INSPECTOR_CONCURRENCY")) || 2, 1), 6);
    this.browser = new SiteBrowser(concurrency);
  }

  async onModuleDestroy() {
    await this.browser.shutdown();
  }

  async analyze(user: User, dto: AnalyzeSiteDto) {
    if (!user?.id) throw new BadRequestException("Authentication required");
    this.assertRateLimit(String(user.id));
    if (this.browser.queueLength >= 6) {
      throw new ServiceUnavailableException("The analyzer is busy. Try again in a minute.");
    }

    const startedAt = Date.now();
    const target = parsePublicUrl(dto.url);
    await resolvePublicHost(target.hostname);
    const limitations: string[] = [
      "Only publicly served files are shown. Original source code (unbundled components, server code, private repositories, environment variables) cannot be retrieved from a website.",
    ];

    let raw: SafeFetchResult | null = null;
    try {
      raw = await safeFetch(target.toString(), { maxBytes: 4_000_000, timeoutMs: 20_000 });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      limitations.push(`Raw HTML request failed (${this.errorText(error)}); results come from the rendered page only.`);
    }
    if (raw && raw.status < 400 && !/html|xml/i.test(raw.contentType) && !/^\s*</.test(raw.body.slice(0, 200))) {
      throw new BadRequestException(`This URL returns ${raw.contentType || "non-HTML content"}, not a web page`);
    }

    let collected: BrowserCollectResult | null = null;
    const browserEnabled = String(this.config.get("SITE_INSPECTOR_BROWSER") ?? "true") !== "false";
    if (browserEnabled) {
      try {
        collected = await this.browser.collect(raw?.url || target.toString());
      } catch (error) {
        this.logger.warn(`Browser analysis failed for ${target.hostname}: ${this.errorText(error)}`);
        limitations.push(
          `Headless rendering failed (${this.errorText(error)}). Showing static analysis: computed styles, screenshots, animations and responsive checks are unavailable.`,
        );
      }
    } else {
      limitations.push("Headless rendering is disabled on this server (SITE_INSPECTOR_BROWSER=false). Showing static analysis only.");
    }
    if (!raw && !collected) throw new BadGatewayException("Could not load this website");

    const finalUrl = collected?.finalUrl || raw!.url;
    const headers = collected?.headers && Object.keys(collected.headers).length ? collected.headers : raw?.headers || {};
    const status = collected?.status || raw?.status || 0;
    const rawHtml = raw?.body || "";
    const staticHtml = extractStaticHtml(rawHtml || collected?.page?.renderedHtml || "", finalUrl);
    const page: any = collected ? collected.page : staticToPage(staticHtml, finalUrl);

    const stylesheets = collected ? collected.stylesheets : await this.fetchStaticStylesheets(staticHtml, finalUrl, limitations);
    const cssSources: CssSource[] = [
      ...stylesheets.map((s) => ({ url: s.url, text: s.text })),
      ...(page.styleBlocks || []).map((text: string, i: number) => ({ url: `<style> #${i + 1}`, text })),
    ];
    const css = analyzeCss(cssSources);
    const classCounts: Record<string, number> = collected ? page.classCounts : staticHtml.classCounts;
    const classes = analyzeClassTokens(classCounts);
    const scripts = collected?.scripts || [];
    const scriptUrls = [
      ...new Set([
        ...(page.scripts || []).map((s: any) => s.src).filter(Boolean),
        ...staticHtml.scripts.map((s) => s.src).filter(Boolean),
      ]),
    ] as string[];
    const inlineJs = (page.scripts || []).map((s: any) => s.inline || "").join("\n");

    const tech = detectTechnologies({
      html: `${rawHtml}\n${String(page.renderedHtml || "").slice(0, 400_000)}`,
      headers,
      scriptUrls,
      requestUrls: (collected?.network || []).map((n) => n.url),
      css: cssSources.map((s) => s.text).join("\n").slice(0, 3_000_000),
      js: `${inlineJs}\n${scripts.map((s) => s.sample).join("\n")}`.slice(0, 4_000_000),
      globals: collected?.globals || {},
      dom: collected?.domSignals || {},
      classes: classCounts,
      meta: page.meta || [],
      cookies: collected?.cookies || this.cookieNames(headers["set-cookie"]),
      cssBanners: css.banners,
      cssVariables: css.variables,
      tailwind: classes,
    });

    const sourceMaps = await this.readSourceMaps([
      ...scripts.filter((s) => s.sample.length >= s.bytes).map((s) => ({ url: s.url, text: s.sample })),
      ...stylesheets.filter((s) => !s.truncated).map((s) => ({ url: s.url, text: s.text })),
    ]);

    const primaryButton = (page.components?.buttons || []).find((b: any) => {
      const hex = normalizeColor(b.styles?.backgroundColor || "");
      return hex && colorSaturation(hex) >= 0.2;
    });
    const components = buildComponents(page);
    const network = buildNetwork(finalUrl, headers, collected);
    this.collectLimitations(limitations, { collected, page, status, scripts });

    return {
      id: randomUUID(),
      url: target.toString(),
      finalUrl,
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      mode: collected ? "browser" : "static",
      limitations,
      page: {
        title: page.title || "",
        description: (page.meta || []).find((m: any) => m.key === "description")?.content || "",
        lang: page.lang || "",
        dir: page.dir || "",
        status,
        contentType: headers["content-type"] || raw?.contentType || "",
        htmlBytes: raw?.bytes || 0,
        redirects: raw?.redirects || [],
        docWidth: page.docWidth || 0,
        docHeight: page.docHeight || 0,
        favicon: (page.assets?.icons || []).find((i: any) => /icon/i.test(i.rel))?.href || "",
        counts: page.counts || {},
      },
      screenshots: collected?.screenshots || {},
      tech,
      design: buildDesign(page, css, collected?.rootVariables || {}, primaryButton?.styles?.backgroundColor),
      components,
      animations: buildAnimations(page, css, tech),
      layout: { tree: page.tree || null, sections: components.sections },
      responsive: buildResponsive(collected, css),
      assets: buildAssets(page, css, collected?.network || []),
      seo: buildSeo(page, finalUrl),
      network: { ...network, status },
      source: buildSource({ rawHtml, page, stylesheets, scripts, css, classes, sourceMaps }),
      inspect: page.inspect || [],
    };
  }

  async insights(user: User, dto: SiteInsightsDto) {
    if (!user?.id) throw new BadRequestException("Authentication required");
    const payload = JSON.stringify(dto.summary ?? {});
    if (payload.length > MAX_INSIGHT_SUMMARY) {
      throw new BadRequestException(`Summary is too large (max ${MAX_INSIGHT_SUMMARY} characters)`);
    }
    const arabic = dto.locale === "ar";
    const language = arabic
      ? "Write all prose in Arabic; keep technology names, CSS values and code in English."
      : "Write in English.";
    const system =
      dto.mode === "overview"
        ? [
            "You are a senior frontend architect reviewing data extracted from a public website.",
            'Respond with JSON only, no markdown: {"summary": string, "architecture": string[], "rebuildPlan": string[], "recommendations": string[], "risks": string[]}.',
            "summary: 3-4 sentences. architecture: how the site is most likely built. rebuildPlan: 5-8 ordered steps to rebuild a similar UI with a modern stack. recommendations: performance, accessibility and SEO improvements grounded in the data.",
            "Base every statement on the provided data. If something is not in the data, say it is unknown. Never claim access to private or original source code.",
            language,
          ].join("\n")
        : [
            "You reconstruct UI components from HTML and computed styles extracted from a public website.",
            "Return one ```tsx code block containing a clean, accessible React function component styled with Tailwind CSS utility classes that approximate the given computed styles, then a short bullet list of assumptions.",
            "This is an approximation, not the original source. Do not include external imports other than React.",
            language,
          ].join("\n");

    const result = await this.aiFree.chat(user, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: payload },
      ],
      useProjectKnowledge: false,
      maxTokens: dto.mode === "overview" ? 1400 : 1800,
    } as any);

    const reply = String(result.reply || "").trim();
    let data: unknown;
    if (dto.mode === "overview") {
      data = this.parseJsonReply(reply) ?? { summary: reply };
    } else {
      const code = reply.match(/```(?:tsx|jsx|typescript|javascript)?\s*\n([\s\S]*?)```/);
      data = {
        code: code ? code[1].trim() : reply,
        notes: code ? reply.slice((code.index || 0) + code[0].length).trim() : "",
      };
    }
    return {
      mode: dto.mode,
      label: "ai-inferred",
      provider: result.provider,
      model: result.actualModel,
      generatedAt: new Date().toISOString(),
      data,
    };
  }

  private async fetchStaticStylesheets(staticHtml: StaticHtml, baseUrl: string, limitations: string[]) {
    const hrefs = staticHtml.links
      .filter((l) => /(^|\s)stylesheet(\s|$)/i.test(l.rel || "") && l.href)
      .map((l) => {
        try {
          return new URL(l.href, baseUrl).toString();
        } catch {
          return "";
        }
      })
      .filter(Boolean)
      .slice(0, 8);
    const results = await Promise.all(
      hrefs.map(async (href) => {
        try {
          const res = await safeFetch(href, { maxBytes: 1_500_000, timeoutMs: 8_000, accept: "text/css,*/*;q=0.1" });
          if (res.status >= 400) return null;
          return { url: res.url, text: res.body, bytes: res.bytes, truncated: false };
        } catch {
          return null;
        }
      }),
    );
    const ok = results.filter(Boolean) as { url: string; text: string; bytes: number; truncated: boolean }[];
    if (ok.length < hrefs.length) limitations.push(`${hrefs.length - ok.length} stylesheet(s) could not be downloaded.`);
    return ok;
  }

  private async readSourceMaps(files: { url: string; text: string }[]) {
    const urls = findSourceMapUrls(files, 3);
    return Promise.all(
      urls.map(async (url) => {
        try {
          const res = await safeFetch(url, { maxBytes: 8_000_000, timeoutMs: 8_000, accept: "application/json,*/*;q=0.1" });
          if (res.status >= 400) return { url, sources: [] as string[], error: `HTTP ${res.status} — not publicly available` };
          const json = JSON.parse(res.body);
          const sources = Array.isArray(json.sources) ? json.sources.slice(0, 300).map((s: unknown) => String(s).slice(0, 240)) : [];
          const hasContent = Array.isArray(json.sourcesContent) && json.sourcesContent.some(Boolean);
          return { url, sources, hasContent };
        } catch {
          return { url, sources: [] as string[], error: "Not publicly accessible or not valid JSON" };
        }
      }),
    );
  }

  private collectLimitations(
    limitations: string[],
    ctx: { collected: BrowserCollectResult | null; page: any; status: number; scripts: { bytes: number; sample: string }[] },
  ) {
    const { collected, page, status, scripts } = ctx;
    if (status >= 400) limitations.push(`The server responded with HTTP ${status}; the analyzed page may be an error page.`);
    if (/just a moment|attention required|access denied|verify you are human|captcha|are you a robot/i.test(page.title || "")) {
      limitations.push("The page looks like a bot-protection or challenge screen, so results may not reflect the real site.");
    }
    if (collected) {
      limitations.push("WebSockets, Web Workers, service workers and media streams are disabled in the sandbox, so realtime traffic is not captured.");
      if (collected.blockedRequests.length) {
        limitations.push(`${collected.blockedRequests.length} request(s) to private or non-web addresses were blocked by the sandbox.`);
      }
    }
    if (page.renderedHtmlTruncated) limitations.push("Rendered HTML exceeded the size limit and was truncated.");
    if (scripts.some((s) => s.sample.length < s.bytes)) {
      limitations.push("Large JavaScript bundles are shown as partial samples; full minified bundles are available at their public URLs.");
    }
  }

  private cookieNames(header?: string) {
    if (!header) return [];
    return [...header.matchAll(/(?:^|,\s*)([^=;,\s]+)=/g)].map((m) => m[1]).slice(0, 40);
  }

  private parseJsonReply(reply: string) {
    const start = reply.indexOf("{");
    const end = reply.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(reply.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  private errorText(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.split("\n")[0].slice(0, 160);
  }

  private assertRateLimit(userId: string) {
    const now = Date.now();
    const maximum = Math.min(Math.max(Number(this.config.get("SITE_INSPECTOR_RATE_LIMIT")) || 10, 1), 100);
    const recent = (this.rateBuckets.get(userId) || []).filter((t) => t > now - RATE_WINDOW_MS);
    if (recent.length >= maximum) {
      throw new HttpException("Too many website analyses. Try again in a few minutes.", HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.rateBuckets.set(userId, recent);
  }
}
