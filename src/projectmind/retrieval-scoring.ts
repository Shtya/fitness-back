/** Pure ranking helpers for hybrid retrieval. No I/O so they can be unit-tested and tuned in isolation. */

/** Splits a path into lowercase word tokens: "backend/common/security-headers.ts" → backend common security headers ts. */
export function pathTokens(path: string): string[] {
	return path
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/** True when a query term corresponds to a token (equal, or one is a ≥4-char prefix of the other: login ~ logins, auth ~ authentication). */
export function termMatchesToken(term: string, token: string): boolean {
	if (term === token) return true;
	if (term.length >= 4 && token.startsWith(term)) return true;
	if (token.length >= 4 && term.startsWith(token)) return true;
	return false;
}

/** Inverse document frequency (BM25 flavour); always > 0. */
export function idf(totalChunks: number, docFreq: number): number {
	return Math.log(1 + (totalChunks - docFreq + 0.5) / (docFreq + 0.5));
}

/**
 * Down-weights chunks that are rarely the best answer to "how does the code do X": tests, translation catalogs,
 * stylesheets, lockfiles and generic docs. Configuration manifests (package.json, vercel.json) are NOT penalised.
 */
export function pathPrior(path: string): number {
	const p = path.toLowerCase();
	if (/\.(spec|test)\.[a-z]+$/.test(p) || /(^|\/)(__tests__|tests?|e2e)\//.test(p)) return 0.55;
	if (/\.(css|scss|less)$/.test(p)) return 0.45;
	if (/(^|\/)(messages|locales?|i18n)\/[^/]*\.json$/.test(p)) return 0.35;
	if (/\.(md|mdx|txt)$/.test(p)) return 0.75;
	if (/\.(svg|csv)$/.test(p)) return 0.4;
	return 1;
}

export interface ScoreInput {
	path: string;
	symbols: string;
	/** indexes into `terms` that the chunk's full-text vector matched */
	matched: number[];
	terms: string[];
	weights: number[]; // idf per term from full-text document frequency, 0 when the term does not occur in the project at all
	/** idf per term from PATH document frequency (so "backend" in a path is not treated as rare). Defaults to `weights`. */
	pathWeights?: number[];
}

/**
 * Score = idf-weighted evidence from (a) text matches, (b) path-token matches (strong: file names carry intent), and
 * (c) symbol-name matches, scaled by how many of the question's *present* terms the chunk covers, times a path prior.
 */
export function scoreChunk(i: ScoreInput): number {
	const toks = pathTokens(i.path);
	const sym = i.symbols.toLowerCase().split(/\s+/).filter(Boolean);
	const matched = new Set(i.matched);
	let evidence = 0;
	const covered = new Set<number>();
	i.terms.forEach((t, idx) => {
		const w = i.weights[idx];
		if (!w) return;
		const pw = i.pathWeights ? i.pathWeights[idx] : w;
		const inText = matched.has(idx);
		const inPath = toks.some((tok) => termMatchesToken(t, tok));
		const inSym = sym.some((s) => termMatchesToken(t, s));
		if (inText) evidence += w;
		if (inPath) evidence += pw * 1.5;
		if (inSym) evidence += w * 1.0;
		if (inText || inPath || inSym) covered.add(idx);
	});
	const present = i.weights.filter((w) => w > 0).length || 1;
	const coverage = covered.size / present;
	return evidence * (0.5 + coverage) * pathPrior(i.path);
}
