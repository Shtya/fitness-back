import axios from 'axios';
import { PM_LIMITS } from '../projectmind.constants';

export class GithubImportError extends Error {
	constructor(
		public readonly code: 'GITHUB_URL_INVALID' | 'GITHUB_NOT_FOUND' | 'GITHUB_AUTH' | 'GITHUB_TOO_LARGE' | 'GITHUB_RATE_LIMIT' | 'GITHUB_ERROR',
		message: string,
	) {
		super(message);
	}
}

export interface GithubRef {
	owner: string;
	repo: string;
	branch?: string;
}

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_])?$/;

/**
 * Accepts only https://github.com/<owner>/<repo>[.git][/tree/<branch>]. Everything else is rejected, which is
 * the SSRF guard: the server only ever talks to api.github.com / codeload.github.com on fixed hosts.
 */
export function parseGithubUrl(raw: string): GithubRef {
	let u: URL;
	if (/(^|[/\\])\.\.([/\\]|$)/.test(String(raw || '')) || /%2e%2e/i.test(String(raw || ''))) {
		throw new GithubImportError('GITHUB_URL_INVALID', 'The URL must not contain path traversal.');
	}
	try {
		u = new URL(String(raw || '').trim());
	} catch {
		throw new GithubImportError('GITHUB_URL_INVALID', 'Enter a valid https://github.com/owner/repo URL.');
	}
	if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'github.com' || u.port || u.username || u.password) {
		throw new GithubImportError('GITHUB_URL_INVALID', 'Only https://github.com/owner/repo URLs are supported.');
	}
	const seg = u.pathname.split('/').filter(Boolean);
	if (seg.length < 2) throw new GithubImportError('GITHUB_URL_INVALID', 'The URL must include an owner and a repository.');
	const owner = seg[0];
	const repo = seg[1].replace(/\.git$/i, '');
	if (!NAME.test(owner) || !NAME.test(repo) || repo === '.' || repo === '..') {
		throw new GithubImportError('GITHUB_URL_INVALID', 'Owner or repository name is not valid.');
	}
	let branch: string | undefined;
	if (seg[2] === 'tree' && seg.length > 3) {
		branch = seg.slice(3).map(decodeURIComponent).join('/');
		if (!/^[\w./-]{1,200}$/.test(branch) || branch.includes('..')) {
			throw new GithubImportError('GITHUB_URL_INVALID', 'Branch name is not valid.');
		}
	}
	return { owner, repo, branch };
}

export interface GithubDownload {
	zip: Buffer;
	branch: string;
	commitSha: string | null;
}

/**
 * Downloads the repository archive through the GitHub API. `token` (optional, for private repos) is used for
 * this request only and is never stored or logged.
 */
export async function downloadGithubZip(ref: GithubRef, token?: string): Promise<GithubDownload> {
	const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'projectmind-importer' };
	if (token) headers.Authorization = `Bearer ${token}`;
	const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
	try {
		let branch = ref.branch;
		if (!branch) {
			const meta = await axios.get(base, { headers, timeout: 20_000, maxRedirects: 0 });
			branch = String(meta.data?.default_branch || 'main');
		}
		let commitSha: string | null = null;
		try {
			const c = await axios.get(`${base}/commits/${encodeURIComponent(branch)}`, { headers, timeout: 20_000, maxRedirects: 0 });
			commitSha = typeof c.data?.sha === 'string' ? c.data.sha : null;
		} catch {
			/* commit sha is best-effort */
		}
		const res = await axios.get(`${base}/zipball/${encodeURIComponent(branch)}`, {
			headers,
			responseType: 'arraybuffer',
			timeout: 120_000,
			maxContentLength: PM_LIMITS.maxZipBytes,
			maxBodyLength: PM_LIMITS.maxZipBytes,
			maxRedirects: 3,
			// only follow redirects to GitHub's own hosts
			beforeRedirect: (opts: any) => {
				const host = String(opts.hostname || opts.host || '').toLowerCase();
				if (!/(^|\.)github(usercontent)?\.com$/.test(host)) throw new GithubImportError('GITHUB_ERROR', 'Unexpected redirect target.');
			},
		});
		return { zip: Buffer.from(res.data), branch, commitSha };
	} catch (e: any) {
		if (e instanceof GithubImportError) throw e;
		const status = e?.response?.status;
		if (status === 404) throw new GithubImportError('GITHUB_NOT_FOUND', 'Repository or branch not found. Private repositories need a GitHub access token: save one in ProjectMind → Settings.');
		if (status === 401 || status === 403) {
			const limited = String(e?.response?.headers?.['x-ratelimit-remaining'] ?? '') === '0';
			throw new GithubImportError(limited ? 'GITHUB_RATE_LIMIT' : 'GITHUB_AUTH', limited ? 'GitHub rate limit reached. Try again later or provide a token.' : 'GitHub rejected the access token or the repository is private.');
		}
		if (e?.code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED' || /maxContentLength/i.test(String(e?.message))) {
			throw new GithubImportError('GITHUB_TOO_LARGE', 'Repository archive exceeds the size limit.');
		}
		throw new GithubImportError('GITHUB_ERROR', 'Could not download the repository from GitHub.');
	}
}
