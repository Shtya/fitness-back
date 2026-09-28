import { Logger, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { Readable } from 'stream';
import { pipeline } from 'stream';

const CLIENT_ABORT_CODES = new Set(['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'EPIPE', 'ECONNABORTED']);
const logger = new Logger('WhatsAppMediaStream');

/** The browser cancelled the request (chat switch, scroll, seek) — not a server fault. */
export function isClientAbortError(error: unknown): boolean {
	const err = error as { code?: string; message?: string } | null;
	return Boolean(err && (CLIENT_ABORT_CODES.has(String(err.code)) || /premature close/i.test(String(err.message))));
}

function logStreamError(error: unknown) {
	if (isClientAbortError(error)) return;
	logger.warn(`Media stream failed: ${(error as Error)?.message || String(error)}`);
}

export function quietStreamableFile(stream: Readable): StreamableFile {
	return new StreamableFile(stream).setErrorLogger(logStreamError);
}

/** `.pipe(res)` leaves read errors unhandled (process-level 'error'); pipeline cleans up both ends. */
export function pipeFileToResponse(stream: Readable, res: Response): void {
	pipeline(stream, res, error => {
		if (error) logStreamError(error);
	});
}
