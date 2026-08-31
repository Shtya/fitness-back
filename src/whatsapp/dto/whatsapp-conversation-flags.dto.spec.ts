import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import {
	DeleteWhatsAppPendingUploadDto,
	OpenWhatsAppConversationDto,
	SendWhatsAppPresenceDto,
	SetWhatsAppConversationArchivedDto,
	SetWhatsAppConversationFavoriteDto,
	SetWhatsAppConversationMutedDto,
	SetWhatsAppConversationPinnedDto,
	ViewWhatsAppStatusDto,
} from './whatsapp.dto';

/**
 * These endpoints used to declare inline object types, so Nest skipped validation
 * for them entirely. Switching to DTO classes activates the *global* pipe, which
 * runs with `forbidNonWhitelisted`. That means an unexpected field is now a 400,
 * so these tests pin the exact bodies the dashboard sends today.
 */
const pipe = new ValidationPipe({
	disableErrorMessages: false,
	transform: true,
	forbidNonWhitelisted: true,
	whitelist: true,
});

const meta = (metatype: any): ArgumentMetadata => ({ type: 'body', metatype });

const accept = (metatype: any, value: unknown) => pipe.transform(value, meta(metatype));
const reject = (metatype: any, value: unknown) =>
	expect(pipe.transform(value, meta(metatype))).rejects.toThrow(BadRequestException);

describe('WhatsApp conversation flag DTOs under the global ValidationPipe', () => {
	describe('payloads the dashboard actually sends', () => {
		it('accepts openConversation with chatId + title', async () => {
			await expect(
				accept(OpenWhatsAppConversationDto, { chatId: '201000000000@c.us', title: 'Ahmed' }),
			).resolves.toEqual({ chatId: '201000000000@c.us', title: 'Ahmed' });
		});

		it('accepts openConversation without a title', async () => {
			await expect(
				accept(OpenWhatsAppConversationDto, { chatId: '201000000000@c.us' }),
			).resolves.toEqual({ chatId: '201000000000@c.us' });
		});

		it('accepts favorite / pin / archive booleans', async () => {
			await expect(
				accept(SetWhatsAppConversationFavoriteDto, { isFavorite: true }),
			).resolves.toEqual({ isFavorite: true });
			await expect(
				accept(SetWhatsAppConversationPinnedDto, { isPinned: false }),
			).resolves.toEqual({ isPinned: false });
			await expect(
				accept(SetWhatsAppConversationArchivedDto, { isArchived: true }),
			).resolves.toEqual({ isArchived: true });
		});

		it('accepts mute with a duration and with an explicit expiry', async () => {
			await expect(
				accept(SetWhatsAppConversationMutedDto, { isMuted: true, durationMinutes: 480 }),
			).resolves.toEqual({ isMuted: true, durationMinutes: 480 });
			await expect(
				accept(SetWhatsAppConversationMutedDto, {
					isMuted: true,
					mutedUntil: '2026-09-01T10:00:00.000Z',
				}),
			).resolves.toEqual({ isMuted: true, mutedUntil: '2026-09-01T10:00:00.000Z' });
		});

		it('accepts unmute', async () => {
			await expect(
				accept(SetWhatsAppConversationMutedDto, { isMuted: false }),
			).resolves.toEqual({ isMuted: false });
		});

		it('accepts a null mutedUntil as "no expiry"', async () => {
			await expect(
				accept(SetWhatsAppConversationMutedDto, { isMuted: true, mutedUntil: null }),
			).resolves.toEqual({ isMuted: true, mutedUntil: null });
		});

		it('accepts the presence states the composer emits', async () => {
			for (const state of ['composing', 'paused', 'recording', 'available']) {
				await expect(accept(SendWhatsAppPresenceDto, { state })).resolves.toEqual({ state });
			}
		});

		it('accepts pending-upload deletion and status view', async () => {
			await expect(
				accept(DeleteWhatsAppPendingUploadDto, { fileId: 'outgoing/acc/user/x.jpg' }),
			).resolves.toEqual({ fileId: 'outgoing/acc/user/x.jpg' });
			await expect(
				accept(ViewWhatsAppStatusDto, { senderWaId: '201000000000@c.us' }),
			).resolves.toEqual({ senderWaId: '201000000000@c.us' });
			await expect(accept(ViewWhatsAppStatusDto, {})).resolves.toEqual({});
		});
	});

	describe('input that should now be refused', () => {
		it('refuses a missing chatId', async () => {
			await reject(OpenWhatsAppConversationDto, {});
		});

		it('refuses a missing fileId', async () => {
			await reject(DeleteWhatsAppPendingUploadDto, {});
		});

		it('refuses non-boolean flags', async () => {
			await reject(SetWhatsAppConversationFavoriteDto, { isFavorite: 'yes' });
		});

		it('refuses an object where a string is expected', async () => {
			await reject(OpenWhatsAppConversationDto, { chatId: { $ne: null } });
		});

		it('refuses an unknown presence state', async () => {
			await reject(SendWhatsAppPresenceDto, { state: 'typing' });
		});

		it('refuses a non-positive mute duration', async () => {
			await reject(SetWhatsAppConversationMutedDto, { isMuted: true, durationMinutes: 0 });
		});

		it('refuses unexpected fields', async () => {
			await reject(SetWhatsAppConversationFavoriteDto, { isFavorite: true, isAdmin: true });
		});
	});
});
