import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import type { ExternalModelKind } from './ai-agent.entities';

/** Built-in AI Free stack already registered in this workspace. */
export const BUILT_IN_AGENT_PROVIDERS = [
	{
		name: 'ai-free',
		label: 'AI Free (auto chain)',
		description: 'Tries LLM7, then Pollinations, then Browser ChatGPT.',
		models: [{ id: 'auto', label: 'Auto' }],
	},
	{
		name: 'llm7-free',
		label: 'LLM7 Free',
		description: 'OpenAI-compatible free models from LLM7.',
		models: [
			{ id: 'auto', label: 'Auto (gpt-oss:20b)' },
			{ id: 'gpt-oss:20b', label: 'gpt-oss:20b' },
			{ id: 'llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B' },
			{ id: 'mistral-small-3.1-24b-instruct-2503', label: 'Mistral Small 3.1' },
			{ id: 'qwen2.5-72b-instruct', label: 'Qwen 2.5 72B' },
		],
	},
	{
		name: 'pollinations-free',
		label: 'Pollinations Free',
		description: 'Public text models from Pollinations.',
		models: [
			{ id: 'auto', label: 'Auto' },
			{ id: 'openai', label: 'openai' },
			{ id: 'openai-fast', label: 'openai-fast' },
			{ id: 'searchgpt', label: 'searchgpt' },
		],
	},
	{
		name: 'browser-chatgpt',
		label: 'Browser ChatGPT',
		description: 'Uses the browser ChatGPT session on this server.',
		models: [{ id: 'auto', label: 'Auto' }],
	},
	{
		name: 'dragify-free',
		label: 'Dragify Free',
		description: 'Compatibility adapter for the Dragify free stack.',
		models: [{ id: 'auto', label: 'Auto' }],
	},
] as const;

/** Leaf providers tried after the selected one fails (rate-limit, reject, timeout). */
const FALLBACK_LEAVES = ['pollinations-free', 'browser-chatgpt', 'llm7-free', 'dragify-free'] as const;

/**
 * Try the selected provider first, then up to two backups so a 429/reject
 * still produces a reply. `ai-free` already chains internally, so it only
 * needs Dragify as a last resort.
 */
export function providerFallbackChain(selected: string): string[] {
	const name = String(selected || 'ai-free').trim() || 'ai-free';
	if (name === 'external') return ['external', 'ai-free', 'dragify-free'];
	if (name === 'ai-free') return ['ai-free', 'dragify-free'];
	const rest = FALLBACK_LEAVES.filter(item => item !== name);
	return [name, ...rest].slice(0, 3);
}

export const EXTERNAL_MODEL_PRESETS: Record<
	string,
	{ label: string; kind: ExternalModelKind; baseUrl: string }
> = {
	openai: { label: 'OpenAI', kind: 'openai_compatible', baseUrl: 'https://api.openai.com/v1' },
	openrouter: { label: 'OpenRouter', kind: 'openai_compatible', baseUrl: 'https://openrouter.ai/api/v1' },
	groq: { label: 'Groq', kind: 'openai_compatible', baseUrl: 'https://api.groq.com/openai/v1' },
	together: { label: 'Together AI', kind: 'openai_compatible', baseUrl: 'https://api.together.xyz/v1' },
	ollama: { label: 'Ollama (local)', kind: 'openai_compatible', baseUrl: 'http://127.0.0.1:11434/v1' },
	custom: { label: 'Custom OpenAI-compatible', kind: 'openai_compatible', baseUrl: '' },
};

