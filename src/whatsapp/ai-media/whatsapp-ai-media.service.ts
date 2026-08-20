import {
	BadRequestException,
	Inject,
	Injectable,
	Optional,
	ServiceUnavailableException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { User } from '../../../entities/global.entity';
import { AiService } from '../../ai/ai.service';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppStickersService } from '../services/whatsapp-stickers.service';
import {
	WHATSAPP_AI_IMAGE_PROVIDERS,
	WhatsAppAiImageKind,
	WhatsAppAiImageProvider,
} from './whatsapp-ai-image.provider';

const IMAGE_TYPES = new Set([
	'image/webp',
	'image/png',
	'image/jpeg',
	'image/jpg',
	'image/gif',
]);
const MAX_REFERENCE_BYTES = 15 * 1024 * 1024;

@Injectable()
export class WhatsAppAiMediaService {
	constructor(
		@Inject(WHATSAPP_AI_IMAGE_PROVIDERS)
		private readonly providers: WhatsAppAiImageProvider[],
		private readonly access: WhatsAppAccessService,
		private readonly stickers: WhatsAppStickersService,
		@Optional() private readonly ai?: AiService,
	) {}

	activeProviderId() {
		return String(process.env.WHATSAPP_AI_IMAGE_PROVIDER || 'pollinations')
			.trim()
			.toLowerCase();
	}

	listModels(user: User, accountId: string) {
		return this.access.assertAccountPermission(user, accountId, 'canUse').then(() => ({
			provider: this.activeProviderId(),
			models: this.providers.flatMap((item) => item.listModels()),
		}));
	}

	private resolveProvider(providerId?: string) {
		const wanted = String(providerId || this.activeProviderId())
			.trim()
			.toLowerCase();
		const match =
			this.providers.find((item) => item.id === wanted) ||
			this.providers.find((item) => item.id === 'pollinations');
		if (!match) {
			throw new ServiceUnavailableException('No WhatsApp AI image provider is registered');
		}
		return match;
	}

	private mapImageProvider(provider?: string) {
		const id = String(provider || '').trim().toLowerCase();
		if (id === 'pollinations-image' || id === 'pollinations-free') return 'pollinations';
		return id || this.activeProviderId();
	}

	private parseSelection(input?: { provider?: string; model?: string }) {
		const raw = String(input?.model || '').trim();
		if (raw.includes(':')) {
			const [provider, ...rest] = raw.split(':');
			return { provider: provider.toLowerCase(), model: rest.join(':') };
		}
		return {
			provider: String(input?.provider || this.activeProviderId()).trim().toLowerCase(),
			model: raw,
		};
	}

	async generate(
		user: User,
		accountId: string,
		input: {
			kind?: string;
			prompt?: string;
			provider?: string;
			model?: string;
			stickerId?: string;
			file?: { path?: string; mimetype?: string; size?: number; buffer?: Buffer };
			seed?: number;
			signal?: AbortSignal;
		},
	) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const kind = this.normalizeKind(input.kind);
		const prompt = String(input.prompt || '').trim();
		if (prompt.length < 2) {
			throw new BadRequestException('Prompt is required');
		}
		if (prompt.length > 1200) {
			throw new BadRequestException('Prompt is too long');
		}
		let selection = this.parseSelection(input);
		if (!String(input?.model || '').trim() && this.ai) {
			try {
				const choice = await this.ai.resolveFeatureChoice(user as any, 'whatsapp.image');
				selection = this.parseSelection({
					provider: this.mapImageProvider(choice.provider),
					model: choice.modelKey,
				});
			} catch {
				// Keep the WhatsApp image provider default if workspace assignment is missing.
			}
		}
		const reference = await this.resolveReference(user, accountId, input);
		const provider = this.resolveProvider(selection.provider);
		const result = await provider.generate({
			kind,
			prompt,
			model: selection.model || undefined,
			reference,
			seed: Number.isFinite(Number(input.seed))
				? Number(input.seed)
				: undefined,
			signal: input.signal,
		});
		if (!result?.buffer?.length) {
			throw new ServiceUnavailableException('AI provider returned an empty image');
		}
		const mimeType = String(result.mimeType || 'image/png').split(';')[0];
		const extension = mimeType.includes('webp')
			? 'webp'
			: mimeType.includes('png')
				? 'png'
				: mimeType.includes('gif')
					? 'gif'
					: 'jpg';
		return {
			kind,
			provider: result.provider,
			model: result.model,
			seed: result.seed,
			mimeType,
			fileName: kind === 'sticker' ? `ai-sticker.${extension}` : `ai-image.${extension}`,
			base64: result.buffer.toString('base64'),
		};
	}

	private normalizeKind(value?: string): WhatsAppAiImageKind {
		const kind = String(value || 'image').trim().toLowerCase();
		if (kind === 'sticker' || kind === 'image') return kind;
		throw new BadRequestException('kind must be sticker or image');
	}

	private async resolveReference(
		user: User,
		accountId: string,
		input: {
			stickerId?: string;
			file?: { path?: string; mimetype?: string; size?: number; buffer?: Buffer };
		},
	) {
		if (input.stickerId) {
			const file = await this.stickers.stream(user, accountId, input.stickerId);
			const buffer = await fs.readFile(file.absolutePath);
			return { buffer, mimeType: file.mimeType || 'image/webp' };
		}
		if (!input.file) return null;
		const mime = String(input.file.mimetype || '').toLowerCase();
		if (mime && !IMAGE_TYPES.has(mime) && !mime.startsWith('image/')) {
			throw new BadRequestException('Reference must be an image');
		}
		if (Number(input.file.size || 0) > MAX_REFERENCE_BYTES) {
			throw new BadRequestException('Reference image is too large');
		}
		let buffer = input.file.buffer;
		if (!buffer?.length && input.file.path) {
			buffer = await fs.readFile(input.file.path);
		}
		if (!buffer?.length) return null;
		return { buffer, mimeType: mime || 'image/png' };
	}
}
