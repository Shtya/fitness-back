import { resolveLogLevels } from './log-levels';

describe('resolveLogLevels', () => {
	it('defaults to log and hides debug/verbose', () => {
		expect(resolveLogLevels({})).toEqual(['fatal', 'error', 'warn', 'log']);
	});

	it('enables debug when requested', () => {
		expect(resolveLogLevels({ LOG_LEVEL: 'debug' })).toContain('debug');
		expect(resolveLogLevels({ LOG_LEVEL: 'debug' })).not.toContain('verbose');
	});

	it('falls back to log on unknown values', () => {
		expect(resolveLogLevels({ LOG_LEVEL: 'loud' })).toEqual(['fatal', 'error', 'warn', 'log']);
	});

	it('supports warn-only', () => {
		expect(resolveLogLevels({ LOG_LEVEL: 'warn' })).toEqual(['fatal', 'error', 'warn']);
	});
});
