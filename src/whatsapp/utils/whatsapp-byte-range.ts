export interface ByteRange {
	start: number;
	end: number;
}

/**
 * Single-range parser for `Range: bytes=...` (RFC 7233 §2.1).
 *
 * Returns `null` when the caller should send the whole body with 200 — that
 * covers a missing header, a non-`bytes` unit, and multi-range requests, which
 * a server is always allowed to answer in full rather than as multipart.
 * Returns `'unsatisfiable'` when the client asked past the end of the file (416).
 */
export function parseByteRange(
	header: string,
	size: number,
): ByteRange | 'unsatisfiable' | null {
	if (!Number.isFinite(size) || size <= 0) return null;
	const match = /^bytes=(.+)$/i.exec(String(header || '').trim());
	if (!match) return null;
	const specs = match[1].split(',');
	if (specs.length !== 1) return null;

	const spec = specs[0].trim();
	const parts = /^(\d*)-(\d*)$/.exec(spec);
	if (!parts) return null;
	const [, rawStart, rawEnd] = parts;
	if (!rawStart && !rawEnd) return null;

	let start: number;
	let end: number;
	if (!rawStart) {
		// Suffix range: the last N bytes.
		const suffix = Number(rawEnd);
		if (suffix <= 0) return 'unsatisfiable';
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(rawStart);
		end = rawEnd ? Number(rawEnd) : size - 1;
	}

	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	if (start >= size) return 'unsatisfiable';
	end = Math.min(end, size - 1);
	if (end < start) return 'unsatisfiable';
	// Answer every satisfiable range with 206, including `bytes=0-`: Safari treats
	// a 200 there as "no range support" and refuses to seek.
	return { start, end };
}
