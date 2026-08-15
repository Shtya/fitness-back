import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailMemoAiInput, EmailMemoAiProvider, EmailMemoAiResult } from './ai-provider';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.0-flash';
const FALLBACKS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash-lite'];

function uniqueModels(preferred?: string | null) {
	const list = [preferred, ...FALLBACKS].map((id) => String(id || '').trim()).filter(Boolean);
	return [...new Set(list)];
}

@Injectable()
export class EmailMemoGeminiProvider implements EmailMemoAiProvider {
	readonly id = 'gemini';
	readonly label = 'Gemini';

	constructor(private readonly config: ConfigService) {}

	isConfigured() {
		return Boolean(this.apiKey());
	}

	private apiKey() {
		return (
			this.config.get<string>('GEMINI_API_KEY')?.trim() ||
			this.config.get<string>('GOOGLE_AI_API_KEY')?.trim() ||
			''
		);
	}

	async generate(input: EmailMemoAiInput): Promise<EmailMemoAiResult> {
		const apiKey = this.apiKey();
		if (!apiKey) {
			throw Object.assign(new Error('Gemini API key is not configured'), {
				code: 'NOT_CONFIGURED',
			});
		}
		let lastError: any;
		for (const model of uniqueModels(input.model || DEFAULT_MODEL)) {
			try {
				return await this.generateOnce(apiKey, model, input);
			} catch (error: any) {
				lastError = error;
				const status = Number(error?.status || 0);
				const msg = String(error?.message || '').toLowerCase();
				const retryable =
					status === 404 ||
					status === 429 ||
					status >= 500 ||
					msg.includes('quota') ||
					msg.includes('not found') ||
					msg.includes('unavailable');
				if (!retryable) throw error;
			}
		}
		throw lastError;
	}

	private async generateOnce(
		apiKey: string,
		model: string,
		input: EmailMemoAiInput,
	): Promise<EmailMemoAiResult> {
		const url = `${GEMINI_API}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				systemInstruction: { parts: [{ text: input.system }] },
				contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
				generationConfig: {
					temperature: input.temperature ?? 0.2,
					maxOutputTokens: input.maxTokens ?? 700,
				},
			}),
		});
		const raw: any = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw Object.assign(
				new Error(raw?.error?.message || `Gemini HTTP ${res.status}`),
				{ status: res.status, code: raw?.error?.status || 'GEMINI_ERROR', raw },
			);
		}
		const text = String(
			raw?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).filter(Boolean).join('\n') ||
				'',
		).trim();
		if (!text) {
			throw Object.assign(new Error('Gemini returned empty text'), {
				status: 502,
				code: 'EMPTY_RESPONSE',
			});
		}
		return { text, provider: this.id, model };
	}
}
