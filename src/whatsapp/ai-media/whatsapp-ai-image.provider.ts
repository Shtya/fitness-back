export type WhatsAppAiImageKind = 'sticker' | 'image';

export type WhatsAppAiModelOption = {
	id: string;
	provider: string;
	model: string;
	label: string;
	free: boolean;
	available: boolean;
	supportsReference: boolean;
	hint?: string;
};

export type WhatsAppAiImageRequest = {
	kind: WhatsAppAiImageKind;
	prompt: string;
	model?: string;
	reference?: { buffer: Buffer; mimeType: string } | null;
	seed?: number;
	signal?: AbortSignal;
};

export type WhatsAppAiImageResult = {
	buffer: Buffer;
	mimeType: string;
	provider: string;
	model: string;
	seed?: number;
};

export interface WhatsAppAiImageProvider {
	readonly id: string;
	generate(request: WhatsAppAiImageRequest): Promise<WhatsAppAiImageResult>;
	listModels(): WhatsAppAiModelOption[];
}

export const WHATSAPP_AI_IMAGE_PROVIDERS = 'WHATSAPP_AI_IMAGE_PROVIDERS';
