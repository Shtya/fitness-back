import {
	MEDIA_DOWNLOAD_MAX_ATTEMPTS,
	isTerminalMediaDownloadError,
	mediaDownloadOutcome,
	mediaDownloadRetryDelayMs,
	redactMediaLog,
} from './whatsapp-media-download-policy';

describe('whatsapp media download policy', () => {
	it('retries transient CDN failures and then stops', () => {
		expect(mediaDownloadOutcome(1, 'fetch failed')).toBe('retry');
		expect(mediaDownloadOutcome(2, 'socket hang up')).toBe('retry');
		expect(mediaDownloadOutcome(MEDIA_DOWNLOAD_MAX_ATTEMPTS, 'timeout')).toBe('failed');
	});

	it('dead-letters errors that will not succeed on retry', () => {
		expect(isTerminalMediaDownloadError('Baileys returned empty media')).toBe(true);
		expect(mediaDownloadOutcome(1, 'Provider returned a thumbnail instead of video')).toBe(
			'failed',
		);
		expect(mediaDownloadOutcome(1, 'Media file exceeds limit (999 bytes)')).toBe('failed');
	});

	it('backs off and caps the wait', () => {
		expect(mediaDownloadRetryDelayMs(1)).toBe(2_000);
		expect(mediaDownloadRetryDelayMs(2)).toBe(4_000);
		expect(mediaDownloadRetryDelayMs(8)).toBe(30_000);
	});

	it('strips URLs and key material from logs', () => {
		expect(
			redactMediaLog('failed https://mmg.whatsapp.net/v/abc mediaKey=AQIDBA=='),
		).toBe('failed [url] mediaKey=[redacted]');
	});
});
