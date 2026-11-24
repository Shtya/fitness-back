export interface DocSectionDraft {
	key: string;
	title: string;
	contentMd: string;
}

export interface DocBuildInput {
	name: string;
	description: string | null;
	sourceUrl: string | null;
	commitSha: string | null;
	analysis: Record<string, any>;
	/** Variable NAMES from .env.example-style files (values are never read). */
	envVarNames: string[];
	/** Dependency names and script names from package.json files, keyed by file path. */
	packages: Array<{ path: string; dependencies: string[]; scripts: string[] }>;
	fileCount: number;
}

const TEST_TOOLS = ['jest', 'vitest', 'mocha', 'playwright', '@playwright/test', 'cypress', 'supertest', 'pytest'];
const FRAMEWORKS = ['next', '@nestjs/core', 'express', 'react', 'vue', '@angular/core', 'fastify', 'typeorm', 'prisma', '@prisma/client', 'sequelize', 'mongoose', 'tailwindcss', 'expo', 'socket.io', 'redis', 'bullmq'];

function table(head: string[], rows: string[][]): string {
	if (!rows.length) return '';
	return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n');
}

/**
 * Builds the documentation sections that can be derived deterministically from the analysis.
 * Everything written here is a direct readout of indexed code (verification = "verified"), with file:line pointers.
 */
export function buildStructuralSections(i: DocBuildInput): DocSectionDraft[] {
	const a = i.analysis;
	const langs = Object.entries((a.languages || {}) as Record<string, number>).sort((x, y) => y[1] - x[1]);
	const routes: Array<{ method: string; path: string; file: string; line: number }> = a.routes || [];
	const entities: Array<{ name: string; file: string; line: number }> = a.entities || [];
	const tables: Array<{ name: string; file: string; line: number }> = a.tables || [];
	const modules: Array<{ name: string; files: number }> = a.modules || [];
	const deps = new Set(i.packages.flatMap((p) => p.dependencies));
	const frameworks = FRAMEWORKS.filter((f) => deps.has(f));
	const testTools = TEST_TOOLS.filter((f) => deps.has(f));

	const overview = [
		`# ${i.name}`,
		i.description ? `\n${i.description}\n` : '',
		i.sourceUrl ? `**Source:** ${i.sourceUrl}${i.commitSha ? ` @ \`${i.commitSha.slice(0, 10)}\`` : ''}\n` : '',
		`**Indexed:** ${a.indexedFiles ?? i.fileCount} of ${i.fileCount} files · ${a.totalLines ?? 0} lines`,
		langs.length ? '\n## Languages\n\n' + table(['Language', 'Files'], langs.map(([l, n]) => [l, String(n)])) : '',
		frameworks.length ? `\n## Detected frameworks and libraries\n\n${frameworks.map((f) => `- \`${f}\``).join('\n')}\n\n_Detected from package.json dependencies._` : '',
		(a.entryPoints || []).length ? `\n## Entry points\n\n${(a.entryPoints as string[]).map((p) => `- \`${p}\``).join('\n')}` : '',
	]
		.filter(Boolean)
		.join('\n');

	const architecture = [
		'# Architecture',
		'\nTop-level areas of the repository, by number of indexed files:\n',
		modules.length ? table(['Area', 'Files'], modules.slice(0, 30).map((m) => [`\`${m.name}\``, String(m.files)])) : '_No modules detected._',
		(a.configFiles || []).length ? `\n## Configuration files\n\n${(a.configFiles as string[]).slice(0, 30).map((p) => `- \`${p}\``).join('\n')}` : '',
	].join('\n');

	const api = [
		'# API endpoints',
		routes.length
			? `\n${routes.length} route(s) detected from decorators (\`@Get/@Post…\`), Express/Flask route calls and Next.js route files.\n\n` +
				table(['Method', 'Path', 'Source'], routes.slice(0, 400).map((r) => [r.method, `\`${r.path}\``, `\`${r.file}:${r.line}\``]))
			: '\n_No HTTP routes were detected._ This can also mean the project uses a routing style the analyzer does not recognise.',
	].join('\n');

	const database = [
		'# Database',
		entities.length || tables.length ? '' : '\n_No ORM entities or SQL tables were detected._',
		entities.length ? `\n## ORM entities\n\n${table(['Table', 'Source'], entities.slice(0, 300).map((e) => [`\`${e.name}\``, `\`${e.file}:${e.line}\``]))}` : '',
		tables.length ? `\n## SQL tables\n\n${table(['Table', 'Source'], tables.slice(0, 300).map((t) => [`\`${t.name}\``, `\`${t.file}:${t.line}\``]))}` : '',
	]
		.filter(Boolean)
		.join('\n');

	const scripts = i.packages.filter((p) => p.scripts.length);
	const setup = [
		'# Setup and configuration',
		scripts.length ? '\n## npm scripts\n\n' + scripts.map((p) => `**\`${p.path}\`**: ${p.scripts.map((s) => `\`${s}\``).join(', ')}`).join('\n\n') : '\n_No package.json scripts detected._',
		i.envVarNames.length ? `\n## Environment variables (names only)\n\n${i.envVarNames.slice(0, 200).map((n) => `- \`${n}\``).join('\n')}\n\n_Read from .env.example-style templates. Real .env files are never indexed._` : '\n_No .env.example template found; required environment variables are undocumented._',
	].join('\n');

	const testing = [
		'# Testing',
		`\n- Test files detected: **${a.testFiles ?? 0}**`,
		testTools.length ? `- Test tooling in dependencies: ${testTools.map((t) => `\`${t}\``).join(', ')}` : '- No known test framework found in dependencies.',
	].join('\n');

	const security = [
		'# Security notes',
		`\n- Files excluded from indexing for safety: ${Object.entries((a.excluded || {}) as Record<string, number>).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`,
		`- Secret-looking values redacted from indexed source: **${a.redactions ?? 0}**${(a.secretFiles || []).length ? ` in ${(a.secretFiles as string[]).slice(0, 10).map((p) => `\`${p}\``).join(', ')}` : ''}`,
		'\n_Secret files (.env, keys, credentials) are listed but their content is never stored or sent to an AI provider._',
	].join('\n');

	return [
		{ key: 'overview', title: 'Overview', contentMd: overview },
		{ key: 'architecture', title: 'Architecture', contentMd: architecture },
		{ key: 'api', title: 'API endpoints', contentMd: api },
		{ key: 'database', title: 'Database', contentMd: database },
		{ key: 'setup', title: 'Setup and configuration', contentMd: setup },
		{ key: 'testing', title: 'Testing', contentMd: testing },
		{ key: 'security', title: 'Security notes', contentMd: security },
	];
}

