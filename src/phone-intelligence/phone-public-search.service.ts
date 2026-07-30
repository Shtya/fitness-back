import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PublicMatchSourceType, PhoneSearchSite } from './entities/phone-intelligence.entity';
import { NormalizedPhone, phoneSearchFormats } from './phone-normalize';
import { PhoneCredentialsService } from './phone-credentials.service';
import { PhoneSearchSitesService } from './phone-search-sites.service';
import {
	extractPossibleNameFromText,
	parseDirectorySignals,
	summarizeHitsForDebug,
} from './phone-findings';

export interface PublicSearchHit {
	title: string;
	snippet: string | null;
	sourceUrl: string;
	sourceType: PublicMatchSourceType;
	possibleName: string | null;
	confidenceScore: number;
	isOfficial: boolean;
	provider: string;
}

export type SearchProgressCb = (target: {
	id: string;
	labelEn: string;
	labelAr: string;
	status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
	message?: string;
	kind: 'api' | 'engine' | 'site';
	response?: Record<string, unknown> | null;
	progressPercent?: number;
}) => void | Promise<void>;

@Injectable()
export class PhonePublicSearchService {
	private readonly logger = new Logger(PhonePublicSearchService.name);

	constructor(
		private readonly config: ConfigService,
		private readonly credentials: PhoneCredentialsService,
		private readonly sites: PhoneSearchSitesService,
	) {}

