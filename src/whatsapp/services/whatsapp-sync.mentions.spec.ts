import { WhatsAppSyncService } from './whatsapp-sync.service';

function createService(provider: Record<string, unknown> | null) {
	const accountRepo = { findOne: jest.fn().mockResolvedValue({ id: 'account-1', phoneNumber: '201011112222' }) };
	const contactRepo = { find: jest.fn().mockResolvedValue([]) };
	const participantRepo = {
		find: jest.fn().mockResolvedValue([
			// how members usually look: our own entry has no real name, Noor has one
			{ waId: '99887766554433@lid', displayName: '99887766554433' },
			{ waId: '201033334444@s.whatsapp.net', displayName: 'Noor Saleh' },
		]),
	};
	const providers = { getProvider: jest.fn().mockReturnValue(provider) };
	const service = new WhatsAppSyncService(
		accountRepo as any,
		contactRepo as any,
		{} as any, // conversationRepo
		{} as any, // noteRepo
		{} as any, // groupRepo
		participantRepo as any,
		{} as any, // messageRepo
		{} as any, // attachmentRepo
		{} as any, // reactionRepo
		{} as any, // access
		providers as any,
		{ emitAccountEvent: jest.fn() } as any,
		{} as any, // audit
		{} as any, // notifications
		{} as any, // statusService
		{} as any, // contactPresence
		{} as any, // preferenceRepo
	);
	return service;
}

const conversation = { accountId: 'account-1', groupId: 'group-1' } as any;
const mentionMessage = (jids: string[], text: string) =>
	({
		senderWaId: '201055556666@s.whatsapp.net',
		text,
		raw: { message: { extendedTextMessage: { text, contextInfo: { mentionedJid: jids } } } },
	}) as any;

describe('message mention labels', () => {
	it('names a mention of us with our own WhatsApp name, by LID or phone', async () => {
		const service = createService({
			getOwnPushName: () => 'Ahmed',
			getOwnJids: () => ['201011112222@s.whatsapp.net', '99887766554433@lid'],
		});
		const byLid = mentionMessage(['99887766554433@lid'], '@99887766554433 شوف دي');
		const byPhone = mentionMessage(['201011112222@s.whatsapp.net'], '@201011112222 hi');
		const other = mentionMessage(['201033334444@s.whatsapp.net'], '@201033334444 تمام');
		await (service as any).decorateMessageMentions(conversation, [byLid, byPhone, other]);
		expect(byLid.mentionLabels).toEqual({ '99887766554433': 'Ahmed' });
		expect(byPhone.mentionLabels).toEqual({ '201011112222': 'Ahmed' });
		expect(other.mentionLabels).toEqual({ '201033334444': 'Noor Saleh' });
	});

	it('falls back to our number (not the LID digits) when our name is unknown', async () => {
		const service = createService({
			getOwnPushName: () => null,
			getOwnJids: () => ['201011112222@s.whatsapp.net', '99887766554433@lid'],
		});
		const byLid = mentionMessage(['99887766554433@lid'], '@99887766554433 شوف دي');
		await (service as any).decorateMessageMentions(conversation, [byLid]);
		expect(byLid.mentionLabels).toEqual({ '99887766554433': '+201011112222' });
	});

	it('still works with no live session', async () => {
		const service = createService(null);
		const other = mentionMessage(['201033334444@s.whatsapp.net'], '@201033334444 تمام');
		await (service as any).decorateMessageMentions(conversation, [other]);
		expect(other.mentionLabels).toEqual({ '201033334444': 'Noor Saleh' });
	});
});
