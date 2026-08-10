import {
	BadRequestException,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LearningState } from 'entities/learning.entity';
import { AiFreeService } from '../ai-free/ai-free.service';
import { LearningAiDto, LearningImportUrlDto, LearningSearchRoadmapsDto, LearningTranslateDto } from './dto/learning.dto';
import { LearningUrlFetchService } from './learning-url-fetch.service';
import { buildRoadmapFromOfficialGraph } from './learning-roadmap-official.util';
import { MetaWhatsAppTranslateService } from '../meta-whatsapp/services/meta-whatsapp-translate.service';

const ACTIVITY_MAX = 80;

function asArray(v: unknown): any[] {
	return Array.isArray(v) ? v : [];
}

function asObject(v: unknown): Record<string, any> {
	return v && typeof v === 'object' && !Array.isArray(v)
		? (v as Record<string, any>)
		: {};
}

function emptyState() {
	return {
		paths: [] as any[],
		inbox: [] as any[],
		activity: [] as any[],
		stats: {
			streakDays: 0,
			lastLearnDate: null,
			minutesThisWeek: 0,
			totalSessions: 0,
		} as Record<string, any>,
		continueLearning: null as Record<string, any> | null,
	};
}

@Injectable()
export class LearningService {
	constructor(
		@InjectRepository(LearningState)
		private readonly repo: Repository<LearningState>,
		private readonly aiFree: AiFreeService,
		private readonly urlFetch: LearningUrlFetchService,
		private readonly translateService: MetaWhatsAppTranslateService,
	) {}

	private userId(user: any): string {
		const id = user?.id;
		if (!id) throw new UnauthorizedException('Missing user id');
		return String(id);
	}

	private toDto(row: LearningState | null) {
		if (!row) return emptyState();
		return {
			paths: asArray(row.paths),
			inbox: asArray(row.inbox),
			activity: asArray(row.activity).slice(0, ACTIVITY_MAX),
			stats: {
				...emptyState().stats,
				...asObject(row.stats),
			},
			continueLearning:
				row.continueLearning && typeof row.continueLearning === 'object'
					? row.continueLearning
					: null,
			updatedAt: row.updated_at ?? null,
		};
	}

	private async getOrCreate(userId: string): Promise<LearningState> {
		let row = await this.repo.findOne({ where: { userId } });
		if (row) return row;
		row = this.repo.create({
			userId,
			...emptyState(),
		});
		return this.repo.save(row);
	}

	async getState(user: any) {
		const userId = this.userId(user);
		const row = await this.repo.findOne({ where: { userId } });
		return this.toDto(row);
	}

	async putState(user: any, body: any) {
		const userId = this.userId(user);
		const row = await this.getOrCreate(userId);
		const patch = body && typeof body === 'object' ? body : {};

		if ('paths' in patch) row.paths = this.slimPaths(asArray(patch.paths));
		if ('inbox' in patch) row.inbox = asArray(patch.inbox).slice(0, 80);
		if ('activity' in patch) {
			row.activity = asArray(patch.activity).slice(0, ACTIVITY_MAX);
		}
		if ('stats' in patch) row.stats = asObject(patch.stats);
		if ('continueLearning' in patch) {
			row.continueLearning =
				patch.continueLearning && typeof patch.continueLearning === 'object'
					? patch.continueLearning
					: null;
		}

		const saved = await this.repo.save(row);
		return this.toDto(saved);
	}

	/** Free MT batch (MyMemory → Google gtx). Used to persist Arabic learning content. */
	async translateTexts(user: any, dto: LearningTranslateDto) {
		this.userId(user);
		const targetLang = dto.targetLang === 'en' ? 'en' : 'ar';
		const items = Array.isArray(dto.items) ? dto.items : [];
		const out: Array<{
			id: string;
			translatedText: string;
			provider: string;
			sourceLang: string;
			targetLang: string;
		}> = [];

		for (let i = 0; i < items.length; i += 1) {
			const item = items[i];
			const id = String(item?.id || '').trim();
			const text = String(item?.text || '').trim();
			if (!id || !text) continue;
			try {
				const result = await this.translateService.translateLong(text, targetLang);
				out.push({
					id,
					translatedText: result.translatedText,
					provider: result.provider,
					sourceLang: result.sourceLang,
					targetLang: result.targetLang,
				});
			} catch {
				out.push({
					id,
					translatedText: text,
					provider: 'passthrough-error',
					sourceLang: 'en',
					targetLang,
				});
			}
			if (i < items.length - 1) {
				await new Promise(resolve => setTimeout(resolve, 80));
			}
		}

		return { ok: true, targetLang, items: out };
	}

