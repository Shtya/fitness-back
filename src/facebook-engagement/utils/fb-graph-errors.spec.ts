import { classifyFacebookError, FacebookGraphError, retryDelayMs } from './fb-graph-errors';

const graphError = (code: number | null, status = 400, transient = false) =>
	new FacebookGraphError('boom', status, code, null, transient);

describe('classifyFacebookError', () => {
	it('treats invalid tokens as non-retryable and pausing', () => {
		expect(classifyFacebookError(graphError(190))).toMatchObject({
			kind: 'TOKEN_INVALID',
			retryable: false,
			invalidatesToken: true,
			pausesCampaign: true,
		});
	});

	it('maps permission errors (10 and 2xx) to PERMISSION_DENIED', () => {
		expect(classifyFacebookError(graphError(10)).kind).toBe('PERMISSION_DENIED');
		expect(classifyFacebookError(graphError(200)).kind).toBe('PERMISSION_DENIED');
		expect(classifyFacebookError(graphError(200)).retryable).toBe(false);
	});

	it('retries rate limits and transient errors', () => {
		for (const code of [4, 17, 32, 613]) {
			expect(classifyFacebookError(graphError(code))).toMatchObject({ kind: 'RATE_LIMITED', retryable: true });
		}
		expect(classifyFacebookError(graphError(2))).toMatchObject({ kind: 'TRANSIENT', retryable: true });
		expect(classifyFacebookError(graphError(null, 400, true))).toMatchObject({ kind: 'TRANSIENT', retryable: true });
	});

	it('pauses on policy blocks and never retries them', () => {
		expect(classifyFacebookError(graphError(368))).toMatchObject({
			kind: 'POLICY_BLOCKED',
			retryable: false,
			pausesCampaign: true,
		});
	});

	it('does not retry when the outcome is unknown (avoids duplicate comments)', () => {
		const afterSend = new FacebookGraphError('net', 0, null, null, false, 'after_send');
		expect(classifyFacebookError(afterSend)).toMatchObject({ kind: 'UNKNOWN_OUTCOME', retryable: false });
		expect(classifyFacebookError(graphError(null, 502))).toMatchObject({ kind: 'UNKNOWN_OUTCOME', retryable: false });
	});

	it('retries network failures that happened before the request was sent', () => {
		const beforeSend = new FacebookGraphError('net', 0, null, null, false, 'before_send');
		expect(classifyFacebookError(beforeSend)).toMatchObject({ kind: 'NETWORK', retryable: true });
	});

	it('handles non-Graph errors', () => {
		expect(classifyFacebookError(new Error('x')).kind).toBe('UNKNOWN');
	});
});

describe('retryDelayMs', () => {
	it('backs off exponentially with a cap', () => {
		expect(retryDelayMs('TRANSIENT', 1)).toBe(60_000);
		expect(retryDelayMs('TRANSIENT', 2)).toBe(120_000);
		expect(retryDelayMs('RATE_LIMITED', 1)).toBe(300_000);
		expect(retryDelayMs('RATE_LIMITED', 10)).toBe(30 * 60_000);
	});
});