	/** Deep public search across engines + configured sites. */
	async search(
		phone: NormalizedPhone,
		opts?: { onProgress?: SearchProgressCb; deep?: boolean },
	): Promise<PublicSearchHit[]> {
		const deep = opts?.deep !== false;
		const onProgress = opts?.onProgress;
		const formats = phoneSearchFormats(phone);
		const hits: PublicSearchHit[] = [];
		const enabledSites = await this.sites.listEnabled();
		const deadline = Date.now() + 75_000; // hard cap so UI never freezes at 38%

		const mark = async (
			id: string,
			labelEn: string,
			labelAr: string,
			status: 'pending' | 'running' | 'done' | 'failed' | 'skipped',
			kind: 'api' | 'engine' | 'site',
			message?: string,
			response?: Record<string, unknown> | null,
			progressPercent?: number,
		) => {
			if (onProgress) {
				await onProgress({
					id,
					labelEn,
					labelAr,
					status,
					kind,
					message,
					response,
					progressPercent,
				});
			}
		};

		const timedOut = () => Date.now() > deadline;

		const serpCreds = await this.credentials.resolve('serpapi');
		const cseCreds = await this.credentials.resolve('google_cse');
		const ddgOn = this.config.get('PHONE_DDG_SEARCH') !== 'false';
		const hasPaidSearch = Boolean(serpCreds?.apiKey || (cseCreds?.apiKey && cseCreds?.cx));

		await mark(
			'serpapi',
			'SerpAPI / Google',
			'SerpAPI / Google',
			serpCreds?.apiKey ? 'running' : 'skipped',
			'api',
			serpCreds?.apiKey ? undefined : 'API key missing',
			serpCreds?.apiKey ? { configured: true } : { configured: false, reason: 'API key missing' },
			40,
		);
		await mark(
			'google_cse',
			'Google CSE',
			'Google CSE',
			cseCreds?.apiKey && cseCreds?.cx ? 'running' : 'skipped',
			'api',
			cseCreds?.apiKey && cseCreds?.cx ? undefined : 'API key missing',
			cseCreds?.apiKey && cseCreds?.cx
				? { configured: true }
				: { configured: false, reason: 'API key missing' },
			41,
		);
		await mark(
			'duckduckgo',
			'DuckDuckGo',
			'DuckDuckGo',
			ddgOn ? 'running' : 'skipped',
			'engine',
			undefined,
			{ configured: ddgOn },
			42,
		);

		// Keep query count small — without SerpAPI this used to hammer DDG for minutes
		const queries = deep
			? [
					`"${formats.bestWebQuery}"`,
					`"${formats.bestWebQuery}" (name OR اسم OR caller OR صاحب)`,
					`"${formats.bestWebQuery}" (spam OR scam OR احتيال)`,
				]
			: [`"${formats.bestWebQuery}"`];

		const uniqueQueries = [...new Set(queries)].slice(0, hasPaidSearch ? 3 : 2);

		const serpHits: PublicSearchHit[] = [];
		const cseHits: PublicSearchHit[] = [];
		const ddgHitsAll: PublicSearchHit[] = [];

		for (const q of uniqueQueries) {
			if (timedOut()) break;
			if (serpCreds?.apiKey) {
				const part = await this.serpApiSearch(q);
				serpHits.push(...part);
				hits.push(...part);
			}
			if (cseCreds?.apiKey && cseCreds?.cx) {
				const part = await this.googleCseSearch(q);
				cseHits.push(...part);
				hits.push(...part);
			}
		}

		if (ddgOn && !timedOut()) {
			// Max 2 DDG queries total — previously this alone could stall the job
			const ddgHits = await this.duckDuckGoSearch(uniqueQueries.slice(0, 2));
			ddgHitsAll.push(...ddgHits);
			hits.push(...ddgHits);
		}

		await mark(
			'serpapi',
			'SerpAPI / Google',
			'SerpAPI / Google',
			serpCreds?.apiKey ? 'done' : 'skipped',
			'api',
			serpCreds?.apiKey ? `${serpHits.length} hits` : 'API key missing',
			serpCreds?.apiKey
				? summarizeHitsForDebug(serpHits, uniqueQueries)
				: { configured: false, reason: 'API key missing' },
			45,
		);
		await mark(
			'google_cse',
			'Google CSE',
			'Google CSE',
			cseCreds?.apiKey && cseCreds?.cx ? 'done' : 'skipped',
			'api',
			cseCreds?.apiKey && cseCreds?.cx ? `${cseHits.length} hits` : 'API key missing',
			cseCreds?.apiKey && cseCreds?.cx
				? summarizeHitsForDebug(cseHits, uniqueQueries)
				: { configured: false, reason: 'API key missing' },
			46,
		);
		await mark(
			'duckduckgo',
			'DuckDuckGo',
			'DuckDuckGo',
			ddgOn ? 'done' : 'skipped',
			'engine',
			ddgOn ? `${ddgHitsAll.length} hits` : 'disabled',
			ddgOn
				? summarizeHitsForDebug(ddgHitsAll, uniqueQueries.slice(0, 2))
				: { configured: false, reason: 'disabled' },
			48,
		);

		const urlSites = enabledSites.filter(s => s.mode === 'url' && !s.needsLogin);
		const engineSites = enabledSites.filter(
			s => s.mode === 'engine' || (s.domain && s.mode !== 'url' && !s.needsLogin),
		);
		const manualSites = enabledSites.filter(s => s.mode === 'manual' || s.needsLogin);

		for (const site of manualSites) {
			const siteId = `site:${site.id}`;
			const url = this.sites.buildAbsoluteUrl(site, phone);
			await mark(siteId, site.name, site.name, 'done', 'site', 'manual only', {
				real: false,
				mode: 'manual',
				needsLogin: true,
				url,
				hitCount: 0,
				namesFound: [],
				hits: [],
				note: site.notes || 'Login required in browser — not scraped.',
			});
		}

		// URL directory pages in parallel batches (was sequential and hung progress at 38%)
		const urlBatchSize = 3;
		for (let i = 0; i < urlSites.length; i += urlBatchSize) {
			if (timedOut()) break;
			const batch = urlSites.slice(i, i + urlBatchSize);
			await Promise.all(
				batch.map(async (site, batchIdx) => {
					const siteId = `site:${site.id}`;
					const pct = 48 + Math.floor(((i + batchIdx + 1) / Math.max(urlSites.length, 1)) * 8);
					await mark(siteId, site.name, site.name, 'running', 'site', undefined, null, pct);
					try {
						const url = this.sites.buildAbsoluteUrl(site, phone);
						const fetched = await this.fetchDirectoryPage(url, phone, site.name);
						if (fetched.hit) hits.push(fetched.hit);
						await mark(
							siteId,
							site.name,
							site.name,
							fetched.debug.reachable ? 'done' : 'failed',
							'site',
							fetched.debug.namesFound?.[0]
								? `name: ${fetched.debug.namesFound[0]}`
								: fetched.debug.reachable
									? `${fetched.debug.hitCount || 0} signals`
									: 'unreachable',
							fetched.debug,
							pct,
						);
					} catch (error: any) {
						await mark(siteId, site.name, site.name, 'failed', 'site', error?.message, {
							real: false,
							error: error?.message || String(error),
							hitCount: 0,
							namesFound: [],
							hits: [],
						});
					}
				}),
			);
		}

		// Engine/social sites: reuse global hits by domain — do NOT re-query DDG per site
		for (let i = 0; i < engineSites.length; i++) {
			if (timedOut()) {
				for (const left of engineSites.slice(i)) {
					await mark(
						`site:${left.id}`,
						left.name,
						left.name,
						'skipped',
						'site',
						'timed out',
						{ real: false, reason: 'search_deadline', hitCount: 0, namesFound: [], hits: [] },
						60,
					);
				}
				break;
			}

			const site = engineSites[i];
			const siteId = `site:${site.id}`;
			const pct = 56 + Math.floor(((i + 1) / Math.max(engineSites.length, 1)) * 6);
			await mark(siteId, site.name, site.name, 'running', 'site', undefined, null, pct);

			try {
				const siteQueries = site.domain
					? formats.siteQueries(site.domain).slice(0, 1)
					: [`"${formats.bestWebQuery}"`];

				let siteHits: PublicSearchHit[] = site.domain
					? hits.filter(h =>
							String(h.sourceUrl || '')
								.toLowerCase()
								.includes(String(site.domain).toLowerCase()),
						)
					: [];

				// Only fire an extra paid/engine query when we have SerpAPI/CSE
				if (hasPaidSearch && siteHits.length === 0 && siteQueries[0]) {
					const part = await this.searchMany([siteQueries[0]], { skipDdg: true });
					siteHits = part;
					hits.push(...part);
				}

				await mark(
					siteId,
					site.name,
					site.name,
					'done',
					'site',
					siteHits.length
						? `${siteHits.length} hits${
								siteHits.find(h => h.possibleName)
									? ` · name: ${siteHits.find(h => h.possibleName)?.possibleName}`
									: ''
							}`
						: hasPaidSearch
							? '0 hits'
							: '0 hits (add SerpAPI for deeper site search)',
					{
						real: true,
						mode: 'engine',
						domain: site.domain,
						url: this.sites.buildAbsoluteUrl(site, phone),
						...summarizeHitsForDebug(siteHits, siteQueries),
						note: hasPaidSearch
							? undefined
							: 'Without SerpAPI/Google CSE, site badges reuse DuckDuckGo results only.',
					},
					pct,
				);
			} catch (error: any) {
				this.logger.warn(`Site ${site.name} failed: ${error?.message || error}`);
				await mark(siteId, site.name, site.name, 'failed', 'site', error?.message, {
					real: false,
					error: error?.message || String(error),
					hitCount: 0,
					namesFound: [],
					hits: [],
				});
			}
		}

		return this.dedupe(hits).slice(0, deep ? 60 : 30);
	}