/** Variable names from `KEY=value` lines. Values are discarded immediately. */
export function parseEnvVarNames(content: string): string[] {
	const names = new Set<string>();
	for (const line of content.split('\n')) {
		const m = /^\s*#?\s*([A-Z][A-Z0-9_]{1,80})\s*=/.exec(line);
		if (m) names.add(m[1]);
	}
	return [...names];
}

export function parsePackageJson(content: string): { dependencies: string[]; scripts: string[] } | null {
	try {
		const j = JSON.parse(content);
		return { dependencies: Object.keys({ ...(j.dependencies || {}), ...(j.devDependencies || {}) }), scripts: Object.keys(j.scripts || {}) };
	} catch {
		return null;
	}
}

/** Mermaid diagram of top-level areas (rendered client-side with a source fallback). */
export function buildAreaDiagram(modules: Array<{ name: string; files: number }>): string {
	const tops = new Map<string, number>();
	for (const m of modules) {
		const top = m.name.split('/')[0];
		tops.set(top, (tops.get(top) || 0) + m.files);
	}
	const lines = ['flowchart LR'];
	let i = 0;
	for (const [name, n] of [...tops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
		lines.push(`  n${i++}["${name.replace(/["\\]/g, '')} (${n})"]`);
	}
	return lines.length > 1 ? lines.join('\n') : '';
}
