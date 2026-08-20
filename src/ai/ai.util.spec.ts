import { estimateUsageCost, effectiveLimit, usagePercent, warningLevel } from './ai.util';
import { sanitizeProviderMessage } from './ai.errors';

describe('AI cost and limits helpers', () => {
	const pricing = {
		inputPerMillion: 0.25,
		outputPerMillion: 1.5,
		imagePerUnit: 0.0336,
		currency: 'USD' as const,
	};

	it('estimates text cost from token pricing', () => {
		expect(estimateUsageCost({ pricing, promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBeCloseTo(1.75, 6);
	});

	it('estimates image cost from per-image pricing', () => {
		expect(estimateUsageCost({ pricing, imageCount: 2 })).toBeCloseTo(0.0672, 6);
	});

	it('applies an optional safety buffer to the hard stop', () => {
		expect(effectiveLimit(100, 10)).toBe(90);
		expect(effectiveLimit(20, 0)).toBe(20);
	});

	it('raises warning levels at 80, 90, and 100 percent', () => {
		expect(warningLevel(usagePercent(79, 100), true)).toBeNull();
		expect(warningLevel(usagePercent(80, 100), true)).toBe(80);
		expect(warningLevel(usagePercent(90, 100), true)).toBe(90);
		expect(warningLevel(usagePercent(100, 100), true)).toBe(100);
		expect(warningLevel(100, false)).toBeNull();
	});
});

describe('sanitizeProviderMessage', () => {
	it('redacts API keys from provider errors', () => {
		expect(sanitizeProviderMessage('Gemini HTTP 400 key=AIzaSySecretValueABCDEFG')).not.toContain('AIzaSySecretValueABCDEFG');
		expect(sanitizeProviderMessage('bad sk-or-v1-abcdefghijklmnop')).not.toContain('sk-or-v1-abcdefghijklmnop');
	});
});
