import { AiService } from './ai.service';
import { AiException } from './ai.errors';
import { HttpStatus } from '@nestjs/common';

describe('AiService facade', () => {
	const user = { id: 'user-1', tenantId: 'ws-1' };

	function create(overrides: Record<string, any> = {}) {
		const models = {
			resolve: jest.fn(async (_ws, type, model) => ({
				modelKey: model || (type === 'text' ? 'gemini-3.1-flash-lite' : 'gemini-3.1-flash-lite-image'),
				provider: 'gemini',
				pricing: { inputPerMillion: 0.25, outputPerMillion: 1.5, imagePerUnit: 0.0336, currency: 'USD' },
			})),
		};
		const credentials = {
			getApiKey: jest.fn(async () => 'secret-key'),
			publicStatus: jest.fn(),
			save: jest.fn(),
			markVerified: jest.fn(),
			remove: jest.fn(),
		};
		const providers = {
			requireCapability: jest.fn(() => ({
				generateText: jest.fn(async () => ({
					text: 'hello',
					model: 'gemini-3.1-flash-lite',
					promptTokens: 10,
					completionTokens: 5,
					totalTokens: 15,
				})),
				generateImage: jest.fn(async () => ({
					imageUrl: 'data:image/png;base64,xx',
					mimeType: 'image/png',
					model: 'gemini-3.1-flash-lite-image',
					promptTokens: 8,
					completionTokens: 0,
					totalTokens: 8,
					imageCount: 1,
				})),
			})),
			get: jest.fn(),
			list: jest.fn(() => []),
		};
		const limits = {
			reserve: jest.fn(async () => ({
				periodId: 'p1',
				periodKey: '2026-08',
				reservedCost: 0.01,
				reservedRequests: 1,
				reservedImages: 0,
			})),
			settle: jest.fn(async () => ({ estimatedCost: 0.01 })),
			logBlocked: jest.fn(),
			getFeatureDefaults: jest.fn(async () => ({})),
		};
		const router = {
			route: jest.fn(async (_ws, type, model) => ({
				model: {
					modelKey: model || (type === 'text' ? 'gemini-3.1-flash-lite' : 'gemini-3.1-flash-lite-image'),
					provider: 'gemini',
					pricing: { inputPerMillion: 0.25, outputPerMillion: 1.5, imagePerUnit: 0.0336, currency: 'USD' },
				},
				provider: providers.requireCapability(),
			})),
		};
		const service = new AiService(
			{ ...models, ...(overrides.models || {}) } as any,
			{ ...credentials, ...(overrides.credentials || {}) } as any,
			{ ...providers, ...(overrides.providers || {}) } as any,
			{ ...limits, ...(overrides.limits || {}) } as any,
			{ ...router, ...(overrides.router || {}) } as any,
		);
		return { service, models, credentials, providers, limits, router };
	}

	it('uses the default model when none is passed', async () => {
		const { service, router } = create();
		const result = await service.generateText({ prompt: 'hi', user });
		expect(router.route).toHaveBeenCalledWith('ws-1', 'text', undefined);
		expect(result).toEqual({ text: 'hello', model: 'gemini-3.1-flash-lite' });
	});

	it('does not call the provider when the monthly limit is already reached', async () => {
		const generateText = jest.fn();
		const logBlocked = jest.fn();
		const { service } = create({
			limits: {
				reserve: jest.fn(async () => {
					throw new AiException('AI_LIMIT_REACHED', 'Monthly AI cost limit reached.', HttpStatus.TOO_MANY_REQUESTS);
				}),
				settle: jest.fn(),
				logBlocked,
			},
			router: {
				route: jest.fn(async () => ({
					model: {
						modelKey: 'gemini-3.1-flash-lite',
						provider: 'gemini',
						pricing: { inputPerMillion: 0.25, outputPerMillion: 1.5, imagePerUnit: 0, currency: 'USD' },
					},
					provider: { generateText },
				})),
			},
		});
		await expect(service.generateText({ prompt: 'hi', user })).rejects.toMatchObject({ aiCode: 'AI_LIMIT_REACHED' });
		expect(generateText).not.toHaveBeenCalled();
		expect(logBlocked).toHaveBeenCalled();
	});

	it('never returns the API key in generate results', async () => {
		const { service } = create();
		const result = await service.generateText({ prompt: 'hi', user, model: 'gemini-3.1-flash-lite' });
		expect(JSON.stringify(result)).not.toContain('secret-key');
	});

	it('uses the stored feature default when the caller omits a model', async () => {
		const { service, router, limits } = create();
		limits.getFeatureDefaults.mockResolvedValue({ studio: 'gemini-2.5-flash' });
		await service.generateText({ prompt: 'hi', user, feature: 'studio' });
		expect(limits.getFeatureDefaults).toHaveBeenCalledWith('ws-1');
		expect(router.route).toHaveBeenCalledWith('ws-1', 'text', 'gemini-2.5-flash');
	});
});
