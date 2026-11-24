import { PM_LIMITS } from '../projectmind.constants';
import { Chunk, chunkFile } from './chunker';
import { ExcludeReason, looksBinary, pathExcludeReason, redactSecrets } from './file-filter';
import { CodeSymbol, RouteInfo, detectLanguage, extractSymbols, isCodeLanguage } from './symbols';

export interface RawFile {
	path: string; // normalized, forward slashes
	data: Buffer;
	/** Real size when the bytes were deliberately not read (oversized entries). */
	declaredSize?: number;
}

export interface AnalyzedFile {
	path: string;
	language: string | null;
	sizeBytes: number;
	lineCount: number;
	content: string | null;
	excluded: boolean;
	excludeReason: ExcludeReason | null;
	symbols: CodeSymbol[];
	imports: string[];
	routes: RouteInfo[];
	redactions: number;
	chunks: Chunk[];
}

export interface ProjectAnalysis {
	languages: Record<string, number>; // language -> file count
	totalLines: number;
	routes: Array<RouteInfo & { file: string }>;
	entities: Array<{ name: string; file: string; line: number }>;
	tables: Array<{ name: string; file: string; line: number }>;
	modules: Array<{ name: string; files: number }>;
	testFiles: number;
	docFiles: string[];
	configFiles: string[];
	excluded: Record<string, number>;
	redactions: number;
	/** Source files in which secret-looking values were found and redacted. */
	secretFiles: string[];
	entryPoints: string[];
	/** 0-100, share of source files that have at least one doc/comment header or sit in a documented area. Heuristic. */
	documentationCoverage: number;
	/** How documentationCoverage is computed (shown in the UI). */
	documentationCoverageMethod: string;
}

const CONFIG_FILES = /(^|\/)(package\.json|tsconfig.*\.json|docker-compose.*\.ya?ml|Dockerfile|nest-cli\.json|next\.config\.[cm]?[jt]s|vercel\.json|requirements\.txt|pyproject\.toml|\.env\.example|\.github\/workflows\/.*\.ya?ml)$/i;
const ENTRY_POINT = /(^|\/)(main|index|app|server)\.(t|j)sx?$|(^|\/)(main|app|manage)\.py$|(^|\/)app\.module\.ts$/i;
const TEST_FILE = /(\.(spec|test)\.[jt]sx?$|(^|\/)(tests?|__tests__|e2e)\/|(^|\/)test_.*\.py$|_test\.(py|go)$)/i;
const DOC_FILE = /\.(md|mdx|rst|txt)$/i;

/** Pure function: raw files in → analyzed files, chunks and project-level aggregates out. */
export function analyzeFiles(files: RawFile[]): { files: AnalyzedFile[]; analysis: ProjectAnalysis } {
	const out: AnalyzedFile[] = [];
	const languages: Record<string, number> = {};
	const excluded: Record<string, number> = {};
	const routes: ProjectAnalysis['routes'] = [];
	const entities: ProjectAnalysis['entities'] = [];
	const tables: ProjectAnalysis['tables'] = [];
	const moduleCounts = new Map<string, number>();
	const docFiles: string[] = [];
	const configFiles: string[] = [];
	const entryPoints: string[] = [];
	let totalLines = 0;
	let testFiles = 0;
	let redactions = 0;
	const secretFiles: string[] = [];
	let indexed = 0;
	let sourceFiles = 0;
	let sourceFilesDocumented = 0;

	for (const f of files) {
		const size = f.declaredSize ?? f.data.length;
		let reason: ExcludeReason | null = pathExcludeReason(f.path, size);
		if (!reason && looksBinary(f.data)) reason = 'binary';
		if (!reason && indexed >= PM_LIMITS.maxIndexedFiles) reason = 'too_large';

		const language = detectLanguage(f.path);
		if (reason) {
			excluded[reason] = (excluded[reason] || 0) + 1;
			out.push({ path: f.path, language, sizeBytes: size, lineCount: 0, content: null, excluded: true, excludeReason: reason, symbols: [], imports: [], routes: [], redactions: 0, chunks: [] });
			continue;
		}

		const red = redactSecrets(f.data.toString('utf8'));
		const content = red.text.replace(/\r\n?/g, '\n');
		redactions += red.redactions;
		if (red.redactions > 0) secretFiles.push(f.path);
		const lineCount = content.split('\n').length;
		const ex = extractSymbols(f.path, language, content);
		const chunks = chunkFile(content, ex.symbols);

		indexed++;
		totalLines += lineCount;
		if (language) languages[language] = (languages[language] || 0) + 1;
		if (TEST_FILE.test(f.path)) testFiles++;
		if (DOC_FILE.test(f.path)) docFiles.push(f.path);
		if (CONFIG_FILES.test(f.path)) configFiles.push(f.path);
		if (ENTRY_POINT.test(f.path)) entryPoints.push(f.path);
		for (const r of ex.routes) routes.push({ ...r, file: f.path });
		for (const s of ex.symbols) {
			if (s.kind === 'entity') entities.push({ name: s.name, file: f.path, line: s.line });
			if (s.kind === 'table') tables.push({ name: s.name, file: f.path, line: s.line });
		}
		const top = f.path.includes('/') ? f.path.split('/').slice(0, f.path.split('/').length > 2 ? 2 : 1).join('/') : '(root)';
		moduleCounts.set(top, (moduleCounts.get(top) || 0) + 1);

		if (isCodeLanguage(language) && !TEST_FILE.test(f.path)) {
			sourceFiles++;
			if (hasDocComment(content)) sourceFilesDocumented++;
		}
		out.push({ path: f.path, language, sizeBytes: size, lineCount, content, excluded: false, excludeReason: null, symbols: ex.symbols, imports: ex.imports, routes: ex.routes, redactions: red.redactions, chunks });
	}

	const analysis: ProjectAnalysis = {
		languages,
		totalLines,
		routes,
		entities,
		tables,
		modules: [...moduleCounts.entries()].map(([name, n]) => ({ name, files: n })).sort((a, b) => b.files - a.files).slice(0, 60),
		testFiles,
		docFiles: docFiles.slice(0, 200),
		configFiles: configFiles.slice(0, 100),
		excluded,
		redactions,
		secretFiles: secretFiles.slice(0, 100),
		entryPoints: entryPoints.slice(0, 40),
		documentationCoverage: sourceFiles ? Math.round((sourceFilesDocumented / sourceFiles) * 100) : 0,
		documentationCoverageMethod:
			'Heuristic: percentage of non-test source files containing at least one doc comment (/** … */ or a Python docstring). It measures comment presence, not documentation quality.',
	};
	return { files: out, analysis };
}

function hasDocComment(content: string): boolean {
	return /\/\*\*[\s\S]*?\*\//.test(content) || /("""|''')[\s\S]*?\1/.test(content);
}
