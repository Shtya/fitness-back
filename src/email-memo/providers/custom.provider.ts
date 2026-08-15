import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailMemoAiInput, EmailMemoAiProvider, EmailMemoAiResult } from './ai-provider';

@Injectable()
export class EmailMemoCustomProvider implements EmailMemoAiProvider {
	readonly id = 'custom';
	readonly label = 'Custom';

	constructor(private readonly config: ConfigService) {}

	isConfigured() {
		return Boolean(
			this.config.get<string>('EMAIL_MEMO_CUSTOM_AI_URL')?.trim() ||
				this.config.get<string>('OPENAI_BASE_URL')?.trim(),
		);
	}

	async generate(input: EmailMemoAiInput): Promise<EmailMemoAiResult> {
		const url = (
			this.config.get<string>('EMAIL_MEMO_CUSTOM_AI_URL') ||
			this.config.get<string>('OPENAI_BASE_URL') ||
			''
		)
			.replace(/\/$/, '')
			.concat('/chat/completions');
		const apiKey =
			this.config.get<string>('EMAIL_MEMO_CUSTOM_AI_KEY')?.trim() ||
			this.config.get<string>('OPENAI_API_KEY')?.trim() ||
			'';
		if (!this.config.get<string>('EMAIL_MEMO_CUSTOM_AI_URL')?.trim() && !this.config.get<string>('OPENAI_BASE_URL')?.trim()) {
			throw Object.assign(new Error('Custom AI endpoint is not configured'), {
				code: 'NOT_CONFIGURED',
			});
		}
		const model = input.model || this.config.get<string>('EMAIL_MEMO_CUSTOM_AI_MODEL') || 'default';
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model,
				temperature: input.temperature ?? 0.2,
				max_tokens: input.maxTokens ?? 700,
				messages: [
					{ role: 'system', content: input.system },
					{ role: 'user', content: input.prompt },
				],
			}),
		});
		const raw: any = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw Object.assign(new Error(raw?.error?.message || `Custom AI HTTP ${res.status}`), {
				status: res.status,
				raw,
			});
		}
		const text = String(raw?.choices?.[0]?.message?.content || raw?.text || '').trim();
		if (!text) throw new Error('Custom AI returned empty text');
		return { text, provider: this.id, model };
	}
}
