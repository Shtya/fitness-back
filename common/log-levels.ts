import type { LogLevel } from '@nestjs/common';

const ORDER: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

/**
 * `LOG_LEVEL` is the most verbose level to print (default `log`).
 * Per-event WhatsApp traces (presence, raw events) are `debug` and stay off unless enabled.
 */
export function resolveLogLevels(env: NodeJS.ProcessEnv = process.env): LogLevel[] {
	const requested = String(env.LOG_LEVEL || 'log').trim().toLowerCase() as LogLevel;
	const index = ORDER.indexOf(requested);
	return ORDER.slice(0, index === -1 ? ORDER.indexOf('log') + 1 : index + 1);
}