	/** Second-pass search once a possible public name is known. */
	async searchNameFollowUp(
		phone: NormalizedPhone,
		name: string,
		opts?: { onProgress?: SearchProgressCb },
	): Promise<PublicSearchHit[]> {
		const formats = phoneSearchFormats(phone);
		const cleanName = String(name || '').trim();
		if (cleanName.length < 3) return [];

		const queries = [
			`"${cleanName}" "${formats.bestWebQuery}"`,
			`"${cleanName}" (Cairo OR القاهرة OR address OR عنوان OR location)`,
		];

		await opts?.onProgress?.({
			id: 'name_followup',
			labelEn: `Name follow-up: ${cleanName}`,
			labelAr: `بحث بالاسم: ${cleanName}`,
			status: 'running',
			kind: 'engine',
			message: 'searching name + location',
			progressPercent: 82,
		});

		const out: PublicSearchHit[] = [];
		for (const q of queries) {
			out.push(...(await this.searchMany([q], { skipDdg: false })));
		}
		const deduped = this.dedupe(out).slice(0, 20);

		await opts?.onProgress?.({
			id: 'name_followup',
			labelEn: `Name follow-up: ${cleanName}`,
			labelAr: `بحث بالاسم: ${cleanName}`,
			status: 'done',
			kind: 'engine',
			message: `${deduped.length} hits`,
			progressPercent: 88,
			response: {
				real: true,
				name: cleanName,
				...summarizeHitsForDebug(deduped, queries),
			},
		});

		return deduped;
	}

