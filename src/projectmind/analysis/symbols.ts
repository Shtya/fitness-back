export type SymbolKind = 'class' | 'function' | 'route' | 'entity' | 'table' | 'variable' | 'type';

export interface CodeSymbol {
	name: string;
	kind: SymbolKind;
	line: number; // 1-based
}

export interface RouteInfo {
	method: string;
	path: string;
	line: number;
}

const EXT_LANG: Record<string, string> = {
	ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
	py: 'python', java: 'java', kt: 'kotlin', go: 'go', rb: 'ruby', php: 'php', cs: 'csharp', rs: 'rust',
	swift: 'swift', sql: 'sql', json: 'json', yml: 'yaml', yaml: 'yaml', md: 'markdown', css: 'css', scss: 'css',
	html: 'html', sh: 'shell', ps1: 'shell', dockerfile: 'docker', toml: 'toml', xml: 'xml', vue: 'vue',
};

export function detectLanguage(path: string): string | null {
	const base = (path.split('/').pop() || '').toLowerCase();
	if (base === 'dockerfile') return 'docker';
	const ext = base.includes('.') ? base.split('.').pop()! : '';
	return EXT_LANG[ext] || null;
}

const CODE_LANGS = new Set(['typescript', 'javascript', 'python', 'java', 'kotlin', 'go', 'ruby', 'php', 'csharp', 'rust', 'swift', 'vue']);

export function isCodeLanguage(lang: string | null): boolean {
	return !!lang && CODE_LANGS.has(lang);
}

const NEST_ROUTE = /@(Get|Post|Put|Patch|Delete|All)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;
const NEST_CONTROLLER = /@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;
const EXPRESS_ROUTE = /\b(?:app|router|server|api)\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/;
const FLASK_ROUTE = /@\w+\.(route|get|post|put|patch|delete)\(\s*['"]([^'"]+)['"](?:.*methods=\[['"](\w+)['"])?/;

/** Extract declared symbols + HTTP routes from a source file using line-oriented heuristics. */
export function extractSymbols(path: string, lang: string | null, content: string): { symbols: CodeSymbol[]; routes: RouteInfo[]; imports: string[] } {
	const symbols: CodeSymbol[] = [];
	const routes: RouteInfo[] = [];
	const imports = new Set<string>();
	const lines = content.split('\n');
	let controllerPrefix = '';

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const n = i + 1;
		if (line.length > 400) continue;

		if (lang === 'sql') {
			const m = /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/i.exec(line);
			if (m) symbols.push({ name: m[1].replace(/"/g, ''), kind: 'table', line: n });
			continue;
		}
		if (!isCodeLanguage(lang)) continue;

		let m: RegExpExecArray | null;
		if (lang === 'typescript' || lang === 'javascript' || lang === 'vue') {
			if ((m = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line))) symbols.push({ name: m[1], kind: 'class', line: n });
			else if ((m = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/.exec(line))) symbols.push({ name: m[1], kind: 'function', line: n });
			else if ((m = /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/.exec(line))) symbols.push({ name: m[1], kind: 'function', line: n });
			else if ((m = /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(line))) symbols.push({ name: m[1], kind: 'type', line: n });
			else if ((m = /^\s{1,4}(?:public\s+|private\s+|protected\s+)?(?:async\s+)([A-Za-z_$][\w$]*)\s*\(/.exec(line))) symbols.push({ name: m[1], kind: 'function', line: n });

			if ((m = NEST_CONTROLLER.exec(line))) controllerPrefix = m[1] || '';
			if ((m = NEST_ROUTE.exec(line))) {
				routes.push({ method: m[1].toUpperCase(), path: joinPath(controllerPrefix, m[2] || ''), line: n });
			} else if ((m = EXPRESS_ROUTE.exec(line))) {
				routes.push({ method: m[1].toUpperCase(), path: m[2], line: n });
			}
			if ((m = /@Entity\(\s*['"`]([^'"`]+)['"`]/.exec(line))) symbols.push({ name: m[1], kind: 'entity', line: n });

			const imp = /(?:^\s*import\s[^'"]*from\s*|^\s*import\s*|require\()\s*['"]([^'"]+)['"]/.exec(line);
			if (imp) imports.add(imp[1]);
		} else if (lang === 'python') {
			if ((m = /^\s*class\s+([A-Za-z_]\w*)/.exec(line))) symbols.push({ name: m[1], kind: 'class', line: n });
			else if ((m = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(line))) symbols.push({ name: m[1], kind: 'function', line: n });
			if ((m = FLASK_ROUTE.exec(line))) routes.push({ method: (m[3] || (m[1] === 'route' ? 'GET' : m[1])).toUpperCase(), path: m[2], line: n });
			const imp = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/.exec(line);
			if (imp) imports.add(imp[1] || imp[2]);
		} else {
			if ((m = /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*(?:class|interface|struct|enum|trait)\s+([A-Za-z_]\w*)/.exec(line))) symbols.push({ name: m[1], kind: 'class', line: n });
			else if ((m = /^\s*(?:func|fn|def|function)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(line))) symbols.push({ name: m[1], kind: 'function', line: n });
		}
	}

	// Next.js App Router file-based routes.
	const next = /(?:^|\/)app\/(.*)\/(route|page)\.(?:t|j)sx?$/.exec(path);
	if (next) {
		const url = '/' + next[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/');
		routes.push({ method: next[2] === 'page' ? 'PAGE' : 'ROUTE', path: url, line: 1 });
	}
	return { symbols, routes, imports: [...imports].slice(0, 80) };
}

function joinPath(a: string, b: string): string {
	return '/' + [a, b].map((s) => s.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
}
