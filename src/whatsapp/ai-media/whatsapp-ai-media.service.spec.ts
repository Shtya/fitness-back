import { promises as fs } from 'fs';
import { buildWhatsAppAiPrompt } from './whatsapp-ai-prompt';
import { WhatsAppAiMediaService } from './whatsapp-ai-media.service';

describe('buildWhatsAppAiPrompt', () => {
	it('builds a sticker prompt with transparent-background guidance', () => {
		const prompt = buildWhatsAppAiPrompt('sticker', 'sleepy cat saying good night');
		expect(prompt).toMatch(/WhatsApp sticker/i);
		expect(prompt).toMatch(/transparent background/i);
		expect(prompt).toMatch(/sleepy cat/i);
	});

	it('mentions the reference when one is present', () => {
		const prompt = buildWhatsAppAiPrompt('sticker', 'waving', true);
		expect(prompt).toMatch(/referenced sticker/i);
	});
});

describe('WhatsAppAiMediaService', () => {
	function createService(generate = jest.fn()) {
		const providers = [{ id: 'pollinations', generate, listModels: jest.fn().mockReturnValue([]) }];
		const access = { assertAccountPermission: jest.fn().mockResolvedValue(undefined) };
		const stickers = { stream: jest.fn() };
		const service = new WhatsAppAiMediaService(providers as any, access as any, stickers as any);
		return { service, generate, access, stickers, providers };
	}

	it('sends sticker jobs through the configured provider', async () => {
		const { service, generate, access } = createService(
			jest.fn().mockResolvedValue({
				buffer: Buffer.from('png'),
				mimeType: 'image/png',
				provider: 'pollinations',
				model: 'flux',
				seed: 9,
			}),
		);

		const result = await service.generate({ id: 'user-1' } as any, 'account-1', {
			kind: 'sticker',
			prompt: 'happy falafel',
			seed: 9,
		});

		expect(access.assertAccountPermission).toHaveBeenCalledWith(
			{ id: 'user-1' },
			'account-1',
			'canUse',
		);
		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'sticker', prompt: 'happy falafel', seed: 9 }),
		);
		expect(result.fileName).toBe('ai-sticker.png');
		expect(result.base64).toBe(Buffer.from('png').toString('base64'));
	});

	it('rejects empty prompts', async () => {
		const { service } = createService();
		await expect(
			service.generate({ id: 'user-1' } as any, 'account-1', { kind: 'image', prompt: ' ' }),
		).rejects.toThrow('Prompt is required');
	});

	it('uses an existing sticker as the reference image', async () => {
		const { service, generate, stickers } = createService(
			jest.fn().mockResolvedValue({
				buffer: Buffer.from('png'),
				mimeType: 'image/png',
				provider: 'pollinations',
				model: 'flux',
			}),
		);
		stickers.stream.mockResolvedValue({
			absolutePath: '/tmp/sticker.webp',
			mimeType: 'image/webp',
		});
		const readFile = jest
			.spyOn(fs, 'readFile')
			.mockResolvedValue(Buffer.from('sticker-bytes') as any);

		const result = await service.generate({ id: 'user-1' } as any, 'account-1', {
			kind: 'sticker',
			prompt: 'waving hello',
			stickerId: 'sticker-9',
		});

		expect(stickers.stream).toHaveBeenCalledWith({ id: 'user-1' }, 'account-1', 'sticker-9');
		expect(generate).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'sticker',
				prompt: 'waving hello',
				reference: { buffer: Buffer.from('sticker-bytes'), mimeType: 'image/webp' },
			}),
		);
		expect(result.fileName).toBe('ai-sticker.png');
		readFile.mockRestore();
	});

	it('forwards the selected model to the provider', async () => {
		const { service, generate } = createService(
			jest.fn().mockResolvedValue({
				buffer: Buffer.from('png'),
				mimeType: 'image/png',
				provider: 'pollinations',
				model: 'zimage',
			}),
		);

		await service.generate({ id: 'user-1' } as any, 'account-1', {
			kind: 'image',
			prompt: 'nile sunset',
			model: 'pollinations:zimage',
		});

		expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'zimage' }));
	});
});
