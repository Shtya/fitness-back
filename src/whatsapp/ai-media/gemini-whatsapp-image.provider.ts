import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
	WhatsAppAiImageProvider,
	WhatsAppAiImageRequest,
	WhatsAppAiImageResult,
	WhatsAppAiModelOption,
} from './whatsapp-ai-image.provider';
import { buildWhatsAppAiPrompt } from './whatsapp-ai-prompt';

@Injectable()
export class GeminiWhatsAppImageProvider implements WhatsAppAiImageProvider {
	readonly id = 'gemini';

	private apiKey() {
		return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim();
	}

	listModels(): WhatsAppAiModelOption[] {
		const model = process.env.WHATSAPP_AI_GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
		const available = Boolean(this.apiKey());
		return [
			{
				id: `gemini:${model}`,
				provider: 'gemini',
				model,
				label: 'Gemini Flash Image (Nano Banana)',
				free: false,
				available,
				supportsReference: true,
				hint: available
					? 'Paid Gemini image API'
					: 'Not free. Needs GEMINI_API_KEY and Google billing',
			},
		];
	}

	async generate(request: WhatsAppAiImageRequest): Promise<WhatsAppAiImageResult> {
		const apiKey = this.apiKey();
		if (!apiKey) {
			throw new ServiceUnavailableException(
				'Gemini image generation is not free on the API. Set GEMINI_API_KEY with billing enabled, or keep using Pollinations.',
			);
		}
		const prompt = buildWhatsAppAiPrompt(
			request.kind,
			request.prompt,
			Boolean(request.reference?.buffer?.length),
		);
		const model =
			String(request.model || '').trim() ||
			process.env.WHATSAPP_AI_GEMINI_IMAGE_MODEL ||
			'gemini-2.5-flash-image';
		const parts: any[] = [{ text: prompt }];
		if (request.reference?.buffer?.length) {
			parts.unshift({
				inlineData: {
					mimeType: request.reference.mimeType || 'image/png',
					data: request.reference.buffer.toString('base64'),
				},
			});
		}
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contents: [{ role: 'user', parts }],
				generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
			}),
			signal: request.signal,
		});
		const raw = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new ServiceUnavailableException(
				raw?.error?.message || `Gemini image failed (${response.status})`,
			);
		}
		const inline =
			raw?.candidates?.[0]?.content?.parts?.find((part: any) => part?.inlineData?.data)
				?.inlineData;
		if (!inline?.data) {
			throw new ServiceUnavailableException('Gemini returned no image data');
		}
		return {
			buffer: Buffer.from(inline.data, 'base64'),
			mimeType: inline.mimeType || 'image/png',
			provider: this.id,
			model,
			seed: request.seed,
		};
	}
}
