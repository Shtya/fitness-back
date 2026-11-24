/** Query analysis, retrieval gate and follow-up rewriting. Pure functions, no I/O. */

const STOP = new Set([
	'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'how', 'what', 'where', 'when', 'why', 'which', 'who',
	'of', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'and', 'or', 'not', 'this', 'that', 'it', 'its', 'there', 'here', 'can', 'could',
	'should', 'would', 'will', 'i', 'you', 'we', 'they', 'me', 'my', 'our', 'your', 'about', 'any', 'all', 'as', 'into', 'than', 'then', 'so',
	'explain', 'show', 'tell', 'describe', 'please', 'work', 'works', 'working', 'used', 'use', 'uses', 'using', 'project', 'code', 'codebase', 'app', 'application',
	'في', 'من', 'على', 'الى', 'إلى', 'عن', 'هل', 'ما', 'ماذا', 'كيف', 'اين', 'أين', 'متى', 'لماذا', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'و', 'او', 'أو',
]);

/** Splits camelCase / snake_case / kebab / path separators and returns lowercase significant terms. */
export function extractTerms(question: string): string[] {
	const raw = String(question || '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_\-./\\:]+/g, ' ');
	const terms = raw.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
	return [...new Set(terms.filter((t) => !STOP.has(t)))].slice(0, 24);
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
export function evidenceGate(terms: string[], chunks: RetrievedChunk[]): GateResult {
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
const SECRET_REQUEST = /(\.env\b|api[\s_-]?key|secret|password|private[\s_-]?key|access[\s_-]?token|credentials?|deploy-key)\b.*\b(value|content|show|reveal|print|dump|give|what is|what's|tell)|\b(show|reveal|print|dump|give|tell|what is|what's|read)\b.*(\.env\b|api[\s_-]?key|secret|password|private[\s_-]?key|access[\s_-]?token|credentials?)/i;

export function isSecretExtractionAttempt(question: string): boolean {
	return SECRET_REQUEST.test(question);
}
