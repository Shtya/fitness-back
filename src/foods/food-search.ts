const ARABIC_FOLD: Record<string, string> = {
	'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ي',
};
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u0640]/g;

/** Same folding as the `foods.search_text` generated column, so query and index agree. */
export function normalizeFoodText(input: unknown): string {
	return String(input ?? '')
		.replace(/[أإآٱىةؤئ]/g, ch => ARABIC_FOLD[ch] || ch)
		.replace(ARABIC_MARKS, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Search tokens: folded words, with the Arabic definite article dropped so
 * "الفراخ" still finds "فراخ". LIKE wildcards are escaped.
 */
export function foodSearchTokens(input: unknown): string[] {
	const words = normalizeFoodText(input)
		.split(/[^\p{L}\p{N}%]+/u)
		.map(w => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))
		.map(w => w.replace(/[%_\\]/g, ch => `\\${ch}`))
		.filter(w => w.length >= 1);
	return Array.from(new Set(words)).slice(0, 6);
}
