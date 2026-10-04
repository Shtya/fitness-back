export type FbErrorKind =
	| 'TOKEN_INVALID'
	| 'PERMISSION_DENIED'
	| 'RATE_LIMITED'
	| 'POLICY_BLOCKED'
	| 'INVALID_REQUEST'
	| 'DUPLICATE'
	| 'TRANSIENT'
	| 'NETWORK'
	| 'UNKNOWN_OUTCOME'
	| 'NOT_SUPPORTED'
	| 'UNKNOWN';

export type FbErrorClassification = {
	kind: FbErrorKind;
	retryable: boolean;
	invalidatesToken: boolean;
	pausesCampaign: boolean;
	userMessage: string;
};

export class FacebookGraphError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: number | null,
		readonly subcode: number | null,
		readonly isTransient: boolean,
		readonly networkPhase: 'none' | 'before_send' | 'after_send' = 'none',
	) {
		super(message);
		this.name = 'FacebookGraphError';
	}
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001]);
const TOKEN_CODES = new Set([102, 190]);

function build(
	kind: FbErrorKind,
	userMessage: string,
	flags: Partial<Omit<FbErrorClassification, 'kind' | 'userMessage'>> = {},
): FbErrorClassification {
	return {
		kind,
		userMessage,
		retryable: flags.retryable ?? false,
		invalidatesToken: flags.invalidatesToken ?? false,
		pausesCampaign: flags.pausesCampaign ?? false,
	};
}

export function classifyFacebookError(error: unknown): FbErrorClassification {
	if (!(error instanceof FacebookGraphError)) {
		return build('UNKNOWN', 'Unexpected error while talking to Facebook.');
	}

	if (error.networkPhase === 'before_send') {
		return build('NETWORK', 'Could not reach Facebook. It will be retried.', { retryable: true });
	}
	if (error.networkPhase === 'after_send') {
		return build(
			'UNKNOWN_OUTCOME',
			'Facebook did not confirm the result. Check the post before retrying to avoid a duplicate comment.',
		);
	}

	const code = error.code;
	if (code !== null && TOKEN_CODES.has(code)) {
		return build('TOKEN_INVALID', 'The Facebook access token is invalid or expired. Reconnect the account.', {
			invalidatesToken: true,
			pausesCampaign: true,
		});
	}
	if (code === 10 || (code !== null && code >= 200 && code <= 299)) {
		return build(
			'PERMISSION_DENIED',
			'This Page is missing the permission to publish comments (pages_manage_engagement / MODERATE task).',
		);
	}
	if (code !== null && RATE_LIMIT_CODES.has(code)) {
		return build('RATE_LIMITED', 'Facebook rate limit reached. Publishing will resume automatically.', {
			retryable: true,
		});
	}
	if (code === 368) {
		return build(
			'POLICY_BLOCKED',
			'Facebook temporarily blocked this action for policy reasons. The campaign was paused.',
			{ pausesCampaign: true },
		);
	}
	if (code === 506) {
		return build('DUPLICATE', 'Facebook rejected this comment as a duplicate.');
	}
	if (code === 100) {
		return build('INVALID_REQUEST', error.message || 'Facebook rejected the request.');
	}
	if (code === 1 || code === 2 || error.isTransient || error.status === 503) {
		return build('TRANSIENT', 'Facebook is temporarily unavailable. It will be retried.', { retryable: true });
	}
	if (error.status >= 500) {
		return build(
			'UNKNOWN_OUTCOME',
			'Facebook returned a server error. Check the post before retrying to avoid a duplicate comment.',
		);
	}
	return build('UNKNOWN', error.message || 'Facebook rejected the request.');
}

const BASE_BACKOFF_MS = 60_000;
const RATE_LIMIT_BACKOFF_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;

export function retryDelayMs(kind: FbErrorKind, attempt: number) {
	const base = kind === 'RATE_LIMITED' ? RATE_LIMIT_BACKOFF_MS : BASE_BACKOFF_MS;
	const exponent = Math.max(0, attempt - 1);
	return Math.min(base * 2 ** exponent, MAX_BACKOFF_MS);
}