	private slimPaths(paths: any[]) {
		return paths.map(path => {
			const item = asObject(path);
			const graph = asObject(item.roadmapGraph);
			return {
				...item,
				description: String(item.description || '').slice(0, 2000),
				roadmapGraph: item.roadmapGraph
					? {
							slug: String(graph.slug || ''),
							title: (() => {
								const raw = graph.title;
								if (typeof raw === 'string' && raw !== '[object Object]') return raw;
								if (raw && typeof raw === 'object') {
									return String(raw.page || raw.card || raw.title || '');
								}
								return '';
							})(),
							description: String(graph.description || '')
								.replace(/@currentYear@/g, String(new Date().getFullYear()))
								.slice(0, 800),
							nodes: asArray(graph.nodes).map(node => {
								const n = asObject(node);
								return {
									id: n.id,
									type: n.type,
									label: n.label,
									x: Number(n.x) || 0,
									y: Number(n.y) || 0,
									width: Number(n.width) || 160,
									height: Number(n.height) || 40,
								};
							}),
							edges: asArray(graph.edges).map(edge => {
								const e = asObject(edge);
								return {
									id: e.id,
									source: e.source,
									target: e.target,
									edgeStyle: e.edgeStyle || 'solid',
								};
							}),
						}
					: null,
				sections: asArray(item.sections).map(section => {
					const block = asObject(section);
					return {
						...block,
						topics: asArray(block.topics).map(topic => {
							const row = asObject(topic);
							const description = String(row.description || '')
								.replace(/@currentYear@/g, String(new Date().getFullYear()))
								.slice(0, 1200);
							const contentRaw = String(row.contentMarkdown || '').replace(
								/@currentYear@/g,
								String(new Date().getFullYear()),
							);
							return {
								...row,
								description,
								contentMarkdown:
									contentRaw && contentRaw !== description
										? contentRaw.slice(0, 20000)
										: description,
								primaryVideoUrl: String(row.primaryVideoUrl || '').slice(0, 500),
								keywords: asArray(row.keywords)
									.map(item => String(item || '').trim())
									.filter(Boolean)
									.slice(0, 16),
								tags: asArray(row.tags)
									.map(item => String(item || '').trim())
									.filter(Boolean)
									.slice(0, 16),
								takeaways: asArray(row.takeaways)
									.map(item => String(item || '').trim())
									.filter(Boolean)
									.slice(0, 10),
								examples: asArray(row.examples)
									.map(item => String(item || '').trim())
									.filter(Boolean)
									.slice(0, 8),
								resources: asArray(row.resources)
									.slice(0, 40)
									.map(resource => {
										const r = asObject(resource);
										return {
											id: r.id || r.url,
											title: r.title,
											url: r.url,
											type: r.type || 'article',
											source: r.source || '',
										};
									}),
								videoSuggestions: asArray(row.videoSuggestions)
									.slice(0, 12)
									.map(resource => {
										const r = asObject(resource);
										return {
											id: r.id || r.url,
											title: r.title,
											url: r.url,
											type: r.type || 'video',
											source: r.source || '',
										};
									}),
								lessonPacks: asArray(row.lessonPacks)
									.slice(0, 8)
									.map(pack => {
										const p = asObject(pack);
										return {
											id: p.id || p.slug || p.title,
											title: p.title,
											slug: p.slug || '',
											description: String(p.description || '').slice(0, 400),
											readingTime: Number(p.readingTime) || 0,
											lessonCount: Number(p.lessonCount) || 0,
											quizCount: Number(p.quizCount) || 0,
											projectCount: Number(p.projectCount) || 0,
											url: p.url || '',
										};
									}),
								studySuggestions: asArray(row.studySuggestions)
									.slice(0, 10)
									.map(item => {
										const suggestion = asObject(item);
										return {
											id: suggestion.id || suggestion.url,
											type: suggestion.type || 'search',
											title: suggestion.title,
											url: suggestion.url,
										};
									}),
								references: asArray(row.references)
									.slice(0, 20)
									.map(reference => {
										const r = asObject(reference);
										return {
											id: r.id || r.url,
											title: r.title,
											url: r.url,
											type: r.type || 'article',
											summary: String(r.summary || '').slice(0, 600),
											scrapedAt: r.scrapedAt || null,
										};
									}),
							};
						}),
					};
				}),
			};
		});
	}

	async fetchUrl(user: any, url: string) {
		this.userId(user);
		return this.urlFetch.fetch(url);
	}

	async fetchVideoTranscript(user: any, url: string) {
		this.userId(user);
		return this.urlFetch.fetchYoutubeTranscript(url);
	}

