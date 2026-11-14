import { ForbiddenException } from '@nestjs/common';
import { WhatsAppSyncService } from './whatsapp-sync.service';

const LID = '182458867826901@lid';
const PHONE = '201551495772';

function service(opts: {
	contacts?: any[];
	conversation?: any;
	canSeeAll?: boolean;
	canView?: boolean;
	canUse?: boolean;
	resolved?: string | null;
	connected?: boolean;
}) {
	const contacts = opts.contacts || [];
	const update = jest.fn(async () => undefined);
	const resolveContactIdentity = jest.fn(async () => (opts.resolved ? { phoneNumber: opts.resolved } : null));
	const self: any = Object.create(WhatsAppSyncService.prototype);
	Object.assign(self, {
		access: {
			getAccountAccess: jest.fn(async () => ({ canView: opts.canView !== false, canUse: opts.canUse !== false })),
			canSeeAllConversations: jest.fn(() => opts.canSeeAll !== false),
		},
		contactRepo: {
			findOne: jest.fn(async ({ where }: any) => {
				const ids = where.waId?._value || [where.waId];
				return contacts.find((c) => ids.includes(c.waId)) || null;
			}),
			update,
		},
		conversationRepo: { findOne: jest.fn(async () => opts.conversation || null) },
		providers: {
			getProvider: jest.fn(() => ({
				getState: () => (opts.connected === false ? 'disconnected' : 'connected'),
				resolveContactIdentity,
			})),
		},
	});
	return { self, update, resolveContactIdentity };
}

const user: any = { id: 'u1' };

describe('person card for a group member', () => {
	it('turns an @lid sender into their real number through the live session and remembers it', async () => {
		const { self, update } = service({
			contacts: [{ waId: LID, name: 'Marehan', phoneNumber: '182458867826901' }],
			resolved: PHONE,
		});
		const card = await self.getPersonCard(user, 'acc', LID);
		expect(card).toMatchObject({ waId: LID, name: 'Marehan', phone: PHONE, conversationId: null, canMessage: true });
		expect(update).toHaveBeenCalledWith({ accountId: 'acc', waId: LID }, { phoneNumber: PHONE });
	});

	it('never shows the @lid digits as a phone number', async () => {
		const { self } = service({ contacts: [{ waId: LID, phoneNumber: '182458867826901' }], resolved: null });
		expect((await self.getPersonCard(user, 'acc', LID)).phone).toBeNull();
	});

	it('uses the number straight from a phone id, and links their 1:1 chat', async () => {
		const { self, resolveContactIdentity } = service({
			contacts: [{ waId: `${PHONE}@s.whatsapp.net`, name: 'Yousef', avatarUrl: '/a.jpg' }],
			conversation: { id: 'conv-9', assignedUserId: null },
		});
		const card = await self.getPersonCard(user, 'acc', `${PHONE}@s.whatsapp.net`);
		expect(card).toMatchObject({ phone: PHONE, name: 'Yousef', avatarUrl: '/a.jpg', conversationId: 'conv-9' });
		expect(resolveContactIdentity).not.toHaveBeenCalled();
	});

	it('hides a chat that staff limited to their own chats cannot open', async () => {
		const { self } = service({
			contacts: [],
			conversation: { id: 'conv-9', assignedUserId: 'someone-else' },
			canSeeAll: false,
		});
		expect((await self.getPersonCard(user, 'acc', `${PHONE}@s.whatsapp.net`)).conversationId).toBeNull();
	});

	it('refuses people without access to the account', async () => {
		const { self } = service({ canView: false });
		await expect(self.getPersonCard(user, 'acc', LID)).rejects.toBeInstanceOf(ForbiddenException);
	});
});
