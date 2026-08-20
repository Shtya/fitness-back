import { WhatsAppAiImageKind } from './whatsapp-ai-image.provider';

const STICKER_PREFIX =
	'WhatsApp sticker, die-cut, isolated subject only, transparent background, no photo backdrop, no watermark, no UI, bold clean outlines, square composition, high contrast, sticker-ready:';

const IMAGE_PREFIX = 'High quality chat image, no watermark, no text overlay unless requested:';

export function buildWhatsAppAiPrompt(
	kind: WhatsAppAiImageKind,
	prompt: string,
	hasReference = false,
): string {
	const subject = String(prompt || '').trim().slice(0, 900);
	if (!subject) return '';
	const referenceHint = hasReference
		? kind === 'sticker'
			? ' Recreate the referenced sticker/character in this new pose or scene, keep the same identity.'
			: ' Use the attached reference image as the visual base and follow the prompt.'
		: '';
	const prefix = kind === 'sticker' ? STICKER_PREFIX : IMAGE_PREFIX;
	return `${prefix} ${subject}.${referenceHint}`.trim();
}
