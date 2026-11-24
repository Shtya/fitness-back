/** Query analysis, retrieval gate and follow-up rewriting. Pure functions, no I/O. */

const STOP = new Set([
	'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'how', 'what', 'where', 'when', 'why', 'which', 'who',
	'of', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'and', 'or', 'not', 'this', 'that', 'it', 'its', 'there', 'here', 'can', 'could',
	'should', 'would', 'will', 'i', 'you', 'we', 'they', 'me', 'my', 'our', 'your', 'about', 'any', 'all', 'as', 'into', 'than', 'then', 'so',
	'explain', 'show', 'tell', 'describe', 'please', 'work', 'works', 'working', 'used', 'use', 'uses', 'using', 'project', 'code', 'codebase', 'app', 'application',
	'في', 'من', 'على', 'الى', 'إلى', 'عن', 'هل', 'ما', 'ماذا', 'كيف', 'اين', 'أين', 'متى', 'لماذا', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'و', 'او', 'أو',
]);

/**
 * Light English stemmer for query terms (ASCII words only). Terms are used as prefixes, so a stem such as "reset"
 * matches resetPassword, "limit" matches rateLimiter, "configur" matches configuration. Not a linguistic stemmer.
 */
export function stem(t: string): string {
	if (!/^[a-z]+$/.test(t) || t.length <= 4) return t;
	let s = t;
	if (/(sses|xes|zes|ches|shes)$/.test(s)) s = s.slice(0, -2);
	else if (/ies$/.test(s)) s = s.slice(0, -3) + 'y';
	else if (/s$/.test(s) && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
	for (const suf of ['ations', 'ation', 'ings', 'ing', 'ers', 'ed', 'ly']) {
		if (s.endsWith(suf) && s.length - suf.length >= 4) {
			s = s.slice(0, -suf.length);
			if (/([^aeiou])\1$/.test(s) && suf.startsWith('ing') ) s = s.slice(0, -1); // resetting → reset
			break;
		}
	}
	return s.length >= 3 ? s : t;
}

/**
 * Splits camelCase / snake_case / kebab / path separators and returns lowercase significant terms.
 * Also keeps the un-split compound (WhatsApp → whatsapp + whats + app) so brand/identifier names still match, and stems words.
 */
export function extractTerms(question: string): string[] {
	const q = String(question || '');
	const compounds = (q.match(/\b[A-Za-z][A-Za-z0-9]*[a-z][A-Z][A-Za-z0-9]*\b/g) || []).map((c) => c.toLowerCase());
	const raw = q.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-./\\:]+/g, ' ');
	const words = (raw.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter((t) => !STOP.has(t)).map(stem);
	return [...new Set([...compounds, ...words].filter((t) => t.length >= 2 && !STOP.has(t)))].slice(0, 24);
}

/** Builds a Postgres to_tsquery('simple', …) string: prefix-matching OR of safe terms. */
export function buildTsQuery(terms: string[]): string {
	const safe = terms.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter((t) => t.length >= 2);
	return safe.map((t) => `${t}:*`).join(' | ');
}

const FOLLOW_UP_START = /^(and|also|what about|how about|then|so|but|why|where|when|who|which|is it|does it|do they|can it|و|وايضا|وماذا|وكيف|وأين)\b/i;
const PRONOUN = /\b(it|its|this|that|these|those|they|them|there|same|above|previous|هذا|هذه|ذلك|تلك|هو|هي)\b/i;

/** True when a question likely depends on the previous turn. */
export function isFollowUp(question: string): boolean {
	const q = question.trim();
	const words = q.split(/\s+/).filter(Boolean).length;
	return FOLLOW_UP_START.test(q) || (words <= 8 && PRONOUN.test(q));
}

/** Retrieval query for a (possibly follow-up) question: prior user question terms are mixed in for follow-ups. */
export function retrievalQuery(question: string, previousUserQuestions: string[]): string {
	if (!isFollowUp(question) || previousUserQuestions.length === 0) return question;
	return `${previousUserQuestions[previousUserQuestions.length - 1]} ${question}`;
}

export interface RetrievedChunk {
	id: string;
	path: string;
	startLine: number;
	endLine: number;
	text: string;
	symbols: string;
	score: number;
}

export interface GateResult {
	sufficient: boolean;
	coverage: number; // share of query terms found in retrieved text/paths
	reason: string;
}

