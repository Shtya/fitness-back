import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
	WhatsAppAiImageProvider,
	WhatsAppAiImageRequest,
	WhatsAppAiImageResult,
	WhatsAppAiModelOption,
} from './whatsapp-ai-image.provider';
import { buildWhatsAppAiPrompt } from './whatsapp-ai-prompt';

const POLLINATIONS_MODELS: WhatsAppAiModelOption[] = [
	{
		id: 'pollinations:sana',
		provider: 'pollinations',
		model: 'sana',
		label: 'Sana / DreamShaper',
		free: true,
		available: true,
		supportsReference: false,
		hint: 'Fast free default',
	},
	{
		id: 'pollinations:zimage',
		provider: 'pollinations',
		model: 'zimage',
		label: 'Z-Image Turbo',
		free: true,
		available: true,
		supportsReference: false,
		hint: 'Sharper free images',
	},
	{
		id: 'pollinations:flux',
		provider: 'pollinations',
		model: 'flux',
		label: 'FLUX Schnell',
		free: true,
		available: true,
		supportsReference: false,
		hint: 'May fall back to Sana on the free endpoint',
	},
	{
		id: 'pollinations:kontext',
		provider: 'pollinations',
		model: 'kontext',
		label: 'FLUX Kontext',
		free: true,
		available: true,
		supportsReference: true,
		hint: 'Best with a reference image',
	},
];

const MODEL_ALIASES: Record<string, string> = {
	turbo: 'sana',
	dreamshaper: 'sana',
	'sana': 'sana',
	'z-image': 'zimage',
	'z-image-turbo': 'zimage',
};

@Injectable()
export class PollinationsWhatsAppImageProvider implements WhatsAppAiImageProvider {
	readonly id = 'pollinations';
	private readonly logger = new Logger(PollinationsWhatsAppImageProvider.name);

	listModels(): WhatsAppAiModelOption[] {
		return POLLINATIONS_MODELS;
	}

