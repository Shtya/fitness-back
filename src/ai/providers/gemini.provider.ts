import { HttpStatus, Injectable } from '@nestjs/common';
import { AiException, sanitizeProviderMessage } from '../ai.errors';
import { GEMINI_PROVIDER_ID, AiModelType } from '../ai.constants';
import {
	AiConnectionTestResult,
	AiImageGenerateInput,
	AiImageGenerateResult,
	AiProvider,
	AiProviderCredentials,
	AiTextGenerateInput,
	AiTextGenerateResult,
} from './ai-provider.interface';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

function usageFrom(raw: any) {
	const meta = raw?.usageMetadata || raw?.usage_metadata || {};
	const promptTokens = Number(meta.promptTokenCount || meta.prompt_token_count || 0) || 0;
	const completionTokens = Number(meta.candidatesTokenCount || meta.candidates_token_count || 0) || 0;
	const totalTokens = Number(meta.totalTokenCount || meta.total_token_count || promptTokens + completionTokens) || 0;
	return { promptTokens, completionTokens, totalTokens };
}

function extractText(raw: any): string {
	const parts = raw?.candidates?.[0]?.content?.parts || [];
	return parts.map((p: any) => p?.text).filter(Boolean).join('\n').trim();
}

function extractInlineImage(raw: any): { data: string; mime: string } | null {
	const parts = raw?.candidates?.[0]?.content?.parts || [];
	const inlinePart = parts.find((p: any) => p?.inlineData?.data || p?.inline_data?.data);
	const blob = inlinePart?.inlineData || inlinePart?.inline_data;
	if (blob?.data) {
		return { data: blob.data, mime: blob.mimeType || blob.mime_type || 'image/png' };
	}
	return null;
}

function geminiFail(message: string, status: number, code: string) {
	const http =
		status === 401 || status === 403
			? HttpStatus.BAD_REQUEST
			: status === 429
				? HttpStatus.TOO_MANY_REQUESTS
				: HttpStatus.BAD_GATEWAY;
	return new AiException(
		status === 401 || status === 403 ? 'AI_KEY_INVALID' : 'AI_PROVIDER_ERROR',
		sanitizeProviderMessage(message || code),
		http,
	);
}

@Injectable()
export class GeminiAiProvider implements AiProvider {
	readonly id = GEMINI_PROVIDER_ID;
	readonly name = 'Google Gemini';

	supports(type: AiModelType) {
		return type === 'text' || type === 'image';
	}

	async testConnection(credentials: AiProviderCredentials): Promise<AiConnectionTestResult> {
		if (!credentials?.apiKey) return { ok: false, message: 'Gemini API key is missing' };
		try {
			const res = await fetch(`${GEMINI_API}/models`, {
				headers: { 'x-goog-api-key': credentials.apiKey },
			});
			const raw = await res.json().catch(() => ({}));
			if (!res.ok) {
				return {
					ok: false,
					message: sanitizeProviderMessage((raw as any)?.error?.message || `Gemini HTTP ${res.status}`),
				};
			}
			const count = Array.isArray((raw as any)?.models) ? (raw as any).models.length : 0;
			return { ok: true, message: `Gemini connected (${count} models available)` };
		} catch (err: any) {
			return { ok: false, message: sanitizeProviderMessage(err?.message || 'Gemini connection failed') };
		}
	}

	async generateText(
		input: AiTextGenerateInput,
		credentials: AiProviderCredentials,
	): Promise<AiTextGenerateResult> {
		if (!credentials?.apiKey) throw geminiFail('Gemini API key is missing', 400, 'NOT_CONFIGURED');
		const raw = await this.postGenerate(credentials.apiKey, input.model, {
			contents: [
				{
					role: 'user',
					parts: [
						...(input.system ? [{ text: input.system }] : []),
						{ text: input.prompt },
					],
				},
			],
			generationConfig: {
				temperature: input.temperature ?? 0.7,
				maxOutputTokens: input.maxTokens ?? 4096,
			},
		});
		const text = extractText(raw);
		if (!text) throw new AiException('AI_EMPTY_RESPONSE', 'Gemini returned empty text', HttpStatus.BAD_GATEWAY);
		return { text, model: input.model, ...usageFrom(raw) };
	}

	async generateImage(
		input: AiImageGenerateInput,
		credentials: AiProviderCredentials,
	): Promise<AiImageGenerateResult> {
		if (!credentials?.apiKey) throw geminiFail('Gemini API key is missing', 400, 'NOT_CONFIGURED');
		try {
			return await this.generateImageOnce(input, credentials.apiKey, ['IMAGE']);
		} catch (err: any) {
			const msg = String(err?.message || '').toLowerCase();
			const canRetryModalities =
				err instanceof AiException &&
				err.aiCode !== 'AI_KEY_INVALID' &&
				!msg.includes('quota') &&
				!msg.includes('resource_exhausted') &&
				!msg.includes('429');
			if (canRetryModalities) {
				return this.generateImageOnce(input, credentials.apiKey, ['TEXT', 'IMAGE']);
			}
			throw err;
		}
	}

	private async generateImageOnce(
		input: AiImageGenerateInput,
		apiKey: string,
		responseModalities: string[],
	): Promise<AiImageGenerateResult> {
		const generationConfig: Record<string, unknown> = { responseModalities };
		if (input.aspectRatio) generationConfig.imageConfig = { aspectRatio: input.aspectRatio };
		const raw = await this.postGenerate(apiKey, input.model, {
			contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
			generationConfig,
		});
		const image = extractInlineImage(raw);
		if (!image?.data) {
			throw new AiException('AI_EMPTY_RESPONSE', 'Gemini returned no image data', HttpStatus.BAD_GATEWAY);
		}
		return {
			imageUrl: `data:${image.mime};base64,${image.data}`,
			mimeType: image.mime,
			model: input.model,
			imageCount: 1,
			...usageFrom(raw),
		};
	}

	private async postGenerate(apiKey: string, model: string, body: Record<string, unknown>) {
		const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': apiKey,
			},
			body: JSON.stringify(body),
		});
		const raw = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw geminiFail((raw as any)?.error?.message || `Gemini HTTP ${res.status}`, res.status, (raw as any)?.error?.status);
		}
		return raw;
	}
}
