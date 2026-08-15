import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailMemoAiInput, EmailMemoAiProvider, EmailMemoAiResult } from './ai-provider';

@Injectable()
export class EmailMemoOpenAiProvider implements EmailMemoAiProvider {
	readonly id = 'openai';
	readonly label = 'OpenAI';

	constructor(private readonly config: ConfigService) {}

	isConfigured() {
		return Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim());
	}

	async generate(input: EmailMemoAiInput): Promise<EmailMemoAiResult> {
		const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
		if (!apiKey) {
			throw Object.assign(new Error('OpenAI API key is not configured'), {
				code: 'NOT_CONFIGURED',
			});
		}
		const model =
			input.model || this.config.get<string>('EMAIL_MEMO_OPENAI_MODEL')?.trim() || 'gpt-4o-mini';
		const base = (this.config.get<string>('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(
			/\/$/,
			'',
		);
		const res = await fetch(`${base}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
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
			throw Object.assign(new Error(raw?.error?.message || `OpenAI HTTP ${res.status}`), {
				status: res.status,
				raw,
			});
		}
		const text = String(raw?.choices?.[0]?.message?.content || '').trim();
		if (!text) throw new Error('OpenAI returned empty text');
		return { text, provider: this.id, model };
	}
}
