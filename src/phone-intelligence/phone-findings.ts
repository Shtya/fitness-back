/** Extract actionable public signals from titles/snippets (never proof of ownership). */

const LOCATION_RE =
	/\b(Cairo|Giza|Alexandria|Maadi|Nasr City|Heliopolis|Dokki|Zamalek|New Cairo|6th of October|Sheikh Zayed|Mansoura|Tanta|Riyadh|Jeddah|Dammam|Dubai|Abu Dhabi|Sharjah|Amman|Kuwait|Doha|Manama|London|New York|القاهرة|الجيزة|الإسكندرية|المعادي|مدينة نصر|مصر الجديدة|الدقي|الزمالك|التجمع|الشيخ زايد|الرياض|جدة|دبي|أبوظبي|عمان|الكويت)\b/gi;

const ACTIVITY_RE =
	/\b(gym|fitness|coach|clinic|doctor|real.?estate|delivery|sales|marketing|support|whatsapp|call.?center|company|agency|studio|salon|restaurant|cafe|shop|store|telemarketer|spam|scam|advertising|نادي|جيم|مدرب|عيادة|دكتور|عقارات|توصيل|مبيعات|تسويق|دعم|شركة|وكالة|استوديو|صالون|مطعم|كافيه|محل|دعاية|إزعاج|احتيال)\b/gi;

const NOISE_NAME_RE =
	/search|results|google|duckduckgo|manual|facebook|instagram|linkedin|twitter|tiktok|youtube|home|contact|login|phone|number|رقم|هاتف|موبايل|truecaller|getcontact|should.?i.?answer|who.?calls|tellows|الرجاء|اخت[يی]ار|من المتصل|تفاصيل|تعليق|مستخدم|pagination|videoh|score|اختيار|please\s*select|choose|select\s*option|who\s*is\s*calling|من\s*المتصل\s*من/i;

export type FindingName = {
	label: string;
	sourceUrl?: string | null;
	confidence: number;
	source?: string | null;
};

export type FindingHighlight = {
	label: string;
	value: string;
	source: string;
	sourceUrl?: string | null;
	kind: 'name' | 'location' | 'score' | 'activity' | 'note' | 'carrier' | 'other';
};

export type CollectedFindings = {
	names: FindingName[];
	locations: string[];
	activities: string[];
	scores: Array<{ label: string; value: string; sourceUrl?: string | null }>;
	highlights: FindingHighlight[];
	mentions: Array<{
		title: string;
		snippet: string | null;
		sourceUrl: string | null;
		possibleName: string | null;
		sourceType: string | null;
		confidenceScore: number;
	}>;
};

export function extractLocations(...texts: Array<string | null | undefined>): string[] {
	const found = new Set<string>();
	for (const text of texts) {
		if (!text) continue;
		const matches = String(text).match(LOCATION_RE) || [];
		for (const m of matches) found.add(m.trim());
	}
	return [...found].slice(0, 12);
}

export function extractActivities(...texts: Array<string | null | undefined>): string[] {
	const found = new Set<string>();
	for (const text of texts) {
		if (!text) continue;
		const matches = String(text).match(ACTIVITY_RE) || [];
		for (const m of matches) found.add(m.trim().toLowerCase());
	}
	return [...found].slice(0, 12);
}

export function extractScore(...texts: Array<string | null | undefined>): string | null {
	for (const text of texts) {
		if (!text) continue;
		const patterns = [
			/tellows\s*score[^0-9]{0,24}(\d{1,2})/i,
			/score\s*(?:للرقم|for(?:\s+the)?\s+number)?\s*[:：]?\s*(\d{1,2})/i,
			/درجة\s*(?:الخطر|الثقة)?\s*[:：]?\s*(\d{1,2})/i,
		];
		for (const re of patterns) {
			const m = String(text).match(re);
			if (m?.[1]) {
				const n = Number(m[1]);
				if (n >= 1 && n <= 9) return String(n);
			}
		}
	}
	return null;
}