/**
 * Insufficient-evidence gate. Runs BEFORE any AI call. Refuses when nothing relevant was retrieved or when
 * too few of the question's significant terms appear anywhere in the retrieved evidence.
 */
export function evidenceGate(terms: string[], chunks: RetrievedChunk[], absentEntities: string[] = []): GateResult {
	if (absentEntities.length > 0) return { sufficient: false, coverage: 0, reason: `The question mentions ${absentEntities.map((e) => `"${e}"`).join(', ')}, which does not appear anywhere in the indexed code.` };
	if (terms.length === 0) return { sufficient: false, coverage: 0, reason: 'The question has no searchable terms.' };
	if (chunks.length === 0) return { sufficient: false, coverage: 0, reason: 'No code matched the question.' };
	const hay = chunks.map((c) => `${c.path} ${c.symbols} ${c.text}`).join('\n').toLowerCase();
	const found = terms.filter((t) => hay.includes(t)).length;
	const coverage = found / terms.length;
	// Short questions need most terms; long ones can be satisfied with a third.
	const need = terms.length <= 2 ? 0.5 : 0.34;
	if (coverage < need) return { sufficient: false, coverage, reason: `Only ${found} of ${terms.length} key terms appear in the retrieved code.` };
	return { sufficient: true, coverage, reason: 'ok' };
}

/** Questions that try to extract secrets / excluded files — answered with a refusal, no retrieval, no AI. */
const SECRET_REQUEST = /(\.env\b|api[\s_-]?key|secret|password|private[\s_-]?key|access[\s_-]?token|credentials?|deploy-key)\b.*\b(value|content|show|reveal|print|dump|give|what is|what's|tell|list|enumerate|expose|leak|output)|\b(show|reveal|print|dump|give|tell|what is|what's|read|list|enumerate|expose|leak|output)\b.*(\.env\b|api[\s_-]?keys?|secrets?|passwords?|private[\s_-]?keys?|access[\s_-]?tokens?|credentials?)/i;

/** "How/where/why … stored/hashed/handled" questions ABOUT secrets are legitimate; asking for their VALUES is not. */
const ABOUT_SECRETS = /\b(how|where|why|which|whether|stored|storing|hash|hashed|hashing|encrypt|encrypted|encryption|configured|handled|handling|protect|protected|validate|validated|loaded|rotated)\b/i;
const WANTS_VALUES = /\b(value|values|content|contents|actual|real|plain ?text|literal|all the)\b/i;

export function isSecretExtractionAttempt(question: string): boolean {
	if (!SECRET_REQUEST.test(question)) return false;
	if (ABOUT_SECRETS.test(question) && !WANTS_VALUES.test(question)) return false;
	return true;
}

const ENTITY_STOP = new Set(['api', 'url', 'http', 'https', 'json', 'html', 'css', 'sql', 'rest', 'ssl', 'the', 'and', 'how', 'what', 'where', 'when', 'why', 'which', 'who', 'does', 'can', 'could', 'should', 'explain', 'show', 'list', 'tell', 'ignore', 'system', 'please', 'create', 'since', 'is', 'are']);

/**
 * Named things the question presupposes exist: camelCase / ALLCAPS (3+) / Capitalized words that are NOT the first word of a
 * sentence ("Kafka", "RabbitMQ", "ThrottlerGuard"). Used to detect false premises: if such a name occurs nowhere in the
 * indexed code (text or paths), the question cannot be answered from the code.
 */
export function extractEntities(question: string): string[] {
	const q = String(question || '');
	const out = new Set<string>();
	const re = /[A-Za-z][A-Za-z0-9]*/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(q))) {
		const w = m[0];
		if (w.length < 3) continue;
		const before = q.slice(0, m.index).trimEnd();
		const sentenceStart = before === '' || /[.!?:]$/.test(before);
		const camel = /[a-z][A-Z]/.test(w) || /^[A-Z][a-z0-9]+[A-Z]/.test(w);
		const caps = /^[A-Z]{3,}[a-z0-9]*$/.test(w);
		const capitalized = /^[A-Z][a-z0-9]+$/.test(w) && !sentenceStart;
		if (!(camel || caps || capitalized)) continue;
		const lower = w.toLowerCase();
		if (ENTITY_STOP.has(lower)) continue;
		out.add(lower);
	}
	return [...out].slice(0, 6);
}
