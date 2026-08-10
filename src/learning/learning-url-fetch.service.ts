import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';

const MAX_HTML = 450_000;
const MAX_TEXT = 24_000;
const OFFICIAL_CONCURRENCY = 2;
const OFFICIAL_GAP_MS = 220;
const OFFICIAL_MAX_RETRIES = 4;

const STREAM_SKIP = new Set([
	'loaderData',
	'card',
	'title',
	'roadmap',
	'starCount',
	'repoRank',
	'discordInfo',
	'url',
	'total',
	'totalFormatted',
	'online',
	'onlineFormatted',
	'page',
	'description',
	'slug',
	'nodes',
	'type',
	'section',
	'position',
	'selected',
	'selectable',
	'draggable',
	'deletable',
	'data',
	'label',
	'style',
	'fontSize',
	'backgroundColor',
	'borderColor',
	'zIndex',
	'width',
	'height',
	'measured',
	'dragging',
	'resizing',
	'focusable',
	'oldId',
	'horizontal',
	'vertical',
	'strokeDasharray',
	'strokeLinecap',
	'round',
	'strokeWidth',
	'stroke',
	'positionAbsolute',
	'topic',
	'subtopic',
	'paragraph',
	'justifyContent',
	'flex-start',
	'textAlign',
	'center',
	'href',
	'button',
	'color',
	'id',
	'x',
	'y',
	'routes/$roadmapSlug._index',
	'WHITe',
	'Related Roadmaps',
	'Continue learning with following relevant tracks',
]);

const ROADMAP_TAIL_MARKERS = [
	'\\"Related Roadmaps\\"',
	'\\"Find the detailed version\\"',
	'\\"Continue learning with following relevant tracks\\"',
];

@Injectable()
export class LearningUrlFetchService {
	async fetch(urlRaw: string) {
		const url = this.normalizeUrl(urlRaw);
		if (!url) throw new BadRequestException('Invalid URL');

		const slug = this.roadmapShSlug(url);
		let officialRoadmap: Record<string, any> | null = null;
		if (slug && url.includes('roadmap.sh')) {
			officialRoadmap = await this.fetchOfficialRoadmap(slug);
		}

		if (officialRoadmap?.nodes?.length) {
			const topicNodes = (officialRoadmap.nodes as any[]).filter(
				node =>
					['topic', 'subtopic'].includes(String(node?.type || '')) &&
					String(node?.data?.label || '').trim(),
			);
			const streamTopics = topicNodes.map(node => String(node.data.label).trim());
			const titleRaw = officialRoadmap.title;
			const title =
				typeof titleRaw === 'string'
					? titleRaw
					: String(titleRaw?.page || titleRaw?.card || slug || 'Roadmap');
			return {
				url,
				originalUrl: urlRaw.trim(),
				title,
				description: String(officialRoadmap.description || '')
					.replace(/@currentYear@/g, String(new Date().getFullYear()))
					.slice(0, 1200),
				text: String(officialRoadmap.description || '').replace(
					/@currentYear@/g,
					String(new Date().getFullYear()),
				),
				headings: streamTopics.slice(0, 40),
				streamTopics,
				excerpt: [
					officialRoadmap.description || '',
					`Official roadmap nodes: ${topicNodes.length}`,
					streamTopics.slice(0, 80).map(item => `- ${item}`).join('\n'),
				]
					.filter(Boolean)
					.join('\n\n')
					.slice(0, 12000),
				contentLength: Number(officialRoadmap.description?.length || 0),
				officialRoadmap,
				roadmapSlug: slug,
			};
		}

		const { data, status } = await axios.get(url, {
			timeout: 15000,
			maxRedirects: 4,
			responseType: 'text',
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
				Accept: 'text/html,application/xhtml+xml,text/plain',
			},
			validateStatus: s => s >= 200 && s < 400,
		});

		if (status >= 400 || typeof data !== 'string') {
			throw new BadRequestException('Could not fetch page');
		}