/** Best-effort public name guess from title/snippet text. */
export function extractPossibleNameFromText(
	...texts: Array<string | null | undefined>
): string | null {
	const combined = texts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
	if (!combined) return null;

	const labeled = combined.match(
		/(?:اسم(?:\s*المتصل)?|caller\s*name|owner|صاحب|باسم|named|classified as)\s*[:：\-–—]\s*([^\n,|.]{2,60})/i,
	);
	if (labeled?.[1]) {
		const v = cleanNameCandidate(labeled[1]);
		if (v) return v;
	}

	// Prefer Arabic person-like chunks but skip UI chrome
	const arabicChunks = combined.match(/([\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,}){1,4})/g) || [];
	for (const chunk of arabicChunks) {
		const v = cleanNameCandidate(chunk);
		if (v) return v;
	}

	const latin = combined.match(
		/\b([A-Z][a-zA-Z'’-]{1,30}(?:\s+[A-Z][a-zA-Z'’-]{1,30}){1,3})\b/,
	);
	if (latin?.[1]) {
		const v = cleanNameCandidate(latin[1]);
		if (v) return v;
	}

	return null;
}

function cleanNameCandidate(raw: string): string | null {
	const value = String(raw || '')
		.replace(/["'“”«»]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!value || value.length < 3 || value.length > 80) return null;
	if (NOISE_NAME_RE.test(value)) return null;
	if (/^\d+$/.test(value)) return null;
	if (/^من\s/.test(value)) return null;
	if (/css|margin|padding|float|webkit|slider/i.test(value)) return null;
	return value;
}

/** Parse pretty directory signals (tellows-style titles, etc.). */
export function parseDirectorySignals(input: {
	title?: string | null;
	snippet?: string | null;
	text?: string | null;
	url?: string | null;
	sourceName?: string | null;
	tellowsScore?: string | number | null;
	namesFound?: string[] | null;
}) {
	const title = input.title || '';
	const snippet = input.snippet || '';
	const text = input.text || '';
	const blob = `${title} ${snippet} ${text}`;
	const source = input.sourceName || hostFromUrl(input.url) || 'public';

	const locations = extractLocations(title, snippet, text);
	const activities = extractActivities(title, snippet, text);
	const score =
		(input.tellowsScore != null ? String(input.tellowsScore) : null) ||
		extractScore(title, snippet, text);

	const names: string[] = [];
	for (const n of input.namesFound || []) {
		const cleaned = cleanNameCandidate(String(n));
		if (cleaned) names.push(cleaned);
	}
	const guessed = extractPossibleNameFromText(title, snippet, text.slice(0, 1500));
	if (guessed) names.push(guessed);

	// Title like: "...? Cairo, القاهرة | tellows score للرقم: 5"
	const titleLoc = title.match(/\?\s*([^|]+)\|/);
	if (titleLoc?.[1]) {
		for (const loc of extractLocations(titleLoc[1])) locations.push(loc);
	}

	const uniqueNames = [...new Set(names)];
	const uniqueLocs = [...new Set(locations)];
	const uniqueActs = [...new Set(activities)];

	const highlights: FindingHighlight[] = [];
	if (uniqueNames[0]) {
		highlights.push({
			label: 'Possible name',
			value: uniqueNames[0],
			source,
			sourceUrl: input.url || null,
			kind: 'name',
		});
	}
	if (uniqueLocs[0]) {
		highlights.push({
			label: 'Location',
			value: uniqueLocs.slice(0, 3).join(', '),
			source,
			sourceUrl: input.url || null,
			kind: 'location',
		});
	}
	if (score) {
		highlights.push({
			label: 'Community score',
			value: score,
			source,
			sourceUrl: input.url || null,
			kind: 'score',
		});
	}
	if (uniqueActs[0]) {
		highlights.push({
			label: 'Activity',
			value: uniqueActs.slice(0, 3).join(', '),
			source,
			sourceUrl: input.url || null,
			kind: 'activity',
		});
	}

	// Keep a short useful summary line from title (without noise)
	const summary = cleanSummary(title);
	if (summary && highlights.length < 6) {
		highlights.push({
			label: 'Public note',
			value: summary,
			source,
			sourceUrl: input.url || null,
			kind: 'note',
		});
	}

	return {
		names: uniqueNames,
		locations: uniqueLocs,
		activities: uniqueActs,
		score,
		highlights,
		possibleName: uniqueNames[0] || null,
	};
}

function cleanSummary(title: string): string | null {
	const value = String(title || '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!value || value.length < 12) return null;
	if (/css|margin|padding|float|webkit/i.test(value)) return null;
	// Prefer the informative middle of tellows titles
	const cut = value.length > 140 ? `${value.slice(0, 140)}…` : value;
	return cut;
}

function hostFromUrl(url?: string | null): string | null {
	if (!url) return null;
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
}

export function summarizeHitsForDebug(
	hits: Array<{
		title?: string | null;
		snippet?: string | null;
		sourceUrl?: string | null;
		possibleName?: string | null;
		confidenceScore?: number;
		provider?: string;
	}>,
	queries?: string[],
) {
	const enriched = hits.map(h => {
		const signals = parseDirectorySignals({
			title: h.title,
			snippet: h.snippet,
			url: h.sourceUrl,
			namesFound: h.possibleName ? [h.possibleName] : [],
		});
		return { hit: h, signals };
	});

	const names = [
		...new Set(enriched.flatMap(e => e.signals.names).filter(Boolean)),
	].slice(0, 12);
	const locations = [
		...new Set(enriched.flatMap(e => e.signals.locations)),
	].slice(0, 8);
	const scores = enriched
		.map(e => e.signals.score)
		.filter(Boolean)
		.slice(0, 5) as string[];

	return {
		queries: (queries || []).slice(0, 8),
		hitCount: hits.length,
		namesFound: names,
		locationsFound: locations,
		scoresFound: scores,
		highlights: enriched.flatMap(e => e.signals.highlights).slice(0, 12),
		hits: hits.slice(0, 15).map(h => {
			const signals = parseDirectorySignals({
				title: h.title,
				snippet: h.snippet,
				url: h.sourceUrl,
				namesFound: h.possibleName ? [h.possibleName] : [],
			});
			return {
				title: h.title,
				snippet: h.snippet ? String(h.snippet).slice(0, 280) : null,
				url: h.sourceUrl,
				possibleName: signals.possibleName || h.possibleName || null,
				locations: signals.locations,
				score: signals.score,
				confidence: h.confidenceScore ?? null,
				provider: h.provider || null,
			};
		}),
	};
}

/** Pull pretty cards out of badge/searchTarget responses. */
export function collectSignalsFromSearchTargets(
	targets: Array<{ id?: string; labelEn?: string; response?: Record<string, any> | null }>,
): CollectedFindings {
	const base = emptyFindings();
	for (const t of targets || []) {
		const res = t.response;
		if (!res || res.real === false) continue;

		const hitList = Array.isArray(res.hits) ? res.hits : [];
		const pageList = Array.isArray(res.pages) ? res.pages : [];
		const pageFetch = Array.isArray(res.pageFetch) ? res.pageFetch : [];
		const rows = [...hitList, ...pageList, ...pageFetch];

		if (!rows.length && (res.url || res.bodyPreview || res.tellowsScore)) {
			rows.push({
				title: res.note || t.labelEn || 'Source',
				snippet: typeof res.bodyPreview === 'string' ? res.bodyPreview.slice(0, 280) : null,
				url: res.url,
				possibleName: Array.isArray(res.namesFound) ? res.namesFound[0] : null,
			});
		}

		for (const row of rows) {
			const signals = parseDirectorySignals({
				title: row.title,
				snippet: row.snippet,
				text: typeof res.bodyPreview === 'string' ? res.bodyPreview : '',
				url: row.url || res.url,
				sourceName: t.labelEn || hostFromUrl(row.url || res.url),
				tellowsScore: res.tellowsScore,
				namesFound: [
					...(Array.isArray(res.namesFound) ? res.namesFound : []),
					row.possibleName,
				].filter(Boolean),
			});
			mergeSignalsInto(base, signals, row.url || res.url, t.labelEn);
		}

		// Direct fields on response
		if (Array.isArray(res.locationsFound)) {
			for (const loc of res.locationsFound) base.locations.add(String(loc));
		}
		if (Array.isArray(res.scoresFound)) {
			for (const sc of res.scoresFound) {
				base.scores.push({
					label: 'Community score',
					value: String(sc),
					sourceUrl: res.url || null,
				});
			}
		}
		if (Array.isArray(res.highlights)) {
			for (const h of res.highlights) {
				if (h?.value) base.highlights.push(h as FindingHighlight);
			}
		}
	}

	return finalizeFindings(base);
}

export function collectFindings(
	hits: Array<{
		title?: string | null;
		snippet?: string | null;
		possibleName?: string | null;
		sourceUrl?: string | null;
		sourceType?: string | null;
		confidenceScore?: number;
	}>,
): CollectedFindings {
	const base = emptyFindings();

	for (const hit of hits) {
		const title = hit.title || '';
		const snippet = hit.snippet || '';
		const signals = parseDirectorySignals({
			title,
			snippet,
			url: hit.sourceUrl,
			namesFound: hit.possibleName ? [hit.possibleName] : [],
		});
		mergeSignalsInto(base, signals, hit.sourceUrl, hostFromUrl(hit.sourceUrl));

		if (title && !/manual|search yellow/i.test(title)) {
			base.mentions.push({
				title,
				snippet: hit.snippet || null,
				sourceUrl: hit.sourceUrl || null,
				possibleName: signals.possibleName || null,
				sourceType: hit.sourceType || null,
				confidenceScore: hit.confidenceScore || 0.3,
			});
		}
	}

	return finalizeFindings(base);
}

export function mergeFindings(
	a: CollectedFindings,
	b: CollectedFindings,
): CollectedFindings {
	const base = emptyFindings();
	for (const n of [...(a.names || []), ...(b.names || [])]) {
		const key = n.label.toLowerCase();
		const prev = base.namesMap.get(key);
		if (!prev || n.confidence > prev.confidence) base.namesMap.set(key, n);
	}
	for (const loc of [...(a.locations || []), ...(b.locations || [])]) base.locations.add(loc);
	for (const act of [...(a.activities || []), ...(b.activities || [])]) base.activities.add(act);
	base.scores.push(...(a.scores || []), ...(b.scores || []));
	base.highlights.push(...(a.highlights || []), ...(b.highlights || []));
	base.mentions.push(...(a.mentions || []), ...(b.mentions || []));
	return finalizeFindings(base);
}

type MutableFindings = {
	namesMap: Map<string, FindingName>;
	locations: Set<string>;
	activities: Set<string>;
	scores: Array<{ label: string; value: string; sourceUrl?: string | null }>;
	highlights: FindingHighlight[];
	mentions: CollectedFindings['mentions'];
};

function emptyFindings(): MutableFindings {
	return {
		namesMap: new Map(),
		locations: new Set(),
		activities: new Set(),
		scores: [],
		highlights: [],
		mentions: [],
	};
}

function mergeSignalsInto(
	base: MutableFindings,
	signals: ReturnType<typeof parseDirectorySignals>,
	sourceUrl?: string | null,
	sourceName?: string | null,
) {
	for (const name of signals.names) {
		const key = name.toLowerCase();
		const prev = base.namesMap.get(key);
		const next: FindingName = {
			label: name,
			sourceUrl: sourceUrl || null,
			confidence: 0.55,
			source: sourceName || null,
		};
		if (!prev || next.confidence > prev.confidence) base.namesMap.set(key, next);
	}
	for (const loc of signals.locations) base.locations.add(loc);
	for (const act of signals.activities) base.activities.add(act);
	if (signals.score) {
		base.scores.push({
			label: 'Community score',
			value: signals.score,
			sourceUrl: sourceUrl || null,
		});
	}
	for (const h of signals.highlights) base.highlights.push(h);
}

function finalizeFindings(base: MutableFindings): CollectedFindings {
	const dedupedHighlights: FindingHighlight[] = [];
	const seen = new Set<string>();
	for (const h of base.highlights) {
		const key = `${h.kind}:${String(h.value).toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		dedupedHighlights.push(h);
	}

	const scoreSeen = new Set<string>();
	const scores = [];
	for (const s of base.scores) {
		const key = s.value;
		if (scoreSeen.has(key)) continue;
		scoreSeen.add(key);
		scores.push(s);
	}

	return {
		names: [...base.namesMap.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 8),
		locations: [...base.locations].slice(0, 12),
		activities: [...base.activities].slice(0, 12),
		scores: scores.slice(0, 6),
		highlights: dedupedHighlights.slice(0, 16),
		mentions: base.mentions
			.sort((a, b) => b.confidenceScore - a.confidenceScore)
			.slice(0, 20),
	};
}
