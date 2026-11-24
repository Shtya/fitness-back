import { PM_LIMITS } from '../projectmind.constants';
import { CodeSymbol } from './symbols';

export interface Chunk {
	startLine: number; // 1-based, inclusive
	endLine: number; // 1-based, inclusive
	text: string;
	symbols: string;
}

/**
 * Splits a file into line-ranged chunks. Prefers to break just before a symbol declaration so a
 * function is not cut in half, falls back to the target size, and never exceeds the char limit.
 * Every chunk records its exact line range so citations can be validated later.
 */
export function chunkFile(content: string, symbols: CodeSymbol[]): Chunk[] {
	const lines = content.split('\n');
	if (lines.length === 0 || content.trim() === '') return [];
	const target = PM_LIMITS.chunkTargetLines;
	const overlap = PM_LIMITS.chunkOverlapLines;
	const symbolLines = new Set(symbols.map((s) => s.line));
	const chunks: Chunk[] = [];

	let start = 0;
	while (start < lines.length) {
		let end = Math.min(start + target, lines.length); // exclusive
		if (end < lines.length) {
			// look back (up to 30%) for a symbol boundary
			const floor = start + Math.floor(target * 0.7);
			for (let j = end; j > floor; j--) {
				if (symbolLines.has(j + 1)) {
					end = j;
					break;
				}
			}
		}
		// enforce char cap
		let text = lines.slice(start, end).join('\n');
		while (text.length > PM_LIMITS.chunkMaxChars && end - start > 1) {
			end = start + Math.max(1, Math.floor((end - start) / 2));
			text = lines.slice(start, end).join('\n');
		}
		if (text.length > PM_LIMITS.chunkMaxChars) text = text.slice(0, PM_LIMITS.chunkMaxChars);

		if (text.trim() !== '') {
			const names = symbols.filter((s) => s.line >= start + 1 && s.line <= end).map((s) => s.name);
			chunks.push({ startLine: start + 1, endLine: end, text, symbols: [...new Set(names)].join(' ') });
		}
		if (end >= lines.length) break;
		start = Math.max(end - overlap, start + 1);
	}
	return chunks;
}
