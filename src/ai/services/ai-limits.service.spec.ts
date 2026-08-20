import { HttpStatus } from '@nestjs/common';
import { AiLimitsService } from './ai-limits.service';
import { AiException } from '../ai.errors';

function period(patch: Partial<{ estimatedCost: string; reservedCost: string; requestCount: number; reservedRequests: number; imageCount: number; reservedImages: number }>) {
	return {
		estimatedCost: '0',
		reservedCost: '0',
		requestCount: 0,
		reservedRequests: 0,
		imageCount: 0,
		reservedImages: 0,
		...patch,
	};
}

describe('AiLimitsService hard stop', () => {
	it('blocks a request that would exceed the reserved+used cost', async () => {
		const service = new AiLimitsService({} as any, {} as any, {} as any, {} as any);
		const settings = {
			monthlyCostLimit: '1',
			monthlyRequestLimit: 1000,
			monthlyImageLimit: 100,
			safetyBufferPercent: '0',
		};
		expect(() =>
			(service as any).assertWithinLimits(settings, period({ estimatedCost: '0.6', reservedCost: '0.3' }), {
				cost: 0.2,
				requests: 1,
				images: 0,
			}),
		).toThrow(AiException);
	});

	it('counts in-flight reservations so concurrent requests cannot bypass the cap', () => {
		const service = new AiLimitsService({} as any, {} as any, {} as any, {} as any);
		const settings = {
			monthlyCostLimit: '20',
			monthlyRequestLimit: 2,
			monthlyImageLimit: 100,
			safetyBufferPercent: '0',
		};
		expect(() =>
			(service as any).assertWithinLimits(settings, period({ requestCount: 1, reservedRequests: 1 }), {
				cost: 0,
				requests: 1,
				images: 0,
			}),
		).toThrow(AiException);
		try {
			(service as any).assertWithinLimits(settings, period({ requestCount: 1, reservedRequests: 1 }), {
				cost: 0,
				requests: 1,
				images: 0,
			});
		} catch (err: any) {
			expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
			expect(err.aiCode).toBe('AI_LIMIT_REACHED');
		}
	});
});
