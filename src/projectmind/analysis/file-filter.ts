import { PM_LIMITS } from '../projectmind.constants';

export type ExcludeReason = 'secret' | 'binary' | 'too_large' | 'ignored_dir' | 'lockfile' | 'generated' | 'empty';

const IGNORED_DIRS = new Set([
	'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.cache',
	'.venv', 'venv', '__pycache__', 'coverage', '.idea', 'target', '.gradle', 'Pods', '.expo', '.vercel',
	'.pytest_cache', '.mypy_cache', 'bower_components',
]);

const BINARY_EXT = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svgz', 'pdf', 'zip', 'gz', 'tar', 'tgz', '7z', 'rar',
	'mp3', 'mp4', 'mov', 'avi', 'wav', 'ogg', 'webm', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'exe', 'dll', 'so',
	'dylib', 'bin', 'class', 'jar', 'pyc', 'onnx', 'pt', 'task', 'tflite', 'psd', 'sqlite', 'db', 'apk', 'aab', 'ipa',
]);

const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'poetry.lock', 'Cargo.lock', 'Gemfile.lock']);

/** `.env`, `.env.local`, … are secrets; `.env.example` style templates are documentation and are kept. */
const ENV_TEMPLATE = /\.(example|sample|template|dist)$/i;
const SECRET_BASENAME = /^(\.env(\..+)?|id_rsa.*|id_ed25519.*|id_dsa.*|credentials(\..+)?|secrets?\.(json|ya?ml|toml)|deploy-key.*|\.npmrc|\.pypirc|\.netrc|service-account.*\.json)$/i;
const SECRET_EXT = /\.(pem|key|p12|pfx|keystore|jks|crt|cer|der|ppk)$/i;
const SECRET_DIR = /(^|\/)(secrets?|\.ssh|tokens?)\//i;

/** Normalizes an archive path to forward slashes, no leading slash. Returns null if it escapes the root. */
export function normalizeArchivePath(raw: string): string | null {
	const p = String(raw || '').replace(/\\/g, '/').replace(/^\/+/, '');
	if (!p || p.includes('\0')) return null;
	const parts: string[] = [];
	for (const seg of p.split('/')) {
		if (seg === '' || seg === '.') continue;
		if (seg === '..') return null; // path traversal
		if (/^[A-Za-z]:$/.test(seg)) return null; // windows drive
		parts.push(seg);
	}
	return parts.length ? parts.join('/') : null;
}

export function isSecretPath(path: string): boolean {
	const base = path.split('/').pop() || '';
	if (ENV_TEMPLATE.test(base) && /^\.env/i.test(base)) return false;
	return SECRET_BASENAME.test(base) || SECRET_EXT.test(base) || SECRET_DIR.test(path);
}

export function pathExcludeReason(path: string, sizeBytes: number): ExcludeReason | null {
	if (isSecretPath(path)) return 'secret';
	const parts = path.split('/');
	if (parts.slice(0, -1).some((d) => IGNORED_DIRS.has(d))) return 'ignored_dir';
	const base = parts[parts.length - 1];
	if (LOCKFILES.has(base)) return 'lockfile';
	if (/\.min\.(js|css)$/i.test(base) || /\.map$/i.test(base)) return 'generated';
	const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
	if (BINARY_EXT.has(ext)) return 'binary';
	if (sizeBytes === 0) return 'empty';
	if (sizeBytes > PM_LIMITS.maxIndexedFileBytes) return 'too_large';
	return null;
}

/** Heuristic: NUL byte in the first 8 KB means binary. */
export function looksBinary(buf: Buffer): boolean {
	const n = Math.min(buf.length, 8192);
	for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
	return false;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
	[/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]'],
	[/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'sk-[REDACTED]'],
	[/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, 'gh_[REDACTED]'],
	[/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[REDACTED]'],
	[/\bAIza[0-9A-Za-z_-]{30,}\b/g, 'AIza[REDACTED]'],
	[/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, 'xox-[REDACTED]'],
	[/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'jwt.[REDACTED]'],
];

/**
 * Assignments of literal secrets. Deliberately narrow so source code stays readable:
 *  - env-style lines: UPPER_CASE secret-looking name, unquoted value of 8+ chars that is not a code reference;
 *  - quoted string literals of 8+ chars (no spaces/templates) that contain a digit or are 12+ chars long, assigned to a
 *    secret-looking name.
 * References such as process.env.X, ${VAR}, function calls and short or placeholder values are left alone.
 */
const ENV_ASSIGNMENT_RE =
	/^([ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Z0-9_]*[ \t]*=[ \t]*)(?!["'])(?!your|change|example|xxx|process|\[REDACTED)([^\s#"'$`(){}<]{8,})/gm;
const QUOTED_ASSIGNMENT_RE =
	/\b([A-Za-z0-9_$.]*(?:secret|password|passwd|token|api_?key|private_?key|access_?key)[A-Za-z0-9_]*)(["']?\s*[:=]\s*)(["'])(?!your|change|example|xxx|test|dummy|placeholder|\[REDACTED)(?=[^"'\s$`{}]*\d|[^"'\s$`{}]{12,}\3)([^"'\s$`{}]{8,})\3/gi;

/** Removes secret-looking values before content is stored or sent to any AI provider. */
export function redactSecrets(text: string): { text: string; redactions: number } {
	let count = 0;
	let out = text;
	for (const [re, rep] of SECRET_PATTERNS) {
		out = out.replace(re, () => {
			count++;
			return rep;
		});
	}
	out = out.replace(ENV_ASSIGNMENT_RE, (_m, head: string) => {
		count++;
		return `${head}[REDACTED]`;
	});
	out = out.replace(QUOTED_ASSIGNMENT_RE, (_m, name: string, sep: string, quote: string) => {
		count++;
		return `${name}${sep}${quote}[REDACTED]${quote}`;
	});
	return { text: out, redactions: count };
}