export function encryptAgentSecret(value: string, secret: string) {
	const key = createHash('sha256').update(`so7bafit:wa-agent-models:${secret}`).digest();
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptAgentSecret(encoded: string, secret: string) {
	const key = createHash('sha256').update(`so7bafit:wa-agent-models:${secret}`).digest();
	const payload = Buffer.from(encoded, 'base64');
	const iv = payload.subarray(0, 12);
	const tag = payload.subarray(12, 28);
	const ciphertext = payload.subarray(28);
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function last4(value: string | null | undefined) {
	const trimmed = String(value || '').trim();
	if (!trimmed) return null;
	return trimmed.slice(-4);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function normalizeExternalBaseUrl(raw: string) {
	const value = String(raw || '').trim().replace(/\/+$/, '');
	if (!value) throw new BadRequestException('Base URL is required');
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new BadRequestException('Base URL is not valid');
	}
	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw new BadRequestException('Base URL must be http or https');
	}
	const host = parsed.hostname.toLowerCase();
	if (parsed.protocol === 'http:' && !LOCAL_HOSTS.has(host)) {
		throw new BadRequestException('Non-local endpoints must use https');
	}
	if (host === '169.254.169.254' || host.endsWith('.internal')) {
		throw new BadRequestException('This host is not allowed');
	}
	return parsed.toString().replace(/\/+$/, '');
}

export type AiTokenUsage = {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	/** USD estimate (provider cost when available, otherwise local rate card). */
	estimatedCostUsd: number;
	costSource: 'provider' | 'estimate' | 'free';
};

/** USD per 1M tokens — used when the provider does not return a billed cost. */
const RATE_CARD: Array<{ match: RegExp; input: number; output: number }> = [
	{ match: /gpt-4o-mini/i, input: 0.15, output: 0.6 },
	{ match: /gpt-4o/i, input: 2.5, output: 10 },
	{ match: /gpt-4\.1-mini/i, input: 0.4, output: 1.6 },
	{ match: /gpt-4\.1/i, input: 2, output: 8 },
	{ match: /o3-mini/i, input: 1.1, output: 4.4 },
	{ match: /o1-mini/i, input: 1.1, output: 4.4 },
	{ match: /claude-3-5-haiku|claude-haiku/i, input: 0.8, output: 4 },
	{ match: /claude-3-5-sonnet|claude-sonnet/i, input: 3, output: 15 },
	{ match: /llama-3\.3|llama3\.3/i, input: 0.59, output: 0.79 },
	{ match: /llama/i, input: 0.2, output: 0.2 },
	{ match: /mixtral|mistral/i, input: 0.24, output: 0.24 },
	{ match: /qwen/i, input: 0.2, output: 0.2 },
	{ match: /gemini.*flash/i, input: 0.1, output: 0.4 },
	{ match: /gemini/i, input: 0.5, output: 1.5 },
];

const DEFAULT_RATE = { input: 0.15, output: 0.6 };

export function estimateTokenCostUsd(
	model: string | null | undefined,
	promptTokens: number,
	completionTokens: number,
): number {
	const rates = RATE_CARD.find(row => row.match.test(String(model || ''))) || DEFAULT_RATE;
	const usd =
		(Math.max(0, promptTokens) / 1_000_000) * rates.input +
		(Math.max(0, completionTokens) / 1_000_000) * rates.output;
	return Math.round(usd * 1_000_000) / 1_000_000;
}

export function usageFromOpenAiResponse(
	parsed: any,
	model: string | null,
): AiTokenUsage {
	const usage = parsed?.usage || {};
	const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
	const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
	const totalTokens =
		Number(usage.total_tokens ?? 0) || promptTokens + completionTokens;
	const providerCost = Number(
		usage.total_cost ?? usage.cost ?? parsed?.usage?.cost ?? NaN,
	);
	if (Number.isFinite(providerCost) && providerCost >= 0) {
		return {
			promptTokens,
			completionTokens,
			totalTokens,
			estimatedCostUsd: Math.round(providerCost * 1_000_000) / 1_000_000,
			costSource: 'provider',
		};
	}
	return {
		promptTokens,
		completionTokens,
		totalTokens,
		estimatedCostUsd: estimateTokenCostUsd(model, promptTokens, completionTokens),
		costSource: promptTokens || completionTokens ? 'estimate' : 'free',
	};
}

export function freeUsage(): AiTokenUsage {
	return {
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		estimatedCostUsd: 0,
		costSource: 'free',
	};
}

export async function generateOpenAiCompatible(options: {
	baseUrl: string;
	model: string;
	apiKey: string | null;
	prompt: string;
	timeoutMs: number;
}): Promise<{ text: string; actualModel: string | null; usage: AiTokenUsage }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs);
	try {
		const response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
			},
			body: JSON.stringify({
				model: options.model,
				messages: [{ role: 'user', content: options.prompt }],
				temperature: 0.2,
				max_tokens: 1024,
			}),
			signal: controller.signal,
		});
		const raw = await response.text();
		if (!response.ok) {
			throw new Error(`External model failed (${response.status}): ${raw.slice(0, 180)}`);
		}
		const parsed = JSON.parse(raw);
		const text = String(parsed?.choices?.[0]?.message?.content || '').trim();
		if (!text) throw new Error('External model returned an empty reply');
		const actualModel = String(parsed?.model || options.model);
		return {
			text,
			actualModel,
			usage: usageFromOpenAiResponse(parsed, actualModel),
		};
	} finally {
		clearTimeout(timer);
	}
}
