import { BaileysProvider } from './baileys.provider';
import { isWithinWhatsAppEditWindow } from '../utils/whatsapp-message-edits';

function makeProvider() {
	const provider: any = Object.create(BaileysProvider.prototype);
	provider.state = 'connected';
	provider.socket = { sendMessage: jest.fn(async () => ({ key: { id: 'edit-echo' } })) };
	provider.rawByMessageId = new Map();
	provider.messagesByChat = new Map();
	return provider;
}

describe('BaileysProvider.editText', () => {
	it('edits with the original key, sent to the same (LID) address', async () => {
		const provider = makeProvider();
		await provider.editText('3A96EE46B8EE039EBF13', 'مالك يا باشا', {
			key: { remoteJid: '50199711973624@lid', id: '3A96EE46B8EE039EBF13', fromMe: true } as any,
			chatId: '201018758163@c.us',
		});
		expect(provider.socket.sendMessage).toHaveBeenCalledWith('50199711973624@lid', {
			text: 'مالك يا باشا',
			edit: { remoteJid: '50199711973624@lid', id: '3A96EE46B8EE039EBF13', fromMe: true },
		});
	});

	it('keeps the participant for group messages', async () => {
		const provider = makeProvider();
		await provider.editText('ID1', 'fixed', {
			key: { remoteJid: '120363000000000000@g.us', participant: '201000000000@s.whatsapp.net' },
		});
		expect(provider.socket.sendMessage.mock.calls[0][1].edit).toEqual({
			remoteJid: '120363000000000000@g.us',
			id: 'ID1',
			fromMe: true,
			participant: '201000000000@s.whatsapp.net',
		});
	});

	it('falls back to the session raw, then to the chat id', async () => {
		const provider = makeProvider();
		provider.rawByMessageId.set('ID2', { key: { remoteJid: '111@lid', id: 'ID2' } });
		await provider.editText('ID2', 'a');
		expect(provider.socket.sendMessage.mock.calls[0][0]).toBe('111@lid');

		await provider.editText('ID3', 'b', { chatId: '201000000000@c.us' });
		expect(provider.socket.sendMessage.mock.calls[1][1].edit.remoteJid).toMatch(/^201000000000@/);
	});

	it('refuses when the original message cannot be found', async () => {
		const provider = makeProvider();
		await expect(provider.editText('missing', 'x')).rejects.toThrow('Original message not found');
	});
});

describe('isWithinWhatsAppEditWindow', () => {
	const now = Date.parse('2026-10-25T06:11:00Z');
	it('allows 15 minutes after sending and no longer', () => {
		expect(isWithinWhatsAppEditWindow('2026-10-25T06:00:00Z', now)).toBe(true);
		expect(isWithinWhatsAppEditWindow('2026-10-25T05:56:00Z', now)).toBe(true);
		expect(isWithinWhatsAppEditWindow('2026-10-25T05:11:00Z', now)).toBe(false);
		expect(isWithinWhatsAppEditWindow(null, now)).toBe(false);
	});
});