	/**
	 * Only links that actually returned signal in this run (or reachable URL pages).
	 * Avoids dumping dozens of dead / untested shortcuts.
	 */
	buildWorkingUsefulLinks(
		phone: NormalizedPhone,
		sites: PhoneSearchSite[],
		searchTargets: Array<{
			id?: string;
			status?: string;
			response?: Record<string, any> | null;
			labelEn?: string;
		}>,
	): Record<string, string> {
		const out: Record<string, string> = {};
		const bySiteId = new Map<string, any>();
		for (const t of searchTargets || []) {
			if (String(t.id || '').startsWith('site:')) {
				bySiteId.set(String(t.id).slice(5), t);
			}
		}

		for (const site of sites) {
			const target = bySiteId.get(site.id);
			if (!target || target.status === 'failed' || target.status === 'skipped') continue;
			const res = target.response || {};
			const hitCount = Number(res.hitCount || res.hits?.length || 0);
			const names = Array.isArray(res.namesFound) ? res.namesFound.length : 0;
			const reachable = Boolean(res.reachable || res.httpStatus === 200);
			const worked = hitCount > 0 || names > 0 || reachable;
			if (!worked) continue;

			const key = site.name.replace(/\s+/g, '_').toLowerCase().slice(0, 40);
			out[key] = res.url || this.sites.buildAbsoluteUrl(site, phone);
		}

		// Core engines only if they returned hits
		const serp = (searchTargets || []).find(t => t.id === 'serpapi');
		const ddg = (searchTargets || []).find(t => t.id === 'duckduckgo');
		const cse = (searchTargets || []).find(t => t.id === 'google_cse');
		const formats = phoneSearchFormats(phone);
		const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${formats.bestWebQuery}"`)}`;
		if ((serp?.response?.hitCount || 0) > 0 || (cse?.response?.hitCount || 0) > 0) {
			out.google_working = googleUrl;
		}
		if ((ddg?.response?.hitCount || 0) > 0) {
			out.duckduckgo_working = `https://duckduckgo.com/?q=${encodeURIComponent(`"${formats.bestWebQuery}"`)}`;
		}

		const nameFollow = (searchTargets || []).find(t => t.id === 'name_followup');
		if ((nameFollow?.response?.hitCount || 0) > 0 && nameFollow?.response?.name) {
			out.name_followup = `https://www.google.com/search?q=${encodeURIComponent(
				`"${nameFollow.response.name}" "${formats.bestWebQuery}"`,
			)}`;
		}

		return out;
	}

