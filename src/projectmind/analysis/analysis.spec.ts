import { analyzeFiles } from './analyzer';
import { chunkFile } from './chunker';
import { isSecretPath, normalizeArchivePath, pathExcludeReason, redactSecrets } from './file-filter';
import { detectLanguage, extractSymbols } from './symbols';

describe('file-filter', () => {
	it('normalizes safe paths and rejects traversal / absolute / drive paths', () => {
		expect(normalizeArchivePath('a/b/./c.ts')).toBe('a/b/c.ts');
		expect(normalizeArchivePath('/etc/passwd')).toBe('etc/passwd');
		expect(normalizeArchivePath('../../evil.sh')).toBeNull();
		expect(normalizeArchivePath('a/../../evil')).toBeNull();
		expect(normalizeArchivePath('C:/Windows/x')).toBeNull();
		expect(normalizeArchivePath('a\\..\\..\\x')).toBeNull();
		expect(normalizeArchivePath('')).toBeNull();
	});

	it('flags secret files but keeps env templates', () => {
		for (const p of ['.env', 'backend/.env.local', 'keys/server.pem', 'a/id_rsa', 'backend/deploy-key', 'x/credentials.json', 'tokens/gmail.json'])
			expect(isSecretPath(p)).toBe(true);
		for (const p of ['.env.example', 'backend/.env.sample', 'src/environment.ts', 'docs/keys.md']) expect(isSecretPath(p)).toBe(false);
	});

	it('excludes ignored dirs, binaries, lockfiles, oversized files', () => {
		expect(pathExcludeReason('node_modules/x/index.js', 10)).toBe('ignored_dir');
		expect(pathExcludeReason('img/logo.png', 10)).toBe('binary');
		expect(pathExcludeReason('package-lock.json', 10)).toBe('lockfile');
		expect(pathExcludeReason('src/a.ts', 10 * 1024 * 1024)).toBe('too_large');
		expect(pathExcludeReason('src/a.ts', 100)).toBeNull();
	});

	it('redacts secret values but keeps code references', () => {
		const src = [
			'const key = "sk-abcdefghijklmnopqrstuvwxyz123456";',
			'DATABASE_PASSWORD=hunter2hunter2',
			'const token = process.env.API_TOKEN;',
			'API_KEY: "AIzaSyA1234567890abcdefghijklmnopqrstuv"',
			'-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----',
		].join('\n');
		const r = redactSecrets(src);
		expect(r.text).not.toContain('hunter2');
		expect(r.text).not.toContain('sk-abcdef');
		expect(r.text).not.toContain('AIzaSyA');
		expect(r.text).not.toContain('MIIEabc');
		expect(r.text).toContain('process.env.API_TOKEN');
		expect(r.redactions).toBeGreaterThanOrEqual(4);
	});
});

describe('symbols', () => {
	it('detects languages', () => {
		expect(detectLanguage('a/b.tsx')).toBe('typescript');
		expect(detectLanguage('x/Dockerfile')).toBe('docker');
		expect(detectLanguage('x/y.unknown')).toBeNull();
	});

	it('extracts NestJS routes with controller prefix, entities and symbols', () => {
		const src = [
			"@Controller('projects')",
			'export class ProjectsController {',
			"  @Get(':id')",
			'  async getOne() {}',
			"  @Post()",
			'  create() {}',
			'}',
			"@Entity('pm_projects')",
			'export class Project {}',
		].join('\n');
		const r = extractSymbols('src/projects.controller.ts', 'typescript', src);
		expect(r.routes).toEqual([
			{ method: 'GET', path: '/projects/:id', line: 3 },
			{ method: 'POST', path: '/projects', line: 5 },
		]);
		expect(r.symbols.some((s) => s.kind === 'entity' && s.name === 'pm_projects')).toBe(true);
		expect(r.symbols.some((s) => s.kind === 'class' && s.name === 'ProjectsController')).toBe(true);
	});

	it('extracts python defs/routes and sql tables', () => {
		const py = extractSymbols('main.py', 'python', "@app.get('/health')\nasync def health():\n    return 1\nclass Foo:\n    pass");
		expect(py.routes[0]).toMatchObject({ method: 'GET', path: '/health' });
		expect(py.symbols.map((s) => s.name)).toEqual(expect.arrayContaining(['health', 'Foo']));
		const sql = extractSymbols('m.sql', 'sql', 'CREATE TABLE IF NOT EXISTS pm_files (id int);');
		expect(sql.symbols[0]).toMatchObject({ kind: 'table', name: 'pm_files' });
	});

	it('detects Next app-router routes', () => {
		const r = extractSymbols('src/app/[locale]/dashboard/page.jsx', 'javascript', 'export default function P(){}');
		expect(r.routes[0]).toMatchObject({ method: 'PAGE', path: '/[locale]/dashboard' });
	});
});

describe('chunker', () => {
	it('produces overlapping chunks that cover every line with exact ranges', () => {
		const content = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n');
		const chunks = chunkFile(content, []);
		expect(chunks[0].startLine).toBe(1);
		expect(chunks[chunks.length - 1].endLine).toBe(300);
		const covered = new Set<number>();
		for (const c of chunks) {
			expect(c.text.split('\n').length).toBe(c.endLine - c.startLine + 1);
			for (let l = c.startLine; l <= c.endLine; l++) covered.add(l);
		}
		expect(covered.size).toBe(300);
	});

	it('returns nothing for empty content and respects the char cap', () => {
		expect(chunkFile('   \n\n', [])).toEqual([]);
		const long = Array.from({ length: 10 }, () => 'x'.repeat(2000)).join('\n');
		for (const c of chunkFile(long, [])) expect(c.text.length).toBeLessThanOrEqual(6000);
	});
});

describe('analyzeFiles', () => {
	const f = (path: string, text: string) => ({ path, data: Buffer.from(text) });
	it('excludes secrets without storing content, redacts the rest and aggregates', () => {
		const { files, analysis } = analyzeFiles([
			f('.env', 'SECRET=abc123456789'),
			f('src/app.controller.ts', "@Controller('x')\nexport class A {\n @Get('y')\n y(){}\n}\n"),
			f('src/config.ts', 'export const DB_PASSWORD = "supersecretvalue";'),
			f('README.md', '# Hi'),
			f('src/a.spec.ts', 'it("x",()=>{})'),
			{ path: 'img/a.png', data: Buffer.from([1, 2, 3]) },
			{ path: 'src/blob.ts', data: Buffer.from([65, 0, 66]) },
		]);
		const env = files.find((x) => x.path === '.env')!;
		expect(env.excluded).toBe(true);
		expect(env.content).toBeNull();
		expect(env.excludeReason).toBe('secret');
		expect(files.find((x) => x.path === 'src/blob.ts')!.excludeReason).toBe('binary');
		expect(files.find((x) => x.path === 'src/config.ts')!.content).not.toContain('supersecretvalue');
		expect(analysis.routes).toEqual([expect.objectContaining({ method: 'GET', path: '/x/y', file: 'src/app.controller.ts' })]);
		expect(analysis.testFiles).toBe(1);
		expect(analysis.docFiles).toContain('README.md');
		expect(analysis.excluded.secret).toBe(1);
		expect(analysis.redactions).toBeGreaterThanOrEqual(1);
		expect(JSON.stringify(files)).not.toContain('supersecretvalue');
	});
});
