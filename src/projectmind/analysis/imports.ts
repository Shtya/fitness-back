const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.py', '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/__init__.py'];

/**
 * Resolves a relative import specifier (`./x`, `../y/z`) from `fromPath` to a real file path in the project.
 * Package imports (no leading dot) and aliased paths (`@/…`, `src/…`) resolve by suffix only when unambiguous.
 * Returns null when the target is not part of the project (external package or unresolved).
 */
export function resolveImport(fromPath: string, spec: string, allPaths: Set<string>): string | null {
	if (!spec) return null;
	if (spec.startsWith('.')) {
		const base = fromPath.split('/').slice(0, -1);
		for (const seg of spec.split('/')) {
			if (seg === '.' || seg === '') continue;
			if (seg === '..') base.pop();
			else base.push(seg);
		}
		const joined = base.join('/');
		for (const e of EXTS) if (allPaths.has(joined + e)) return joined + e;
		return null;
	}
	const cleaned = spec.replace(/^@\//, '').replace(/^~\//, '');
	if (!/[/]/.test(cleaned) && !cleaned.startsWith('src')) return null; // bare package name
	const hits: string[] = [];
	for (const p of allPaths) {
		for (const e of EXTS) {
			if (p === cleaned + e || p.endsWith('/' + cleaned + e)) {
				hits.push(p);
				break;
			}
		}
		if (hits.length > 1) return null; // ambiguous
	}
	return hits.length === 1 ? hits[0] : null;
}