	async generate(request: WhatsAppAiImageRequest): Promise<WhatsAppAiImageResult> {
		const prompt = buildWhatsAppAiPrompt(
			request.kind,
			request.prompt,
			Boolean(request.reference?.buffer?.length),
		);
		if (!prompt) {
			throw new ServiceUnavailableException('Image prompt is empty');
		}
		const seed = this.clampSeed(request.seed);
		const size = request.kind === 'sticker' ? 512 : 1024;
		const selected = this.normalizeModel(request.model);
		const models = this.modelAttempts(selected, Boolean(request.reference?.buffer?.length));
		let lastError: unknown;
		for (const model of models) {
			try {
				if (request.reference?.buffer?.length && this.supportsReference(model)) {
					return await this.generateWithReference(prompt, model, seed, size, request);
				}
				return await this.generateText(prompt, model, seed, size, request.signal);
			} catch (error) {
				if (request.signal?.aborted) {
					throw new ServiceUnavailableException('Image generation was cancelled or timed out');
				}
				lastError = error;
				this.logger.warn(
					`Pollinations ${model} failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		throw lastError instanceof Error
			? lastError
			: new ServiceUnavailableException('Pollinations image generation failed');
	}

	private clampSeed(value?: number) {
		const max = 2_147_483_647;
		const n = Number(value);
		if (!Number.isFinite(n)) return Math.floor(Math.random() * 1_000_000);
		const floored = Math.floor(Math.abs(n));
		return floored > max ? floored % (max + 1) : floored;
	}

	private normalizeModel(value?: string) {
		const raw = String(value || '')
			.trim()
			.toLowerCase()
			.replace(/^pollinations:/, '');
		if (!raw) return 'sana';
		return MODEL_ALIASES[raw] || raw;
	}

	private supportsReference(model: string) {
		return POLLINATIONS_MODELS.some((item) => item.model === model && item.supportsReference);
	}

	private modelAttempts(selected: string, hasReference: boolean) {
		const known = POLLINATIONS_MODELS.map((item) => item.model);
		const primary = known.includes(selected) ? selected : 'sana';
		const extra: string[] = [];
		if (hasReference && primary !== 'kontext') extra.push('kontext');
		if (primary !== 'sana') extra.push('sana');
		return [primary, ...extra].filter((item, index, list) => list.indexOf(item) === index);
	}

	private imageBase() {
		return (
			process.env.AI_FREE_POLLINATIONS_IMAGE_BASE_URL || 'https://image.pollinations.ai/prompt'
		).replace(/\/$/, '');
	}

	private async generateText(
		prompt: string,
		model: string,
		seed: number,
		size: number,
		signal?: AbortSignal,
	): Promise<WhatsAppAiImageResult> {
		const qs = new URLSearchParams({
			model,
			width: String(size),
			height: String(size),
			seed: String(seed),
		});
		const url = `${this.imageBase()}/${encodeURIComponent(prompt)}?${qs.toString()}`;
		return this.fetchImage(url, model, seed, signal);
	}

	private pollinationsKey() {
		return String(process.env.POLLINATIONS_API_KEY || process.env.POLLINATIONS_KEY || '').trim();
	}

	private commonHeaders(json = false): Record<string, string> {
		const headers: Record<string, string> = {
			Accept: json ? 'application/json,image/*' : 'image/*',
			Referer: 'https://pollinations.ai/',
		};
		const key = this.pollinationsKey();
		if (key) headers.Authorization = `Bearer ${key}`;
		return headers;
	}

	private async generateWithReference(
		prompt: string,
		model: string,
		seed: number,
		size: number,
		request: WhatsAppAiImageRequest,
	): Promise<WhatsAppAiImageResult> {
		if (this.pollinationsKey()) {
			try {
				return await this.generateEditMultipart(prompt, seed, size, request);
			} catch (error: any) {
				if (request.signal?.aborted || error?.name === 'AbortError') {
					throw new ServiceUnavailableException('Image generation was cancelled or timed out');
				}
				this.logger.warn(
					`Pollinations edit multipart failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		try {
			return await this.generateEditJson(prompt, model, seed, size, request);
		} catch (error: any) {
			if (request.signal?.aborted || error?.name === 'AbortError') {
				throw new ServiceUnavailableException('Image generation was cancelled or timed out');
			}
			this.logger.warn(
				`Pollinations edit JSON failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		return this.generateText(prompt, model, seed, size, request.signal);
	}

	private async generateEditMultipart(
		prompt: string,
		seed: number,
		size: number,
		request: WhatsAppAiImageRequest,
	): Promise<WhatsAppAiImageResult> {
		const mime = request.reference?.mimeType || 'image/png';
		const form = new FormData();
		form.append('prompt', prompt);
		form.append('model', 'kontext');
		form.append('seed', String(seed));
		form.append('size', `${size}x${size}`);
		form.append(
			'image',
			new Blob([new Uint8Array(request.reference!.buffer)], { type: mime }),
			'reference.png',
		);
		return this.fetchGenerated(
			'https://gen.pollinations.ai/v1/images/edits',
			{
				method: 'POST',
				headers: this.commonHeaders(true),
				body: form,
			},
			'kontext',
			seed,
			request.signal,
		);
	}

	private async generateEditJson(
		prompt: string,
		model: string,
		seed: number,
		size: number,
		request: WhatsAppAiImageRequest,
	): Promise<WhatsAppAiImageResult> {
		const mime = request.reference?.mimeType || 'image/png';
		const editModel = model === 'flux' || model === 'sana' || model === 'zimage' ? 'kontext' : model;
		return this.fetchGenerated(
			this.imageBase(),
			{
				method: 'POST',
				headers: { ...this.commonHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					prompt,
					model: editModel,
					width: size,
					height: size,
					seed,
					image: `data:${mime};base64,${request.reference!.buffer.toString('base64')}`,
				}),
			},
			editModel,
			seed,
			request.signal,
		);
	}

	private async fetchImage(
		url: string,
		model: string,
		seed: number,
		signal?: AbortSignal,
	): Promise<WhatsAppAiImageResult> {
		return this.fetchGenerated(
			url,
			{
				method: 'GET',
				headers: this.commonHeaders(),
			},
			model,
			seed,
			signal,
		);
	}

	private async fetchGenerated(
		url: string,
		init: RequestInit,
		model: string,
		seed: number,
		signal?: AbortSignal,
	): Promise<WhatsAppAiImageResult> {
		const timeoutMs = Math.min(
			Math.max(Number(process.env.AI_FREE_HTTP_TIMEOUT_MS) || 120000, 10000),
			180000,
		);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const onAbort = () => controller.abort();
		signal?.addEventListener('abort', onAbort, { once: true });
		try {
			const response = await fetch(url, { ...init, signal: controller.signal });
			if (!response.ok) {
				const body = await response.text().catch(() => '');
				throw new ServiceUnavailableException(
					`Pollinations image failed (${response.status}): ${body.slice(0, 160)}`,
				);
			}
			const contentType = (response.headers.get('content-type') || '').split(';')[0];
			if (contentType.includes('application/json')) {
				const json = (await response.json()) as {
					data?: Array<{ b64_json?: string; url?: string }>;
					imageUrl?: string;
				};
				const b64 = json?.data?.[0]?.b64_json;
				if (b64) {
					return {
						buffer: Buffer.from(b64, 'base64'),
						mimeType: 'image/png',
						provider: this.id,
						model,
						seed,
					};
				}
				const nextUrl = json?.data?.[0]?.url || json?.imageUrl;
				if (nextUrl) {
					return this.fetchImage(nextUrl, model, seed, signal);
				}
				throw new ServiceUnavailableException('Pollinations returned no image data');
			}
			if (!contentType.startsWith('image/')) {
				throw new ServiceUnavailableException('Pollinations returned a non-image response');
			}
			const buffer = Buffer.from(await response.arrayBuffer());
			if (!buffer.length) {
				throw new ServiceUnavailableException('Pollinations returned an empty image');
			}
			return { buffer, mimeType: contentType, provider: this.id, model, seed };
		} catch (error: any) {
			if (error?.name === 'AbortError' || signal?.aborted) {
				throw new ServiceUnavailableException('Image generation was cancelled or timed out');
			}
			throw error;
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
		}
	}
}
