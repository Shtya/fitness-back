import { HttpException, HttpStatus } from '@nestjs/common';

export type AiErrorCode =
	| 'AI_NOT_CONFIGURED'
	| 'AI_MODEL_NOT_FOUND'
	| 'AI_MODEL_DISABLED'
	| 'AI_PROVIDER_UNAVAILABLE'
	| 'AI_LIMIT_REACHED'
	| 'AI_KEY_INVALID'
	| 'AI_PROVIDER_ERROR'
	| 'AI_EMPTY_RESPONSE';

export class AiException extends HttpException {
	readonly aiCode: AiErrorCode;

	constructor(aiCode: AiErrorCode, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
		super({ statusCode: status, message, code: aiCode }, status);
		this.aiCode = aiCode;
	}
}

export function aiNotConfigured(provider = 'gemini') {
	return new AiException(
		'AI_NOT_CONFIGURED',
		`No API key is saved for ${provider}. Add it from AI Settings.`,
		HttpStatus.BAD_REQUEST,
	);
}

export function aiLimitReached(kind: 'cost' | 'requests' | 'images' | 'provider') {
	return new AiException(
		'AI_LIMIT_REACHED',
		kind === 'provider'
			? 'Monthly limit for this AI provider was reached. The request was not sent.'
			: `Monthly AI ${kind} limit reached. The request was not sent to the provider.`,
		HttpStatus.TOO_MANY_REQUESTS,
	);
}

export function sanitizeProviderMessage(raw: unknown): string {
	const text = String(raw || 'AI provider error');
	return text
		.replace(/key=[^&\s]+/gi, 'key=REDACTED')
		.replace(/AIza[0-9A-Za-z_-]{20,}/g, 'REDACTED')
		.replace(/sk-[A-Za-z0-9_-]{10,}/g, 'REDACTED')
		.slice(0, 400);
}
