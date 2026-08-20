import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
	WhatsAppAiImageProvider,
	WhatsAppAiImageRequest,
	WhatsAppAiImageResult,
	WhatsAppAiModelOption,
} from './whatsapp-ai-image.provider';
import { buildWhatsAppAiPrompt } from './whatsapp-ai-prompt';

@Injectable()
export class HuggingFaceWhatsAppImageProvider implements WhatsAppAiImageProvider {
	readonly id = 'huggingface';

	private apiKey() {
		return String(process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '').trim();
	}

	listModels(): WhatsAppAiModelOption[] {
		const model = process.env.WHATSAPP_AI_HF_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell';
		const available = Boolean(this.apiKey());
		return [
			{
				id: `huggingface:${model}`,
				provider: 'huggingface',
				model,
				label: 'Hugging Face FLUX',
				free: false,
				available,
				supportsReference: false,
				hint: available ? 'Uses HUGGINGFACE_API_KEY' : 'Needs HUGGINGFACE_API_KEY',
			},
		];
	}

	async generate(request: WhatsAppAiImageRequest): Promise<WhatsAppAiImageResult> {
		const apiKey = this.apiKey();
		if (!apiKey) {
			throw new ServiceUnavailableException(
				'Hugging Face is not configured. Set HUGGINGFACE_API_KEY or keep using Pollinations.',
			);
		}
		const prompt = buildWhatsAppAiPrompt(
			request.kind,
			request.prompt,
			Boolean(request.reference?.buffer?.length),
		);
		const model =
			String(request.model || '').trim() ||
			process.env.WHATSAPP_AI_HF_IMAGE_MODEL ||
			'black-forest-labs/FLUX.1-schnell';
		const response = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				Accept: 'image/*',
			},
			body: JSON.stringify({ inputs: prompt }),
			signal: request.signal,
		});
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new ServiceUnavailableException(
				`Hugging Face image failed (${response.status}): ${body.slice(0, 160)}`,
			);
		}
		const mimeType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0];
		const buffer = Buffer.from(await response.arrayBuffer());
		if (!buffer.length) {
			throw new ServiceUnavailableException('Hugging Face returned an empty image');
		}
		return {
			buffer,
			mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
			provider: this.id,
			model,
			seed: request.seed,
		};
	}
}