	async importFromUrl(user: any, dto: LearningImportUrlDto) {
		this.userId(user);
		const url = String(dto.url || '').trim();
		if (!url) throw new BadRequestException('URL is required');

		const page = await this.urlFetch.fetch(url);
		const mode = String(dto.mode || 'topic').trim() === 'roadmap' ? 'roadmap' : 'topic';
		const locale = String(dto.locale || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';

		const pageContext = {
			url: page.url,
			originalUrl: page.originalUrl,
			pageTitle: page.title,
			description: page.description,
			headings: page.headings,
			streamTopics: page.streamTopics,
			excerpt: page.excerpt,
			contentLength: page.contentLength,
		};

		if (mode === 'roadmap') {
			const goal = String(dto.goal || page.title || '').trim();
			const localeHint =
				locale === 'ar'
					? 'تم استيراد الخارطة الرسمية بالكامل مع الموارد.'
					: 'Official roadmap imported with modules, timing, and free resources.';

			if (page.officialRoadmap?.nodes?.length) {
				const nodeIds = (page.officialRoadmap.nodes as any[])
					.filter(
						node =>
							['topic', 'subtopic'].includes(String(node?.type || '')) &&
							String(node?.data?.label || '').trim(),
					)
					.map(node => String(node.id));
				const details = await this.urlFetch.fetchOfficialTopicDetails(
					String(page.roadmapSlug || ''),
					nodeIds,
				);
				const parsed = buildRoadmapFromOfficialGraph(page.officialRoadmap, details);
				return {
					ok: true,
					page: {
						url: page.url,
						originalUrl: page.originalUrl,
						title: page.title,
						description: page.description,
						roadmapSlug: page.roadmapSlug,
					},
					parsed,
					graph: parsed.graph,
					importSource: 'official',
					importHint: localeHint,
				};
			}

			let result = await this.aiAssist(user, {
				action: 'scrape_roadmap',
				prompt: goal,
				locale,
				context: pageContext,
				provider: dto.provider,
				model: dto.model,
				allowFallback: dto.allowFallback,
			});
			let parsed = this.normalizeRoadmapParsed(result?.parsed);

			if (!parsed?.sections?.length) {
				result = await this.aiAssist(user, {
					action: 'roadmap',
					prompt: goal,
					locale,
					context: { ...pageContext, goal },
					provider: dto.provider,
					model: dto.model,
					allowFallback: dto.allowFallback,
				});
				parsed = this.normalizeRoadmapParsed(result?.parsed);
			}

			let importSource: 'ai' | 'stream' = 'ai';
			if (!parsed?.sections?.length && page.streamTopics?.length) {
				parsed = this.normalizeRoadmapParsed(this.buildRoadmapFromStreamTopics(page, goal));
				if (parsed?.sections?.length) importSource = 'stream';
			}

			const ok = Boolean(parsed?.sections?.length);
			return {
				...result,
				page,
				parsed,
				graph: parsed?.graph || null,
				importSource: ok ? importSource : undefined,
				importError: ok ? undefined : 'roadmap_import_failed',
				importHint: ok
					? importSource === 'stream'
						? locale === 'ar'
							? 'تم استيراد الموضوعات من الصفحة مباشرة.'
							: 'Topics imported directly from the page.'
						: undefined
					: locale === 'ar'
						? page.streamTopics?.length
							? 'تعذر ترتيب الخارطة. جرّب مرة أخرى أو استخدم «توليد خارطة بالذكاء» من الهدف.'
							: 'الصفحة لا تحتوي محتوى كافٍ. استخدم رابط roadmap ثابت مثل https://roadmap.sh/ai-engineer'
						: page.streamTopics?.length
							? 'AI could not structure the roadmap. Retry or generate from your goal instead.'
							: 'Page has too little content. Use a static roadmap URL like https://roadmap.sh/ai-engineer',
			};
		}

		const topicTitle = String(dto.topicTitle || page.title || '').trim();
		const result = await this.aiAssist(user, {
			action: 'scrape_topic',
			prompt: topicTitle,
			locale,
			context: { ...pageContext, topicTitle },
			provider: dto.provider,
			model: dto.model,
			allowFallback: dto.allowFallback,
		});
		return { ...result, page };
	}

	async getOfficialTopicDetail(user: any, body: { slug?: string; nodeId?: string }) {
		this.userId(user);
		const slug = String(body?.slug || '').trim();
		const nodeId = String(body?.nodeId || '').trim();
		if (!slug || !nodeId) throw new BadRequestException('slug and nodeId are required');
		const detail = await this.urlFetch.fetchOfficialTopic(slug, nodeId);
		if (!detail) throw new BadRequestException('Topic detail not found');
		return detail;
	}

	async listOfficialRoadmapsCatalog(user: any) {
		this.userId(user);
		const catalog = await this.urlFetch.listOfficialRoadmaps();
		const popular = [
			'frontend',
			'backend',
			'full-stack',
			'ai-engineer',
			'ai-data-scientist',
			'devops',
			'android',
			'react',
			'nodejs',
			'python',
			'javascript',
			'typescript',
			'cyber-security',
			'data-analyst',
			'ux-design',
			'postgresql-dba',
			'docker',
			'kubernetes',
			'system-design',
			'software-architect',
		];
		const scored = (catalog as any[]).map(item => {
			const slug = String(item.slug || '');
			const popIndex = popular.indexOf(slug);
			return {
				...item,
				popular: popIndex >= 0,
				order: popIndex >= 0 ? popIndex : 1000 + slug.length,
			};
		});
		scored.sort((a, b) => a.order - b.order || String(a.title).localeCompare(String(b.title)));
		return {
			ok: true,
			items: scored.map(({ order, ...item }) => item),
			count: scored.length,
		};
	}

	async searchRoadmaps(user: any, dto: LearningSearchRoadmapsDto) {
		this.userId(user);
		const query = String(dto.query || '').trim();
		if (query.length < 2) throw new BadRequestException('Query is required');
		const locale = String(dto.locale || 'en').toLowerCase().startsWith('ar')
			? 'ar'
			: 'en';

		const enhanced = await this.enhanceSearchQuery(user, query, locale, dto);
		const searchTerms = [
			enhanced.searchQuery,
			enhanced.enhancedQuery,
			...(enhanced.keywords || []),
			query,
		]
			.map(item => String(item || '').trim())
			.filter(Boolean);

		const catalog = await this.urlFetch.listOfficialRoadmaps();
		const matches = this.rankOfficialRoadmaps(catalog as any[], searchTerms).slice(0, 12);
		const best = matches[0];
		const hasStrongOfficial = Boolean(best && best.score >= 0.38);

		if (hasStrongOfficial) {
			const refined =
				enhanced.enhancedQuery && enhanced.enhancedQuery !== query
					? locale === 'ar'
						? ` بعد تحسين البحث إلى «${enhanced.enhancedQuery}»`
						: ` after refining to "${enhanced.enhancedQuery}"`
					: '';
			return {
				ok: true,
				query,
				enhancedQuery: enhanced.enhancedQuery,
				keywords: enhanced.keywords,
				searchQuery: enhanced.searchQuery,
				mode: 'official',
				matches,
				webHits: [],
				generated: null,
				hint:
					locale === 'ar'
						? `لقينا خرائط رسمية مطابقة${refined}.`
						: `Found matching official roadmaps${refined}.`,
			};
		}

		const webQuery = enhanced.searchQuery || enhanced.enhancedQuery || query;
		const webHits = await this.urlFetch.searchWebRoadmaps(webQuery);
		const roadmapShHit = webHits.find(hit => /roadmap\.sh/i.test(hit.url));
		if (roadmapShHit) {
			const slug = this.urlFetch.roadmapShSlug(roadmapShHit.url);
			if (slug && !matches.some(item => item.slug === slug)) {
				const verified = await this.urlFetch.fetchOfficialRoadmap(slug);
				if (verified?.nodes?.length) {
					const titleRaw = verified.title;
					const title =
						typeof titleRaw === 'string'
							? titleRaw
							: String(titleRaw?.page || titleRaw?.card || slug);
					matches.unshift({
						slug,
						title,
						description: String(verified.description || '').slice(0, 400),
						type: 'roadmap',
						url: `https://roadmap.sh/${slug}`,
						relatedRoadmaps: [],
						score: 0.9,
					});
					return {
						ok: true,
						query,
						enhancedQuery: enhanced.enhancedQuery,
						keywords: enhanced.keywords,
						searchQuery: enhanced.searchQuery,
						mode: 'official',
						matches: matches.slice(0, 12),
						webHits,
						generated: null,
						hint:
							locale === 'ar'
								? 'لقينا خارطة على roadmap.sh من البحث على الويب بعد تحسين الكلمة المفتاحية.'
								: 'Found a roadmap.sh match via web search after keyword enhancement.',
					};
				}
			}
		}

		const ai = await this.aiAssist(user, {
			action: 'roadmap',
			prompt: enhanced.enhancedQuery || query,
			locale,
			context: {
				goal: enhanced.enhancedQuery || query,
				originalQuery: query,
				keywords: enhanced.keywords,
				webHits: webHits.slice(0, 5).map(hit => `${hit.title} — ${hit.url}`),
			},
			provider: dto.provider,
			model: dto.model,
			allowFallback: dto.allowFallback,
		});
		const generated = this.normalizeRoadmapParsed(ai?.parsed);

		return {
			ok: true,
			query,
			enhancedQuery: enhanced.enhancedQuery,
			keywords: enhanced.keywords,
			searchQuery: enhanced.searchQuery,
			mode: generated ? 'generated' : 'empty',
			matches,
			webHits,
			generated,
			hint:
				locale === 'ar'
					? generated
						? `مفيش تطابق قوي على roadmap.sh — حسّنا البحث إلى «${enhanced.enhancedQuery || query}» وعملنا خارطة من الويب والذكاء الاصطناعي.`
						: 'مقدرناش نلاقي خارطة مناسبة. جرّب صياغة تانية أو اختَر من الكروت الجاهزة.'
					: generated
						? `No strong roadmap.sh match — refined to "${enhanced.enhancedQuery || query}" and generated a roadmap from web + AI.`
						: 'Could not find a suitable roadmap. Try another query or pick from the catalog cards.',
		};
	}

	private async enhanceSearchQuery(
		user: any,
		query: string,
		locale: string,
		dto: LearningSearchRoadmapsDto,
	) {
		const fallback = {
			enhancedQuery: query,
			keywords: [query],
			searchQuery: `${query} learning roadmap`,
		};
		try {
			const ai = await this.aiAssist(user, {
				action: 'enhance_search_query',
				prompt: query,
				locale,
				provider: dto.provider,
				model: dto.model,
				allowFallback: dto.allowFallback !== false,
			});
			const parsed = ai?.parsed && typeof ai.parsed === 'object' ? ai.parsed : null;
			if (!parsed) return fallback;
			const enhancedQuery = String(parsed.enhancedQuery || parsed.query || query).trim() || query;
			const keywords = Array.isArray(parsed.keywords)
				? parsed.keywords
						.map((item: any) => String(item || '').trim())
						.filter(Boolean)
						.slice(0, 8)
				: [];
			const searchQuery =
				String(parsed.searchQuery || '').trim() ||
				`${enhancedQuery} learning roadmap curriculum`;
			return {
				enhancedQuery,
				keywords: keywords.length ? keywords : [enhancedQuery],
				searchQuery,
			};
		} catch {
			return fallback;
		}
	}

	private rankOfficialRoadmaps(catalog: any[], queryOrTerms: string | string[]) {
		const terms = (Array.isArray(queryOrTerms) ? queryOrTerms : [queryOrTerms])
			.map(item => this.normalizeSearchText(item))
			.filter(Boolean);
		const primary = terms[0] || '';
		const qTokens = [
			...new Set(terms.flatMap(term => term.split(' ').filter(token => token.length > 1))),
		];
		const slugGuess = primary.replace(/\s+/g, '-');

		return catalog
			.map(item => {
				const title = this.normalizeSearchText(item.title);
				const slug = this.normalizeSearchText(item.slug);
				const desc = this.normalizeSearchText(item.description);
				let score = 0;
				for (const q of terms) {
					const guess = q.replace(/\s+/g, '-');
					if (slug === q || slug === guess) score = Math.max(score, 1);
					else if (title === q) score = Math.max(score, 0.96);
					else if (slug.includes(guess) || guess.includes(slug)) score = Math.max(score, 0.88);
					else if (title.includes(q) || q.includes(title)) score = Math.max(score, 0.82);
				}
				if (score < 0.8) {
					const hay = `${title} ${slug} ${desc}`;
					const hit = qTokens.filter(token => hay.includes(token)).length;
					if (hit) {
						score = Math.max(
							score,
							Math.min(0.78, 0.28 + (hit / Math.max(qTokens.length, 1)) * 0.5),
						);
					}
				}
				if (score < 0.42 && slugGuess && (slug.includes(slugGuess) || title.includes(primary))) {
					score = Math.max(score, 0.55);
				}
				return score > 0.2 ? { ...item, score: Number(score.toFixed(3)) } : null;
			})
			.filter(Boolean)
			.sort((a: any, b: any) => b.score - a.score);
	}

	private normalizeSearchText(value: string) {
		return String(value || '')
			.toLowerCase()
			.replace(/[@#_./\\|+]+/g, ' ')
			.replace(/[^a-z0-9\u0600-\u06ff\s-]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	async aiAssist(user: any, dto: LearningAiDto) {
		const action = String(dto.action || 'assist').trim();
		const locale = String(dto.locale || 'en').toLowerCase().startsWith('ar')
			? 'ar'
			: 'en';
		const prompt = String(dto.prompt || '').trim();
		if (
			!prompt &&
			![
				'roadmap',
				'scrape_roadmap',
				'scrape_topic',
				'translate_transcript',
				'explain_term',
				'enhance_search_query',
			].includes(action)
		) {
			throw new BadRequestException('Prompt is required');
		}

		const system = this.buildSystemPrompt(action, locale, dto.context || {});
		const userMessage = this.buildUserPrompt(action, locale, prompt, dto);

		const result = await this.aiFree.chat(user, {
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: userMessage },
			],
			provider: dto.provider,
			model: dto.model,
			allowFallback: dto.allowFallback !== false,
			useProjectKnowledge: false,
		} as any);

		return {
			...result,
			action,
			parsed: this.tryParseJson(result?.reply),
		};
	}

	private buildSystemPrompt(
		action: string,
		locale: string,
		context: Record<string, any>,
	) {
		const lang =
			locale === 'ar'
				? 'Respond in Arabic when the user writes Arabic; otherwise English.'
				: 'Respond in clear English unless the user writes Arabic.';
		const topicBits = [
			context.topicTitle ? `Topic: ${context.topicTitle}` : '',
			context.pathTitle ? `Learning path: ${context.pathTitle}` : '',
			context.contentExcerpt
				? `Content excerpt:\n${String(context.contentExcerpt).slice(0, 4000)}`
				: '',
		]
			.filter(Boolean)
			.join('\n');

		const base = `You are an expert learning coach inside So7baFit Learning OS.
${lang}
Be precise, practical, and structured. Prefer bullet points and short sections.
Never invent fake URLs. Mark uncertainty clearly.
${topicBits ? `\nContext:\n${topicBits}` : ''}`;

		if (action === 'roadmap') {
			return `${base}

When asked for a roadmap, reply with ONLY valid JSON (no markdown fences) shaped as:
{
  "title": string,
  "description": string,
  "category": string,
  "difficulty": "beginner"|"intermediate"|"advanced",
  "estimatedHours": number,
  "tags": string[],
  "sections": [
    {
      "title": string,
      "topics": [
        { "title": string, "description": string, "estimatedMinutes": number, "difficulty": "beginner"|"intermediate"|"advanced" }
      ]
    }
  ]
}`;
		}

		if (action === 'questions') {
			return `${base}

Reply with ONLY valid JSON:
{
  "questions": [
    {
      "type": "multiple_choice"|"true_false"|"short_answer"|"open"|"scenario",
      "difficulty": "easy"|"medium"|"hard",
      "prompt": string,
      "options": string[],
      "answer": string,
      "explanation": string
    }
  ]
}`;
		}

		if (action === 'flashcards') {
			return `${base}

Reply with ONLY valid JSON:
{
  "cards": [
    { "front": string, "back": string, "difficulty": "easy"|"medium"|"hard" }
  ]
}`;
		}

		if (action === 'summary') {
			return `${base}

Reply with ONLY valid JSON:
{
  "tldr": string,
  "keyConcepts": string[],
  "terms": [{ "term": string, "definition": string }],
  "remember": string[],
  "takeaways": string[]
}`;
		}

		if (action === 'scrape_topic') {
			return `${base}

You receive scraped web page content about a learning topic.
Extract structured study material. Reply with ONLY valid JSON:
{
  "title": string,
  "description": string,
  "contentMarkdown": string,
  "summary": {
    "tldr": string,
    "keyConcepts": string[],
    "terms": [{ "term": string, "definition": string }],
    "remember": string[],
    "takeaways": string[]
  },
  "suggestedResources": [{ "title": string, "url": string, "type": "article"|"video"|"docs"|"github"|"other" }],
  "cards": [{ "type": "ticket"|"rich", "title": string, "body": string }]
}
Use markdown in contentMarkdown. Create 3-8 useful cards (mix ticket notes and rich detail cards).`;
		}

		if (action === 'scrape_roadmap') {
			return `${base}

You receive scraped content from a roadmap or curriculum page.
Convert it into a structured learning roadmap. Reply with ONLY valid JSON:
{
  "title": string,
  "description": string,
  "category": string,
  "difficulty": "beginner"|"intermediate"|"advanced",
  "estimatedHours": number,
  "tags": string[],
  "sections": [
    {
      "title": string,
      "topics": [
        { "title": string, "description": string, "estimatedMinutes": number, "difficulty": "beginner"|"intermediate"|"advanced" }
      ]
    }
  ]
}
Preserve the original order and scope from the page when possible.`;
		}

		if (action === 'translate_transcript') {
			return `${base}

Translate YouTube transcript cues into clear Arabic for learners.
Reply with ONLY valid JSON:
{
  "cues": [{ "id": string, "textAr": string }]
}
Keep the same cue ids. Preserve technical terms in English in parentheses when helpful.
Do not invent extra cues.`;
		}

		if (action === 'explain_term') {
			return `${base}

Explain a selected technical term or phrase in the context of this learning path/topic.
Reply with ONLY valid JSON:
{
  "term": string,
  "meaning": string,
  "inThisDomain": string,
  "simpleExample": string,
  "relatedTerms": string[]
}
Be concise and practical. If locale is Arabic, write the explanation in Arabic.`;
		}

		if (action === 'enhance_search_query') {
			return `You improve learning-roadmap search queries.
Always reply with ONLY valid JSON (no markdown fences):
{
  "enhancedQuery": string,
  "keywords": string[],
  "searchQuery": string
}
Rules:
- enhancedQuery: clearer English topic name (e.g. marketing -> digital marketing)
- keywords: 3-6 high-signal search terms (skills, roles, domains)
- searchQuery: best web search string to find learning roadmaps / curricula
- Prefer roadmap.sh style topics when relevant (frontend, backend, AI engineer, etc.)
- Keep it short and searchable. Do not invent URLs.`;
		}

		return base;
	}

	private buildUserPrompt(
		action: string,
		locale: string,
		prompt: string,
		dto: LearningAiDto,
	) {
		if (action === 'roadmap') {
			const ctx = dto.context || {};
			const topics = Array.isArray(ctx.streamTopics) ? ctx.streamTopics : [];
			const topicBlock = topics.length
				? `\n\nTopics extracted from source page (preserve order, group into logical sections):\n${topics
						.slice(0, 120)
						.map((item: string) => `- ${item}`)
						.join('\n')}`
				: '';
			const webBlock = Array.isArray(ctx.webHits) && ctx.webHits.length
				? `\n\nRelevant web references (use for structure inspiration; do not invent URLs beyond these):\n${ctx.webHits
						.slice(0, 8)
						.map((item: string) => `- ${item}`)
						.join('\n')}`
				: '';
			return `Create a personal learning roadmap for this goal:\n${prompt || ctx.goal || ''}${topicBlock}${webBlock}`;
		}
		if (action === 'questions') {
			return `Generate 6 practice questions (mix of types) for this topic:\n${prompt}`;
		}
		if (action === 'flashcards') {
			return `Generate 8 flashcards for this topic:\n${prompt}`;
		}
		if (action === 'summary') {
			return `Create a study summary for:\n${prompt}`;
		}
		if (action === 'scrape_topic') {
			const ctx = dto.context || {};
			return `Topic focus: ${ctx.topicTitle || prompt || 'General topic'}
Source URL: ${ctx.url || 'unknown'}
Page title: ${ctx.pageTitle || ''}
Headings: ${(ctx.headings || []).join(' · ')}
Description: ${ctx.description || ''}

Page content excerpt:
${ctx.excerpt || ''}`;
		}
		if (action === 'scrape_roadmap') {
			const ctx = dto.context || {};
			const topics = Array.isArray(ctx.streamTopics) ? ctx.streamTopics : [];
			const topicBlock = topics.length
				? `\n\nTopics extracted from source page (preserve order, group into logical sections):\n${topics
						.slice(0, 150)
						.map((item: string) => `- ${item}`)
						.join('\n')}`
				: '';
			return `Learning goal: ${prompt || ctx.pageTitle || 'Imported roadmap'}
Source URL: ${ctx.url || 'unknown'}${ctx.originalUrl && ctx.originalUrl !== ctx.url ? ` (requested: ${ctx.originalUrl})` : ''}
Page title: ${ctx.pageTitle || ''}
Headings: ${(ctx.headings || []).join(' · ')}
Description: ${ctx.description || ''}
Extracted topic count: ${topics.length}${topicBlock}

			Page content excerpt:
${ctx.excerpt || ''}`;
		}
		if (action === 'translate_transcript') {
			const ctx = dto.context || {};
			const cues = Array.isArray(ctx.cues) ? ctx.cues : [];
			const chunk = cues
				.slice(0, 180)
				.map((cue: any) => `- ${cue.id}: ${String(cue.text || '').slice(0, 280)}`)
				.join('\n');
			return `Translate these transcript cues to Arabic.\nTarget language: ar\n${prompt || ''}\n\nCues:\n${chunk}`;
		}
		if (action === 'explain_term') {
			const ctx = dto.context || {};
			return `Explain this selected term/phrase for a learner.
Term: ${prompt || ctx.term || ''}
Learning path: ${ctx.pathTitle || ''}
Topic: ${ctx.topicTitle || ''}
Domain/category: ${ctx.category || ''}
Surrounding transcript: ${String(ctx.surrounding || '').slice(0, 800)}
Locale: ${locale}`;
		}
		if (action === 'enhance_search_query') {
			return `Improve this learning roadmap search query for better official + web matches.
Original query: ${prompt}
Return clearer topic naming and strong search keywords.`;
		}
		return prompt;
	}

	private tryParseJson(text: unknown) {
		const raw = String(text || '').trim();
		if (!raw) return null;
		const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
		const candidate = fenced || raw;
		try {
			return JSON.parse(candidate);
		} catch {
			const start = candidate.indexOf('{');
			const end = candidate.lastIndexOf('}');
			if (start >= 0 && end > start) {
				try {
					return JSON.parse(candidate.slice(start, end + 1));
				} catch {
					return null;
				}
			}
			return null;
		}
	}

	private normalizeRoadmapParsed(parsed: unknown) {
		const root = asObject(parsed);
		const sections = asArray(root.sections)
			.map(section => {
				const block = asObject(section);
				const topics = asArray(block.topics)
					.map(topic => {
						if (typeof topic === 'string') {
							return {
								title: topic.trim(),
								description: '',
								estimatedMinutes: 45,
								difficulty: 'beginner',
							};
						}
						const row = asObject(topic);
						const title = String(row.title || '').trim();
						if (!title) return null;
						return {
							title,
							description: String(row.description || '').trim(),
							contentMarkdown: String(row.contentMarkdown || row.description || '').trim(),
							primaryVideoUrl: String(row.primaryVideoUrl || '').trim(),
							estimatedMinutes: Number(row.estimatedMinutes) || 45,
							difficulty: row.difficulty || 'beginner',
							sourceNodeId: String(row.sourceNodeId || ''),
							nodeType: String(row.nodeType || 'topic'),
							keywords: asArray(row.keywords)
								.map(item => String(item || '').trim())
								.filter(Boolean)
								.slice(0, 16),
							tags: asArray(row.tags)
								.map(item => String(item || '').trim())
								.filter(Boolean)
								.slice(0, 16),
							takeaways: asArray(row.takeaways)
								.map(item => String(item || '').trim())
								.filter(Boolean)
								.slice(0, 10),
							examples: asArray(row.examples)
								.map(item => String(item || '').trim())
								.filter(Boolean)
								.slice(0, 8),
							resources: asArray(row.resources)
								.map(item => {
									const resource = asObject(item);
									const url = String(resource.url || '').trim();
									const resourceTitle = String(resource.title || '').trim();
									if (!url || !resourceTitle) return null;
									return {
										id: String(resource.id || url),
										title: resourceTitle,
										url,
										type: String(resource.type || 'article'),
										source: String(resource.source || 'import'),
									};
								})
								.filter(Boolean),
							videoSuggestions: asArray(row.videoSuggestions)
								.map(item => {
									const resource = asObject(item);
									const url = String(resource.url || '').trim();
									const resourceTitle = String(resource.title || '').trim();
									if (!url || !resourceTitle) return null;
									return {
										id: String(resource.id || url),
										title: resourceTitle,
										url,
										type: String(resource.type || 'video'),
										source: String(resource.source || 'roadmap.sh'),
									};
								})
								.filter(Boolean),
							lessonPacks: asArray(row.lessonPacks)
								.map(item => {
									const pack = asObject(item);
									const packTitle = String(pack.title || '').trim();
									if (!packTitle) return null;
									return {
										id: String(pack.id || pack.slug || packTitle),
										title: packTitle,
										slug: String(pack.slug || ''),
										description: String(pack.description || '').trim(),
										readingTime: Number(pack.readingTime) || 0,
										lessonCount: Number(pack.lessonCount) || 0,
										quizCount: Number(pack.quizCount) || 0,
										projectCount: Number(pack.projectCount) || 0,
										url: String(pack.url || '').trim(),
									};
								})
								.filter(Boolean),
							studySuggestions: asArray(row.studySuggestions)
								.map(item => {
									const suggestion = asObject(item);
									const suggestionTitle = String(suggestion.title || '').trim();
									const url = String(suggestion.url || '').trim();
									if (!suggestionTitle || !url) return null;
									return {
										id: String(suggestion.id || url),
										type: String(suggestion.type || 'search'),
										title: suggestionTitle,
										url,
									};
								})
								.filter(Boolean),
							references: asArray(row.references),
						};
					})
					.filter(Boolean);
				const title = String(block.title || '').trim() || 'Section';
				return topics.length
					? {
							title,
							sourceNodeId: String(block.sourceNodeId || ''),
							estimatedMinutes:
								Number(block.estimatedMinutes) ||
								topics.reduce((sum: number, topic: any) => sum + (Number(topic.estimatedMinutes) || 0), 0),
							estimatedHours: Number(block.estimatedHours) || undefined,
							groupLabels: asArray(block.groupLabels).map(item => String(item)).filter(Boolean),
							topics,
						}
					: null;
			})
			.filter(Boolean);
		if (!sections.length) return null;
		return {
			title: String(root.title || '').trim(),
			description: String(root.description || '').trim(),
			category: String(root.category || 'General').trim(),
			difficulty: root.difficulty || 'intermediate',
			estimatedHours: Number(root.estimatedHours) || Math.max(1, Math.ceil(sections.length * 2)),
			tags: asArray(root.tags).map(item => String(item)).filter(Boolean),
			sections,
			graph: root.graph && typeof root.graph === 'object' ? root.graph : null,
		};
	}

	private buildRoadmapFromStreamTopics(
		page: {
			title?: string;
			description?: string;
			streamTopics?: string[];
		},
		goal: string,
	) {
		const topics = asArray(page.streamTopics)
			.map(item => String(item || '').trim())
			.filter(Boolean);
		if (!topics.length) return null;

		const isSectionHeader = (title: string) => {
			const t = title.trim();
			if (/\(one of these\)/i.test(t)) return true;
			if (
				/^(introduction|overview|pre-requisites|pre-requisite|fundamentals|core llm elements|development tools)$/i.test(
					t,
				)
			) {
				return true;
			}
			if (/roadmap$/i.test(t) && t.length < 50) return true;
			if (/^(frontend|backend|full-stack)$/i.test(t)) return true;
			return false;
		};

		const sections: Array<{
			title: string;
			sourceNodeId: string;
			estimatedMinutes: number;
			estimatedHours: number;
			groupLabels: string[];
			topics: any[];
		}> = [];
		let current: {
			title: string;
			sourceNodeId: string;
			estimatedMinutes: number;
			estimatedHours: number;
			groupLabels: string[];
			topics: any[];
		} | null = null;

		const makeSection = (title: string) => ({
			title,
			sourceNodeId: '',
			estimatedMinutes: 0,
			estimatedHours: 0,
			groupLabels: [] as string[],
			topics: [] as any[],
		});

		const pushTopic = (title: string) => {
			if (!current) current = makeSection('Getting started');
			current.topics.push({
				title,
				description: '',
				contentMarkdown: '',
				estimatedMinutes: 45,
				difficulty: 'beginner',
				sourceNodeId: '',
				nodeType: 'topic',
				resources: [],
				references: [],
				keywords: [],
				tags: [],
				takeaways: [],
				examples: [],
				videoSuggestions: [],
				lessonPacks: [],
				studySuggestions: [],
				primaryVideoUrl: '',
			});
		};

		for (const title of topics) {
			if (isSectionHeader(title)) {
				if (current?.topics.length) {
					current.estimatedMinutes = current.topics.length * 45;
					current.estimatedHours = Math.max(
						0.5,
						Math.round((current.estimatedMinutes / 60) * 10) / 10,
					);
					sections.push(current);
				}
				current = makeSection(title);
				continue;
			}
			pushTopic(title);
		}
		if (current?.topics.length) {
			current.estimatedMinutes = current.topics.length * 45;
			current.estimatedHours = Math.max(
				0.5,
				Math.round((current.estimatedMinutes / 60) * 10) / 10,
			);
			sections.push(current);
		}

		if (!sections.length) {
			for (let index = 0; index < topics.length; index += 10) {
				const chunk = topics.slice(index, index + 10);
				const sectionTopics = chunk.map(title => ({
					title,
					description: '',
					contentMarkdown: '',
					estimatedMinutes: 45,
					difficulty: 'beginner',
					sourceNodeId: '',
					nodeType: 'topic',
					resources: [],
					references: [],
					keywords: [],
					tags: [],
					takeaways: [],
					examples: [],
					videoSuggestions: [],
					lessonPacks: [],
					studySuggestions: [],
					primaryVideoUrl: '',
				}));
				sections.push({
					title: `Section ${Math.floor(index / 10) + 1}`,
					sourceNodeId: '',
					estimatedMinutes: sectionTopics.length * 45,
					estimatedHours: Math.max(
						0.5,
						Math.round(((sectionTopics.length * 45) / 60) * 10) / 10,
					),
					groupLabels: [],
					topics: sectionTopics,
				});
			}
		}

		return {
			title: page.title || goal || 'Imported roadmap',
			description: page.description || '',
			category: 'General',
			difficulty: 'intermediate',
			estimatedHours: Math.max(1, Math.ceil(topics.length * 0.75)),
			tags: [],
			sections,
			graph: null,
		};
	}
}
