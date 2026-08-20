import { AiRouterService } from './ai-router.service';
import { AiException } from '../ai.errors';

describe('AiRouterService', () => {
	it('resolves the default model and its provider', async () => {
		const models = {
			resolve: jest.fn(async () => ({
				modelKey: 'gemini-3.1-flash-lite',
				provider: 'gemini',
				type: 'text',
			})),
		};
		const provider = { id: 'gemini', generateText: jest.fn() };
		const providers = {
			requireCapability: jest.fn(() => provider),
		};
		const router = new AiRouterService(models as any, providers as any);
		const result = await router.route('ws-1', 'text');
		expect(models.resolve).toHaveBeenCalledWith('ws-1', 'text', undefined);
		expect(providers.requireCapability).toHaveBeenCalledWith('gemini', 'text');
		expect(result.model.modelKey).toBe('gemini-3.1-flash-lite');
		expect(result.provider).toBe(provider);
	});

	it('rejects an unimplemented future provider without calling Gemini', async () => {
		const models = {
			resolve: jest.fn(async () => ({ modelKey: 'gpt-4o-mini', provider: 'openai', type: 'text' })),
		};
		const providers = {
			requireCapability: jest.fn(() => {
				throw new AiException('AI_PROVIDER_UNAVAILABLE', 'Provider "openai" is not implemented yet.');
			}),
		};
		const router = new AiRouterService(models as any, providers as any);
		await expect(router.route('ws-1', 'text', 'gpt-4o-mini')).rejects.toMatchObject({
			aiCode: 'AI_PROVIDER_UNAVAILABLE',
		});
	});
});