	private async fetchDirectoryPage(
		url: string,
		phone: NormalizedPhone,
		siteName: string,
	): Promise<{
		hit: PublicSearchHit | null;
		debug: Record<string, unknown>;
	}> {
		try {
			const { data, status } = await axios.get(url, {
				timeout: 8000,
				maxRedirects: 3,
				responseType: 'text',
				headers: {
					'User-Agent':
						'Mozilla/5.0 (compatible; So7baFitPhoneCheck/1.0; +https://so7bafit.local)',
					Accept: 'text/html,application/xhtml+xml',
				},
				validateStatus: s => s >= 200 && s < 500,
			});

			if (status >= 400 || typeof data !== 'string') {
				return {
					hit: null,
					debug: {
						real: true,
						mode: 'url',
						url,
						reachable: false,
						httpStatus: status,
						hitCount: 0,
						namesFound: [],
						hits: [],
						note: 'Page returned error status',
					},
				};
			}

			const html = data.slice(0, 350_000);
			const text = this.stripTags(html);
			const lower = text.toLowerCase();
			const loginWall =
				/sign in|log in|create account|subscribe|captcha|verify you are human|تسجيل الدخول/.test(
					lower,
				) && text.length < 2500;

			const formats = phoneSearchFormats(phone);
			const digits = [formats.e164Digits, formats.bestWebQuery, formats.localLeadingZero].filter(
				Boolean,
			);
			const phoneMentioned = digits.some(d => d && text.replace(/\D/g, '').includes(String(d)));

			const title =
				this.matchTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || siteName;
			const snippet =
				this.matchMeta(html, /name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
				text.slice(0, 280);

			const signals = parseDirectorySignals({
				title,
				snippet,
				text: text.slice(0, 8000),
				url,
				sourceName: siteName,
			});

			// Prefer score from title when HTML CSS noise confuses body match
			const scoreFromTitle = signals.score;
			const possibleName = signals.possibleName;

			const hit: PublicSearchHit | null =
				!loginWall && (phoneMentioned || possibleName || scoreFromTitle || status === 200)
					? {
							title: String(title).slice(0, 500),
							snippet: String(snippet).slice(0, 800),
							sourceUrl: url,
							sourceType: PublicMatchSourceType.DIRECTORY,
							possibleName,
							confidenceScore: possibleName
								? 0.62
								: scoreFromTitle
									? 0.5
									: phoneMentioned
										? 0.45
										: 0.3,
							isOfficial: false,
							provider: `site_url:${siteName}`,
						}
					: null;

			return {
				hit,
				debug: {
					real: true,
					mode: 'url',
					url,
					reachable: !loginWall && status < 400,
					httpStatus: status,
					loginWall,
					phoneMentioned,
					hitCount: hit ? 1 : 0,
					namesFound: possibleName ? [possibleName] : [],
					locationsFound: signals.locations,
					scoresFound: scoreFromTitle ? [scoreFromTitle] : [],
					tellowsScore: scoreFromTitle,
					highlights: signals.highlights,
					bodyPreview: text.slice(0, 500),
					hits: hit
						? [
								{
									title: hit.title,
									snippet: hit.snippet,
									url,
									possibleName: hit.possibleName,
									locations: signals.locations,
									score: scoreFromTitle,
								},
							]
						: [],
					note: loginWall
						? 'Login/captcha wall — open manually in browser'
						: possibleName
							? 'Name extracted from public HTML'
							: scoreFromTitle
								? `Community score ${scoreFromTitle} extracted`
								: signals.locations.length
									? `Location extracted: ${signals.locations.join(', ')}`
									: 'Page reached; limited structured fields',
				},
			};
		} catch (error: any) {
			return {
				hit: null,
				debug: {
					real: true,
					mode: 'url',
					url,
					reachable: false,
					hitCount: 0,
					namesFound: [],
					hits: [],
					error: error?.message || String(error),
				},
			};
		}
	}

	private extractTellowsName(text: string): string | null {
		const patterns = [
			/(?:caller|name|اسم|المتصل|نوع المكالمة)\s*[:：\-]\s*([^\n|]{2,60})/i,
			/classified as\s+([^\n.]{2,60})/i,
		];
		for (const re of patterns) {
			const m = text.match(re);
			if (m?.[1]) {
				const v = extractPossibleNameFromText(m[1]);
				if (v) return v;
			}
		}
		return null;
	}

	private matchTag(html: string, re: RegExp): string | null {
		const m = re.exec(html);
		return m?.[1] ? this.stripTags(m[1]).slice(0, 200) : null;
	}

	private matchMeta(html: string, re: RegExp): string | null {
		const m = re.exec(html);
		return m?.[1]?.trim() || null;
	}

	/** @deprecated kept for older call sites — prefer buildWorkingUsefulLinks */
	buildUsefulLinks(
		phone: NormalizedPhone,
		sites: PhoneSearchSite[],
	): Record<string, string> {
		return this.buildWorkingUsefulLinks(phone, sites, []);
	}

	private manualSiteHint(site: PhoneSearchSite, phone: NormalizedPhone): PublicSearchHit {
		const url = this.sites.buildAbsoluteUrl(site, phone);
		return {
			title: `${site.name} (open manually)`,
			snippet: site.notes || 'Login wall / manual check — open in browser.',
			sourceUrl: url,
			sourceType: PublicMatchSourceType.DIRECTORY,
			possibleName: null,
			confidenceScore: 0.15,
			isOfficial: false,
			provider: 'manual_directory',
		};
	}

	private async searchMany(
		queries: string[],
		opts?: { skipDdg?: boolean },
	): Promise<PublicSearchHit[]> {
		const out: PublicSearchHit[] = [];
		for (const q of queries) {
			const tasks = [
				this.serpApiSearch(q),
				this.googleCseSearch(q),
				opts?.skipDdg ? Promise.resolve([]) : this.duckDuckGoSearch([q]),
			];
			const [serp, cse, ddg] = await Promise.all(tasks);
			out.push(...serp, ...cse, ...ddg);
		}
		return out;
	}

	private async serpApiSearch(query: string): Promise<PublicSearchHit[]> {
		const creds = await this.credentials.resolve('serpapi');
		if (!creds?.apiKey) return [];

		try {
			const { data } = await axios.get('https://serpapi.com/search.json', {
				params: { engine: 'google', q: query, api_key: creds.apiKey, num: 10 },
				timeout: 12000,
			});
			const organic = data.organic_results || [];
			return organic.map((item: any) => this.mapHit(item.title, item.snippet, item.link, 'serpapi'));
		} catch (error: any) {
			this.logger.warn(`SerpAPI failed: ${error?.message || error}`);
			return [];
		}
	}

	private async googleCseSearch(query: string): Promise<PublicSearchHit[]> {
		const creds = await this.credentials.resolve('google_cse');
		if (!creds?.apiKey || !creds?.cx) return [];

		try {
			const { data } = await axios.get('https://www.googleapis.com/customsearch/v1', {
				params: { key: creds.apiKey, cx: creds.cx, q: query, num: 10 },
				timeout: 12000,
			});
			return (data.items || []).map((item: any) =>
				this.mapHit(item.title, item.snippet, item.link, 'google_cse'),
			);
		} catch (error: any) {
			this.logger.warn(`Google CSE failed: ${error?.message || error}`);
			return [];
		}
	}

	private async duckDuckGoSearch(queries: string[]): Promise<PublicSearchHit[]> {
		const enabled = this.config.get('PHONE_DDG_SEARCH');
		if (enabled === 'false' || enabled === '0') return [];

		const hits: PublicSearchHit[] = [];
		for (const q of queries) {
			try {
				const { data } = await axios.get('https://html.duckduckgo.com/html/', {
					params: { q },
					timeout: 8000,
					headers: {
						'User-Agent':
							'Mozilla/5.0 (compatible; So7baFitPhoneCheck/1.0; +https://so7bafit.local)',
					},
				});
				const html = String(data || '');
				const re =
					/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
				let match: RegExpExecArray | null;
				let count = 0;
				while ((match = re.exec(html)) && count < 10) {
					const url = this.cleanDdgUrl(match[1]);
					const title = this.stripTags(match[2]);
					const snippet = this.stripTags(match[3]);
					if (url && title) {
						hits.push(this.mapHit(title, snippet, url, 'duckduckgo'));
						count += 1;
					}
				}
			} catch (error: any) {
				this.logger.warn(`DuckDuckGo search failed: ${error?.message || error}`);
			}
		}
		return hits;
	}

	private mapHit(
		title: string,
		snippet: string | null | undefined,
		url: string,
		provider: string,
	): PublicSearchHit {
		const sourceType = this.classifySource(url, title, snippet || '');
		const possibleName = this.extractPossibleName(title, snippet || '');
		const confidence = this.confidenceFor(sourceType, Boolean(possibleName));

		return {
			title: title.slice(0, 500),
			snippet: snippet ? String(snippet).slice(0, 800) : null,
			sourceUrl: url,
			sourceType,
			possibleName,
			confidenceScore: confidence,
			isOfficial: sourceType === PublicMatchSourceType.BUSINESS || sourceType === PublicMatchSourceType.DIRECTORY,
			provider,
		};
	}

	private classifySource(url: string, title: string, snippet: string): PublicMatchSourceType {
		const text = `${url} ${title} ${snippet}`.toLowerCase();
		if (/facebook|instagram|linkedin|twitter|x\.com|tiktok|youtube/.test(text)) {
			return PublicMatchSourceType.SOCIAL_PUBLIC;
		}
		if (/yellowpages|yp\.com|opencorporates|chamber|directory|دليل|shouldianswer|whocalls|numlookup/.test(text)) {
			return PublicMatchSourceType.DIRECTORY;
		}
		if (/careers?|contact|about|company|corp|ltd|llc|شركة|مؤسسة/.test(text)) {
			return PublicMatchSourceType.BUSINESS;
		}
		if (/ad|advert|classified|إعلان/.test(text)) return PublicMatchSourceType.AD;
		if (/news|press|article/.test(text)) return PublicMatchSourceType.NEWS;
		return PublicMatchSourceType.OTHER;
	}

	private extractPossibleName(title: string, snippet: string): string | null {
		return extractPossibleNameFromText(title, snippet);
	}

	private confidenceFor(type: PublicMatchSourceType, hasName: boolean): number {
		const base: Record<PublicMatchSourceType, number> = {
			[PublicMatchSourceType.BUSINESS]: 0.7,
			[PublicMatchSourceType.DIRECTORY]: 0.65,
			[PublicMatchSourceType.AD]: 0.45,
			[PublicMatchSourceType.NEWS]: 0.5,
			[PublicMatchSourceType.SOCIAL_PUBLIC]: 0.4,
			[PublicMatchSourceType.USER_COMMENT]: 0.35,
			[PublicMatchSourceType.OTHER]: 0.3,
		};
		return Math.min(0.9, (base[type] || 0.3) + (hasName ? 0.05 : 0));
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

	private stripTags(html: string): string {
		return String(html || '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#x27;/g, "'")
			.replace(/\s+/g, ' ')
			.trim();
	}

	private dedupe(hits: PublicSearchHit[]): PublicSearchHit[] {
		const seen = new Set<string>();
		const out: PublicSearchHit[] = [];
		for (const h of hits) {
			const key = (h.sourceUrl || '').split('?')[0].toLowerCase();
			if (!key || seen.has(key)) continue;
			seen.add(key);
			out.push(h);
		}
		return out.sort((a, b) => b.confidenceScore - a.confidenceScore);
	}
}
