// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip');
import { ArchiveError, extractZip } from './zip-extract';
import { GithubImportError, parseGithubUrl } from './github-import';

async function makeZip(entries: Record<string, string | Buffer>, compression: 'STORE' | 'DEFLATE' = 'DEFLATE'): Promise<Buffer> {
	const z = new JSZip();
	for (const [k, v] of Object.entries(entries)) z.file(k, v);
	return z.generateAsync({ type: 'nodebuffer', compression });
}

describe('extractZip', () => {
	it('reads files and strips the GitHub-style root folder', async () => {
		const zip = await makeZip({ 'repo-main/src/a.ts': 'export const a = 1;', 'repo-main/README.md': '# x' });
		const files = await extractZip(zip);
		expect(files.map((f) => f.path).sort()).toEqual(['README.md', 'src/a.ts']);
		expect(files.find((f) => f.path === 'src/a.ts')!.data.toString()).toBe('export const a = 1;');
	});

	it('rejects archives containing path-traversal or absolute entries', async () => {
		await expect(extractZip(await makeZip({ '../../evil.sh': 'rm', 'ok/a.txt': 'fine' }))).rejects.toMatchObject({ code: 'ZIP_UNSAFE_PATH' });
		await expect(extractZip(await makeZip({ '/abs/evil': 'x', 'ok/a.txt': 'fine' }))).rejects.toMatchObject({ code: 'ZIP_UNSAFE_PATH' });
	});

	it('rejects garbage input', async () => {
		await expect(extractZip(Buffer.from('not a zip'))).rejects.toMatchObject({ code: 'ZIP_INVALID' });
	});

	it('rejects archives with too many entries', async () => {
		const zip = await makeZip({ 'a/1.txt': '1', 'a/2.txt': '2', 'a/3.txt': '3' });
		await expect(extractZip(zip, { maxEntries: 2 })).rejects.toBeInstanceOf(ArchiveError);
	});

	it('rejects a zip bomb by ratio and by total size', async () => {
		const big = Buffer.alloc(6 * 1024 * 1024, 0x61); // compresses ~1000:1
		const zip = await makeZip({ 'a/bomb.txt': big });
		await expect(extractZip(zip, { maxFileBytes: 10 * 1024 * 1024 })).rejects.toMatchObject({ code: 'ZIP_BOMB' });
		const zip2 = await makeZip({ 'a/x.txt': Buffer.alloc(3000, 'b'), 'a/y.txt': Buffer.alloc(3000, 'c') }, 'STORE');
		await expect(extractZip(zip2, { maxUncompressedBytes: 4000 })).rejects.toMatchObject({ code: 'ZIP_TOO_LARGE' });
	});

	it('lists oversized files without reading their bytes', async () => {
		const zip = await makeZip({ 'a/huge.txt': Buffer.alloc(5000, 'z'), 'a/small.txt': 'ok' }, 'STORE');
		const files = await extractZip(zip, { maxFileBytes: 1000 });
		const huge = files.find((f) => f.path === 'huge.txt')!;
		expect(huge.data.length).toBe(0);
		expect(huge.declaredSize).toBe(5000);
	});
});

describe('parseGithubUrl (SSRF guard)', () => {
	it('accepts normal GitHub URLs', () => {
		expect(parseGithubUrl('https://github.com/acme/widgets')).toEqual({ owner: 'acme', repo: 'widgets', branch: undefined });
		expect(parseGithubUrl('https://github.com/acme/widgets.git')).toMatchObject({ repo: 'widgets' });
		expect(parseGithubUrl('https://github.com/acme/widgets/tree/feature/x')).toMatchObject({ branch: 'feature/x' });
	});

	it.each([
		'http://github.com/a/b',
		'https://evil.com/a/b',
		'https://github.com.evil.com/a/b',
		'https://user:pw@github.com/a/b',
		'https://github.com:8080/a/b',
		'https://169.254.169.254/latest/meta-data',
		'https://localhost/a/b',
		'file:///etc/passwd',
		'https://github.com/onlyowner',
		'https://github.com/a/..',
		'https://github.com/a/b/tree/../../x',
		'not a url',
		'',
	])('rejects %s', (url) => {
		expect(() => parseGithubUrl(url)).toThrow(GithubImportError);
	});
});