		const html = data.slice(0, MAX_HTML);
		const jsonLd = this.extractJsonLd(html);
		const title =
			jsonLd?.headline ||
			this.matchMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
			this.matchMeta(html, /property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
			'';
		const description =
			jsonLd?.description ||
			this.matchMeta(html, /name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
			this.matchMeta(html, /property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
			'';

		const text = this.stripTags(html).slice(0, MAX_TEXT);
		const headings = this.extractHeadings(html).slice(0, 40);
		const streamTopics = this.extractRoadmapShStreamTopics(html, url);
		const faqLines = this.extractFaqFromHtml(html);

		const excerptParts = [
			description,
			faqLines.length ? `FAQ:\n${faqLines.join('\n')}` : '',
			streamTopics.length
				? `Roadmap topics (${streamTopics.length}):\n${streamTopics.slice(0, 120).join('\n')}`
				: '',
			text.slice(0, 4000),
		].filter(Boolean);

		return {
			url,
			originalUrl: urlRaw.trim(),
			title: this.decodeEntities(title).slice(0, 500),
			description: this.decodeEntities(description).slice(0, 1200),
			text,
			headings,
			streamTopics,
			excerpt: excerptParts.join('\n\n').slice(0, 12000),
			contentLength: text.length,
			officialRoadmap: null,
			roadmapSlug: slug,
		};
	}

	async fetchOfficialRoadmap(slug: string) {
		const clean = String(slug || '')
			.trim()
			.replace(/^\/+|\/+$/g, '')
			.split('/')[0];
		if (!clean) return null;
		try {
			const { data, status } = await axios.get(
				`https://roadmap.sh/api/v1-official-roadmap/${encodeURIComponent(clean)}`,
				{
					timeout: 20000,
					headers: {
						Accept: 'application/json',
						'User-Agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
					},
					validateStatus: s => s >= 200 && s < 500,
				},
			);
			if (status >= 400 || !data || !Array.isArray(data.nodes)) return null;
			return data;
		} catch {
			return null;
		}
	}

	async listOfficialRoadmaps() {
		try {
			const { data, status } = await axios.get(
				'https://roadmap.sh/api/v1-list-official-roadmaps',
				{
					timeout: 20000,
					headers: {
						Accept: 'application/json',
						'User-Agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
					},
					validateStatus: s => s >= 200 && s < 500,
				},
			);
			if (status >= 400 || !Array.isArray(data)) return [];
			return data
				.filter(item => item && String(item.status || 'published') === 'published')
				.map(item => {
					const titleRaw = item.title;
					const title =
						typeof titleRaw === 'string'
							? titleRaw
							: String(titleRaw?.page || titleRaw?.card || item.slug || '').trim();
					const slug = String(item.slug || '').trim();
					if (!slug || !title) return null;
					return {
						slug,
						title,
						description: String(item.description || item.seo?.description || '')
							.replace(/@currentYear@/g, String(new Date().getFullYear()))
							.trim(),
						type: String(item.type || 'roadmap'),
						url: `https://roadmap.sh/${slug}`,
						relatedRoadmaps: Array.isArray(item.relatedRoadmaps)
							? item.relatedRoadmaps.map((row: any) => String(row)).filter(Boolean)
							: [],
					};
				})
				.filter(Boolean);
		} catch {
			return [];
		}
	}

	async searchWebRoadmaps(query: string) {
		const q = String(query || '').trim();
		if (!q) return [];
		const searches = [
			`${q} learning roadmap`,
			`site:roadmap.sh ${q}`,
			`${q} developer roadmap curriculum`,
		];
		const hits: Array<{ title: string; url: string; snippet: string; source: string }> = [];
		const seen = new Set<string>();

		for (const search of searches) {
			try {
				const { data } = await axios.get('https://html.duckduckgo.com/html/', {
					timeout: 12000,
					params: { q: search },
					headers: {
						'User-Agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
						Accept: 'text/html',
					},
					responseType: 'text',
					validateStatus: s => s >= 200 && s < 400,
				});
				const html = String(data || '');
				const re =
					/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
				let match: RegExpExecArray | null;
				while ((match = re.exec(html)) && hits.length < 10) {
					const rawUrl = this.decodeEntities(match[1] || '');
					const title = this.stripTags(this.decodeEntities(match[2] || '')).trim();
					const url = this.unwrapDuckDuckGoUrl(rawUrl);
					if (!url || !title || seen.has(url)) continue;
					if (!/^https?:\/\//i.test(url)) continue;
					seen.add(url);
					hits.push({
						title: title.slice(0, 180),
						url,
						snippet: '',
						source: 'web',
					});
				}
			} catch {
				/* try next query */
			}
		}
		return hits.slice(0, 8);
	}

	private unwrapDuckDuckGoUrl(raw: string): string {
		try {
			const url = new URL(raw, 'https://duckduckgo.com');
			const uddg = url.searchParams.get('uddg');
			if (uddg) return decodeURIComponent(uddg);
			if (url.hostname.includes('duckduckgo.com')) return '';
			return url.toString();
		} catch {
			return '';
		}
	}

	async fetchOfficialTopic(slug: string, nodeId: string) {
		const cleanSlug = String(slug || '').trim();
		const cleanNode = String(nodeId || '').trim();
		if (!cleanSlug || !cleanNode) return null;

		for (let attempt = 0; attempt <= OFFICIAL_MAX_RETRIES; attempt++) {
			try {
				const { data, status, headers } = await axios.get(
					`https://roadmap.sh/api/v1-official-roadmap-topic/${encodeURIComponent(cleanSlug)}/${encodeURIComponent(cleanNode)}`,
					{
						timeout: 20000,
						headers: {
							Accept: 'application/json',
							'User-Agent':
								'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
						},
						validateStatus: s => s >= 200 && s < 500,
					},
				);

				if (status === 429 || status === 503) {
					const retryAfter = Number(headers?.['retry-after'] || 0);
					const waitMs = Math.max(
						retryAfter * 1000,
						OFFICIAL_GAP_MS * Math.pow(2, attempt + 1),
					);
					if (attempt < OFFICIAL_MAX_RETRIES) {
						await this.sleep(waitMs);
						continue;
					}
					return null;
				}

				if (status >= 400 || !data) return null;
				return {
					nodeId: String(data.nodeId || cleanNode),
					description: String(data.description || ''),
					resources: Array.isArray(data.resources) ? data.resources : [],
					lessonPacks: Array.isArray(data.lessonPacks) ? data.lessonPacks : [],
				};
			} catch {
				if (attempt < OFFICIAL_MAX_RETRIES) {
					await this.sleep(OFFICIAL_GAP_MS * Math.pow(2, attempt + 1));
					continue;
				}
				return null;
			}
		}
		return null;
	}

	async fetchOfficialTopicDetails(
		slug: string,
		nodeIds: string[],
		concurrency = OFFICIAL_CONCURRENCY,
	) {
		const ids = [...new Set(nodeIds.map(id => String(id || '').trim()).filter(Boolean))];
		const map = new Map<string, any>();
		let index = 0;
		const workerCount = Math.min(Math.max(1, concurrency), 3, ids.length || 1);

		const workers = Array.from({ length: workerCount }, async () => {
			while (index < ids.length) {
				const current = ids[index++];
				const detail = await this.fetchOfficialTopic(slug, current);
				if (detail) map.set(current, detail);
				await this.sleep(OFFICIAL_GAP_MS);
			}
		});
		await Promise.all(workers);
		return map;
	}

	private sleep(ms: number) {
		return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
	}

	private normalizeUrl(raw: string): string | null {
		const value = String(raw || '').trim();
		if (!value) return null;
		try {
			const url = new URL(value.includes('://') ? value : `https://${value}`);
			if (!['http:', 'https:'].includes(url.protocol)) return null;
			return this.normalizeRoadmapShUrl(url);
		} catch {
			return null;
		}
	}

	/** Chat URLs have almost no scrapeable content — use the static roadmap page. */
	private normalizeRoadmapShUrl(url: URL): string {
		if (!url.hostname.replace(/^www\./, '').endsWith('roadmap.sh')) {
			return url.toString();
		}
		const chatMatch = url.pathname.match(/\/ai\/roadmap-chat\/([^/]+)\/?$/i);
		if (chatMatch?.[1]) {
			return `https://roadmap.sh/${chatMatch[1]}`;
		}
		return url.toString();
	}

	roadmapShSlug(pageUrl: string): string | null {
		try {
			const host = new URL(pageUrl).hostname.replace(/^www\./, '');
			if (!host.endsWith('roadmap.sh')) return null;
			const pathname = new URL(pageUrl).pathname.replace(/^\/+|\/+$/g, '');
			const first = pathname.split('/')[0]?.trim();
			if (!first || first === 'ai' || first === 'api' || first === 'guides') return null;
			return first;
		} catch {
			return null;
		}
	}

	private extractJsonLd(html: string) {
		try {
			const block = html.match(
				/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i,
			)?.[1];
			if (!block) return null;
			const parsed = JSON.parse(block);
			const items = Array.isArray(parsed) ? parsed : [parsed];
			const blog = items.find(item => item?.['@type'] === 'BlogPosting');
			return blog || items[0] || null;
		} catch {
			return null;
		}
	}

	private extractFaqFromHtml(html: string): string[] {
		try {
			const block = html.match(
				/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i,
			)?.[1];
			if (!block) return [];
			const parsed = JSON.parse(block);
			const items = Array.isArray(parsed) ? parsed : [parsed];
			const faq = items.find(item => item?.['@type'] === 'FAQPage');
			if (!faq?.mainEntity) return [];
			return faq.mainEntity
				.slice(0, 8)
				.map((item: any) => {
					const q = item?.name || '';
					const a = item?.acceptedAnswer?.text || '';
					return q ? `Q: ${q}\nA: ${String(a).slice(0, 280)}` : '';
				})
				.filter(Boolean);
		} catch {
			return [];
		}
	}

	private extractRoadmapShStreamTopics(html: string, pageUrl: string): string[] {
		if (!pageUrl.includes('roadmap.sh')) return [];
		const start = html.indexOf('streamController');
		if (start < 0) return [];

		const slug = this.roadmapShSlug(pageUrl);
		const chunk = html.slice(start, start + 450_000);
		const scope = slug ? this.roadmapShScope(chunk, slug) : chunk;
		return this.extractHumanLabels(scope);
	}

	private roadmapShScope(chunk: string, slug: string): string {
		const marker = `\\"${slug}\\"`;
		const idx = chunk.indexOf(marker);
		if (idx < 0) return chunk;

		let end = Math.min(chunk.length, idx + 130_000);
		for (const tail of ROADMAP_TAIL_MARKERS) {
			const at = chunk.indexOf(tail, idx + marker.length);
			if (at > idx) end = Math.min(end, at);
		}
		return chunk.slice(idx, end);
	}

	private extractHumanLabels(scope: string): string[] {
		const re = /\\"([A-Z][A-Za-z0-9 ,/&+\-().':]{4,90})\\"/g;
		const cssLike =
			/^(flex|stroke|font|text|background|border|justify|align|padding|margin|line|letter|word|white|box|grid|gap|opacity|transform|transition|cursor|pointer|display|overflow|object|max|min|content|items|self|order|grow|shrink|basis|wrap|space|divide|ring|shadow|rounded|inset|outline|list|table|columns|break|hyphens|whitespace|vertical|horizontal|resize|scroll|snap|touch|select|appearance|accent|caret|will|filter|backdrop|from|via|to|decoration|underline|overline|through|indent|align|break|clamp|fill|stroke)/i;
		const idLike = (value: string) =>
			/^[A-Za-z0-9_-]{12,}$/.test(value) && !/\s/.test(value);
		const tailJunk =
			/^(related roadmaps|continue learning|find the detailed|scrimba|forward deployed eng\.?)$/i;

		const topics: string[] = [];
		let match: RegExpExecArray | null;
		while ((match = re.exec(scope)) && topics.length < 320) {
			const value = match[1].trim();
			if (STREAM_SKIP.has(value)) continue;
			if (idLike(value)) continue;
			if (cssLike.test(value)) continue;
			if (/^[a-z]+([A-Z][a-zA-Z]+)+$/.test(value)) continue;
			if (/^https?:\/\//i.test(value)) continue;
			if (/^\d/.test(value) && !value.includes(' ')) continue;
			if (/^[0-9.KM]+$/i.test(value)) continue;
			if (value.includes('@currentYear@')) continue;
			if (value.length < 4) continue;
			if (tailJunk.test(value)) continue;
			if (value === 'horizontal node') continue;
			topics.push(value);
		}
		return this.orderedUnique(topics);
	}

	private orderedUnique(items: string[]): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const item of items) {
			if (seen.has(item)) continue;
			seen.add(item);
			out.push(item);
		}
		return out;
	}

	private extractHeadings(html: string): string[] {
		const headings: string[] = [];
		const re = /<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi;
		let match: RegExpExecArray | null;
		while ((match = re.exec(html)) && headings.length < 40) {
			const text = this.stripTags(match[2]).trim();
			if (text.length >= 2 && text.length <= 200) headings.push(text);
		}
		return headings;
	}

	private matchMeta(html: string, re: RegExp): string | null {
		const m = re.exec(html);
		return m?.[1]?.trim() || null;
	}

	private stripTags(html: string): string {
		return html
			.replace(/<script[\s\S]*?<\/script>/gi, ' ')
			.replace(/<style[\s\S]*?<\/style>/gi, ' ')
			.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private decodeEntities(value: string): string {
		return value
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
			.replace(/&nbsp;/g, ' ');
	}

	extractYoutubeVideoId(input: string): string | null {
		const value = String(input || '').trim();
		if (!value) return null;
		if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
		try {
			const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
			if (parsed.hostname.includes('youtu.be')) {
				return parsed.pathname.replace(/^\//, '').split('/')[0] || null;
			}
			if (parsed.hostname.includes('youtube.com')) {
				return (
					parsed.searchParams.get('v') ||
					parsed.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1] ||
					null
				);
			}
		} catch {
			return null;
		}
		return null;
	}

	async fetchYoutubeTranscript(videoUrlOrId: string) {
		const videoId = this.extractYoutubeVideoId(videoUrlOrId);
		if (!videoId) throw new BadRequestException('Valid YouTube URL or video id is required');

		const headers = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
			'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
		};

		let tracks = await this.fetchYoutubeCaptionTracksViaInnertube(videoId);
		if (!tracks.length) {
			tracks = await this.fetchYoutubeCaptionTracksFromWatchPage(videoId, headers);
		}
		if (!tracks.length) {
			throw new BadRequestException(
				'No captions found for this video. Captions must be available on YouTube.',
			);
		}

		const preferred =
			tracks.find(track => /^en/.test(track.languageCode) && !track.kind) ||
			tracks.find(track => /^en/.test(track.languageCode)) ||
			tracks.find(track => /^ar/.test(track.languageCode)) ||
			tracks.find(track => !track.kind) ||
			tracks[0];

		const cuePayloads: string[] = [];
		const base = preferred.baseUrl;
		const candidates = [
			base,
			`${base}${base.includes('?') ? '&' : '?'}fmt=json3`,
			`${base}${base.includes('?') ? '&' : '?'}fmt=srv3`,
			`${base}${base.includes('?') ? '&' : '?'}fmt=vtt`,
		];

		for (const trackUrl of candidates) {
			try {
				const { data: captionPayload, status } = await axios.get(trackUrl, {
					timeout: 20000,
					responseType: 'text',
					headers: {
						...headers,
						'User-Agent':
							'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
					},
					validateStatus: s => s >= 200 && s < 500,
				});
				const text = String(captionPayload || '').trim();
				if (status < 400 && text) cuePayloads.push(text);
			} catch {
				/* try next format */
			}
		}

		let cues: Array<{ id: string; start: number; end: number; text: string }> = [];
		for (const payload of cuePayloads) {
			cues = this.parseYoutubeCaptionPayload(payload);
			if (cues.length) break;
		}

		if (!cues.length) {
			throw new BadRequestException('Could not parse captions for this video');
		}

		return {
			videoId,
			language: preferred.languageCode || 'en',
			languageName: preferred.name || preferred.languageCode || 'English',
			isAutoGenerated: preferred.kind === 'asr',
			cues: cues.slice(0, 2000),
		};
	}

	private async fetchYoutubeCaptionTracksViaInnertube(videoId: string) {
		const clients = [
			{
				clientName: 'ANDROID',
				clientVersion: '20.10.38',
				userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
			},
			{
				clientName: 'IOS',
				clientVersion: '20.10.4',
				userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_4 like Mac OS X)',
			},
		];

		for (const client of clients) {
			try {
				const { data } = await axios.post(
					'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
					{
						context: {
							client: {
								clientName: client.clientName,
								clientVersion: client.clientVersion,
								hl: 'en',
								gl: 'US',
							},
						},
						videoId,
					},
					{
						timeout: 20000,
						headers: {
							'User-Agent': client.userAgent,
							'Content-Type': 'application/json',
						},
						validateStatus: s => s >= 200 && s < 500,
					},
				);
				const list =
					data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
				const tracks = this.normalizeCaptionTracks(list);
				if (tracks.length) return tracks;
			} catch {
				/* try next client */
			}
		}
		return [];
	}

	private async fetchYoutubeCaptionTracksFromWatchPage(
		videoId: string,
		headers: Record<string, string>,
	) {
		const { data: html } = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
			timeout: 20000,
			responseType: 'text',
			headers: {
				...headers,
				Accept: 'text/html,application/xhtml+xml',
			},
			validateStatus: s => s >= 200 && s < 400,
		});
		return this.extractYoutubeCaptionTracks(String(html || ''));
	}

	private normalizeCaptionTracks(list: any[]) {
		return (Array.isArray(list) ? list : [])
			.map((track: any) => ({
				baseUrl: String(track?.baseUrl || '')
					.replace(/\\u0026/g, '&')
					.replace(/\\\//g, '/'),
				languageCode: String(track?.languageCode || ''),
				name: String(
					track?.name?.simpleText || track?.name?.runs?.[0]?.text || track?.languageCode || '',
				),
				kind: String(track?.kind || ''),
			}))
			.filter(track => track.baseUrl);
	}

	private extractJsonObjectAfterMarker(html: string, marker: string): string | null {
		const start = html.indexOf(marker);
		if (start < 0) return null;
		const eq = html.indexOf('=', start);
		const brace = html.indexOf('{', eq);
		if (brace < 0) return null;
		let depth = 0;
		for (let i = brace; i < html.length; i += 1) {
			const ch = html[i];
			if (ch === '{') depth += 1;
			else if (ch === '}') {
				depth -= 1;
				if (depth === 0) return html.slice(brace, i + 1);
			}
		}
		return null;
	}

	private extractYoutubeCaptionTracks(html: string): Array<{
		baseUrl: string;
		languageCode: string;
		name: string;
		kind: string;
	}> {
		const rawPlayer = this.extractJsonObjectAfterMarker(html, 'ytInitialPlayerResponse');
		if (rawPlayer) {
			try {
				const player = JSON.parse(rawPlayer);
				const list =
					player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
				const tracks = this.normalizeCaptionTracks(list);
				if (tracks.length) return tracks;
			} catch {
				/* fall through */
			}
		}

		const captionMatch = html.match(/"captionTracks":(\[[\s\S]*?\])\s*,\s*"/);
		if (!captionMatch?.[1]) return [];
		try {
			const list = JSON.parse(captionMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'));
			return this.normalizeCaptionTracks(list);
		} catch {
			return [];
		}
	}

	private parseYoutubeCaptionPayload(payload: string) {
		const trimmed = payload.trim();
		if (!trimmed) return [];

		if (trimmed.startsWith('{')) {
			try {
				const json = JSON.parse(trimmed);
				const events = Array.isArray(json?.events) ? json.events : [];
				const cues: Array<{ id: string; start: number; end: number; text: string }> = [];
				events.forEach((event: any, index: number) => {
					const segs = Array.isArray(event?.segs) ? event.segs : [];
					const text = segs
						.map((seg: any) => String(seg?.utf8 || ''))
						.join('')
						.replace(/\n+/g, ' ')
						.trim();
					if (!text) return;
					const start = Number(event?.tStartMs || 0) / 1000;
					const end = start + Number(event?.dDurationMs || 2000) / 1000;
					cues.push({
						id: `cue_${index}`,
						start: Number(start.toFixed(3)),
						end: Number(end.toFixed(3)),
						text: this.decodeEntities(text),
					});
				});
				if (cues.length) return cues;
			} catch {
				/* fall through */
			}
		}

		if (/<p\b/i.test(trimmed) || /<timedtext\b/i.test(trimmed)) {
			const cues: Array<{ id: string; start: number; end: number; text: string }> = [];
			const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
			let match: RegExpExecArray | null;
			let index = 0;
			while ((match = re.exec(trimmed))) {
				const attrs = match[1] || '';
				const startMs = Number(/(?:\bt|start)="([^"]+)"/i.exec(attrs)?.[1] || 0);
				const durMs = Number(/(?:\bd|dur)="([^"]+)"/i.exec(attrs)?.[1] || 2000);
				const text = this.decodeEntities(this.stripTags(match[2] || ''))
					.replace(/\n+/g, ' ')
					.trim();
				if (!text) continue;
				// YouTube timedtext format=3 uses milliseconds in t/d.
				const startSec = startMs / 1000;
				const endSec = startSec + Math.max(durMs / 1000, 0.4);
				cues.push({
					id: `cue_${index++}`,
					start: Number(startSec.toFixed(3)),
					end: Number(endSec.toFixed(3)),
					text,
				});
			}
			if (cues.length) return cues;
		}

		if (/WEBVTT/i.test(trimmed)) {
			const cues: Array<{ id: string; start: number; end: number; text: string }> = [];
			const blocks = trimmed.split(/\n\s*\n/);
			let index = 0;
			for (const block of blocks) {
				const lines = block.split(/\n/).map(line => line.trim()).filter(Boolean);
				const timeLine = lines.find(line => line.includes('-->'));
				if (!timeLine) continue;
				const [startRaw, endRaw] = timeLine.split('-->').map(part => part.trim());
				const start = this.parseVttTime(startRaw);
				const end = this.parseVttTime(endRaw);
				const text = lines
					.filter(line => line !== timeLine && !/^\d+$/.test(line))
					.join(' ')
					.replace(/\n+/g, ' ')
					.trim();
				if (!text || start == null || end == null) continue;
				cues.push({
					id: `cue_${index++}`,
					start,
					end,
					text: this.decodeEntities(text),
				});
			}
			if (cues.length) return cues;
		}

		const cues: Array<{ id: string; start: number; end: number; text: string }> = [];
		const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
		let match: RegExpExecArray | null;
		let index = 0;
		while ((match = re.exec(trimmed))) {
			const attrs = match[1] || '';
			const start = Number(/start="([^"]+)"/i.exec(attrs)?.[1] || 0);
			const dur = Number(/dur="([^"]+)"/i.exec(attrs)?.[1] || 2);
			const text = this.decodeEntities(this.stripTags(match[2] || ''))
				.replace(/\n+/g, ' ')
				.trim();
			if (!text) continue;
			cues.push({
				id: `cue_${index++}`,
				start: Number(start.toFixed(3)),
				end: Number((start + Math.max(dur, 0.4)).toFixed(3)),
				text,
			});
		}
		return cues;
	}

	private parseVttTime(value: string): number | null {
		const raw = String(value || '').split(/\s+/)[0];
		const parts = raw.split(':');
		if (parts.length < 2) return null;
		const hours = parts.length === 3 ? Number(parts[0]) : 0;
		const minutes = Number(parts.length === 3 ? parts[1] : parts[0]);
		const seconds = Number((parts.length === 3 ? parts[2] : parts[1]).replace(',', '.'));
		if ([hours, minutes, seconds].some(n => Number.isNaN(n))) return null;
		return Number((hours * 3600 + minutes * 60 + seconds).toFixed(3));
	}
}
