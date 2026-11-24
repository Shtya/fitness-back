import { idf, pathPrior, pathTokens, scoreChunk, termMatchesToken } from './retrieval-scoring';

describe('retrieval scoring', () => {
	it('tokenizes paths including camelCase and separators', () => {
		expect(pathTokens('backend/common/security-headers.ts')).toEqual(['backend', 'common', 'security', 'headers', 'ts']);
		expect(pathTokens('src/QueryFailedErrorFilter.ts')).toEqual(['src', 'query', 'failed', 'error', 'filter', 'ts']);
	});

	it('matches terms to tokens by equality or long-prefix only', () => {
		expect(termMatchesToken('auth', 'auth')).toBe(true);
		expect(termMatchesToken('authentication', 'auth')).toBe(true);
		expect(termMatchesToken('logins', 'login')).toBe(true);
		expect(termMatchesToken('a', 'auth')).toBe(false);
		expect(termMatchesToken('use', 'user')).toBe(false); // too short for prefix matching
	});

	it('gives rare terms more weight than common ones', () => {
		expect(idf(10000, 3)).toBeGreaterThan(idf(10000, 5000));
		expect(idf(10, 10)).toBeGreaterThan(0);
	});

	it('penalizes tests, translations and styles but not config manifests', () => {
		expect(pathPrior('src/a.spec.ts')).toBeLessThan(1);
		expect(pathPrior('messages/en.json')).toBeLessThan(pathPrior('README.md'));
		expect(pathPrior('src/x.css')).toBeLessThan(1);
		expect(pathPrior('backend/vercel.json')).toBe(1);
		expect(pathPrior('backend/package.json')).toBe(1);
	});

	it('ranks a file whose name matches rare terms above a chunk that only repeats common terms', () => {
		const terms = ['security', 'headers', 'set'];
		const weights = [idf(10000, 20), idf(10000, 30), idf(10000, 4000)];
		const headersFile = scoreChunk({ path: 'backend/common/security-headers.ts', symbols: 'securityHeaders', matched: [0, 1], terms, weights });
		const noisy = scoreChunk({ path: 'frontend/src/app/dashboard/Workspace.jsx', symbols: '', matched: [2], terms, weights });
		expect(headersFile).toBeGreaterThan(noisy * 5);
	});

	it('ignores terms that do not occur in the project (weight 0) and never returns NaN', () => {
		const s = scoreChunk({ path: 'a/b.ts', symbols: '', matched: [0], terms: ['kafka', 'topic'], weights: [0, 0] });
		expect(s).toBe(0);
		expect(Number.isNaN(s)).toBe(false);
	});

	it('test files rank below equally matching source files', () => {
		const base = { symbols: '', matched: [0], terms: ['login'], weights: [3] };
		expect(scoreChunk({ ...base, path: 'src/auth/auth.service.ts' })).toBeGreaterThan(scoreChunk({ ...base, path: 'src/auth/auth.service.spec.ts' }));
	});
});
