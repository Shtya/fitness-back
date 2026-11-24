import { INSUFFICIENT_EVIDENCE_TEXT } from '../projectmind.constants';
import { RetrievedChunk } from './query';

export type ClaimLabel = 'verified' | 'inferred' | 'missing' | 'recommended';
const LABELS: ClaimLabel[] = ['verified', 'inferred', 'missing', 'recommended'];

export interface RawClaim {
	text?: unknown;
	label?: unknown;
	sources?: unknown;
}

export interface SourceRef {
	n: number; // evidence number shown to the model, stable within the answer
	path: string;
	startLine: number;
	endLine: number;
	snippet: string;
}

export interface Claim {
	text: string;
	label: ClaimLabel;
	sources: number[]; // SourceRef.n values that were validated
	downgraded?: boolean;
}

export interface ValidatedAnswer {
	/** Markdown answer; unresolvable file paths are rendered as plain text and reported in `unresolved`. */
	answer: string;
	claims: Claim[];
	sources: SourceRef[];
	unresolved: string[];
	refused: boolean;
	notes: string[];
}

/** Extracts the JSON object from a model reply (tolerates code fences and leading prose). */
export function parseModelJson(text: string): { answer?: unknown; claims?: unknown; needsMoreInvestigation?: unknown } | null {
	const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
	const start = cleaned.indexOf('{');
	const end = cleaned.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		const obj = JSON.parse(cleaned.slice(start, end + 1));
		return obj && typeof obj === 'object' ? obj : null;
	} catch {
		return null;
	}
}

const PATH_TOKEN = /(?<![\w/.-])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,6})(?::(\d+)(?:-(\d+))?)?(?![\w/])/g;

/** File-looking tokens in free text that do not exist in the project. Used to catch invented paths. */
export function findUnresolvedPaths(text: string, knownPaths: Set<string>): string[] {
	const bad = new Set<string>();
	for (const m of text.matchAll(PATH_TOKEN)) {
		const p = m[1].replace(/^\.\//, '');
		if (/^(https?|www)/i.test(p) || /\.(com|org|net|io|dev|app)$/i.test(p)) continue;
		if (!knownPaths.has(p) && ![...knownPaths].some((k) => k.endsWith('/' + p))) bad.add(p);
	}
	return [...bad];
}

/**
 * Validation layer between the model and the user.
 * - claims may only cite evidence numbers that were actually supplied; others are dropped
 * - a claim labelled "verified" with no valid source is downgraded to "inferred"
 * - file paths in the prose that do not exist in the project are reported and neutralised
 * - if nothing verifiable remains, the answer is replaced by the required insufficient-evidence text
 */
export function validateAnswer(parsed: ReturnType<typeof parseModelJson>, evidence: RetrievedChunk[], knownPaths: Set<string>): ValidatedAnswer {
	const notes: string[] = [];
	const sourcesAll: SourceRef[] = evidence.map((c, i) => ({ n: i + 1, path: c.path, startLine: c.startLine, endLine: c.endLine, snippet: c.text.slice(0, 600) }));
	if (!parsed) {
		return { answer: INSUFFICIENT_EVIDENCE_TEXT, claims: [], sources: [], unresolved: [], refused: true, notes: ['The model reply could not be parsed into a structured answer.'] };
	}
	const rawClaims: RawClaim[] = Array.isArray(parsed.claims) ? (parsed.claims as RawClaim[]) : [];
	const claims: Claim[] = [];
	for (const rc of rawClaims.slice(0, 40)) {
		const text = typeof rc.text === 'string' ? rc.text.trim() : '';
		if (!text) continue;
		let label: ClaimLabel = LABELS.includes(rc.label as ClaimLabel) ? (rc.label as ClaimLabel) : 'inferred';
		const nums = Array.isArray(rc.sources) ? (rc.sources as unknown[]).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 1 && n <= sourcesAll.length) : [];
		const sources = [...new Set(nums)];
		let downgraded = false;
		if (label === 'verified' && sources.length === 0) {
			label = 'inferred';
			downgraded = true;
			notes.push('A claim labelled verified had no valid source and was downgraded to inferred.');
		}
		claims.push({ text, label, sources, ...(downgraded ? { downgraded } : {}) });
	}

	let answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
	const unresolved = findUnresolvedPaths(`${answer}\n${claims.map((c) => c.text).join('\n')}`, knownPaths);
	for (const p of unresolved) {
		answer = answer.split(p).join(`\`${p}\` (unverified path)`);
		notes.push(`Path "${p}" does not exist in this project.`);
	}

	const usedNs = new Set(claims.flatMap((c) => c.sources));
	const sources = sourcesAll.filter((s) => usedNs.has(s.n));
	const hasVerified = claims.some((c) => c.label === 'verified');
	const needsMore = parsed.needsMoreInvestigation === true;

	if (!answer || (!hasVerified && !claims.some((c) => c.label === 'inferred' || c.label === 'recommended')) || (needsMore && !hasVerified)) {
		return { answer: INSUFFICIENT_EVIDENCE_TEXT, claims: claims.filter((c) => c.label === 'missing'), sources: [], unresolved, refused: true, notes };
	}
	return { answer, claims, sources, unresolved, refused: false, notes };
}

export interface ConfidenceInfo {
	level: 'low' | 'medium' | 'high';
	heuristic: true;
	basis: string;
}

/** Heuristic confidence. NOT a probability: derived from claim labels, evidence count and term coverage. */
export function heuristicConfidence(v: ValidatedAnswer, coverage: number): ConfidenceInfo {
	if (v.refused) return { level: 'low', heuristic: true, basis: 'No verifiable evidence.' };
	const total = v.claims.length || 1;
	const verified = v.claims.filter((c) => c.label === 'verified').length;
	const share = verified / total;
	let level: ConfidenceInfo['level'] = 'low';
	if (share >= 0.7 && coverage >= 0.6 && v.unresolved.length === 0) level = 'high';
	else if (share >= 0.4 && coverage >= 0.4) level = 'medium';
	if (v.unresolved.length > 0 && level === 'high') level = 'medium';
	return { level, heuristic: true, basis: `${verified}/${total} claims backed by cited code; ${Math.round(coverage * 100)}% of question terms found in retrieved code.` };
}
