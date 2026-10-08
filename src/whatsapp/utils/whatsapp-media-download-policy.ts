/** Background pulls stop after this many attempts. A user opening the file starts a fresh cycle. */
export const MEDIA_DOWNLOAD_MAX_ATTEMPTS = 3;

const TERMINAL_MEDIA_ERROR =
	/empty media|thumbnail|no media key|not available in the current session|file exceeds|invalid audio|media message id is required|no valid media/i;

export function redactMediaLog(value: string): string {
	return String(value || '')
		.replace(/https?:\/\/\S+/gi, '[url]')
		.replace(/(mediaKey|fileEncSha256|fileSha256|directPath)[=:][^\s,]+/gi, '$1=[redacted]')
		.slice(0, 240);
}

export function isTerminalMediaDownloadError(message: string): boolean {
	return TERMINAL_MEDIA_ERROR.test(String(message || ''));
}

/** `retry` schedules another pull. `failed` is the dead-letter state. */
export function mediaDownloadOutcome(
	attempt: number,
	errorMessage: string,
): 'retry' | 'failed' {
	if (isTerminalMediaDownloadError(errorMessage)) return 'failed';
	if (attempt >= MEDIA_DOWNLOAD_MAX_ATTEMPTS) return 'failed';
	return 'retry';
}

export function mediaDownloadRetryDelayMs(attempt: number): number {
	const step = Math.max(1, attempt);
	return Math.min(30_000, 2_000 * 2 ** (step - 1));
}
