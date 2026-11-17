import { BaileysProvider } from './baileys.provider';

const POSTER_LID = '128050339573779@lid';
const POSTER_PN = '201011112222@s.whatsapp.net';

function provider(raw: any, mapping: Record<string, any> = {}) {
	const p = new BaileysProvider('account-status-like') as any;
	p.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
	p.state = 'connected';
	p.socket = {
		user: { id: '201000000000:5@s.whatsapp.net', lid: '99999:5@lid' },
		sendMessage: jest.fn(async () => undefined),
		signalRepository: { lidMapping: mapping },
	};
	p.resolveStatusRaw = jest.fn(() => raw);
	p.hydrateStatusRaw = jest.fn(async () => null);
	return p;
}

function sent(p: any) {
	const [jid, content, options] = p.socket.sendMessage.mock.calls[0];
	return { jid, key: content.react.key, text: content.react.text, recipients: options.statusJidList };
}

describe('liking a story', () => {
	it('keeps the story LID in the reaction key and delivers to the phone number', async () => {
		const p = provider({ key: { id: 'S1', participant: POSTER_LID, participantAlt: POSTER_PN } });
		await p.likeStatus('S1', POSTER_PN, '❤️');
		const out = sent(p);
		expect(out.jid).toBe('status@broadcast');
		expect(out.key).toEqual({ remoteJid: 'status@broadcast', id: 'S1', participant: POSTER_LID, fromMe: false });
		expect(out.recipients).toEqual([POSTER_PN, '201000000000@s.whatsapp.net']);
	});

	it('finds the phone number for a LID-only story through the LID mapping', async () => {
		const p = provider(
			{ key: { id: 'S2', participant: POSTER_LID } },
			{ getPNForLID: jest.fn(async () => '201011112222:0@s.whatsapp.net') },
		);
		await p.likeStatus('S2', POSTER_LID, '❤️');
		const out = sent(p);
		expect(out.key.participant).toBe(POSTER_LID);
		expect(out.recipients[0]).toBe(POSTER_PN);
		expect(out.recipients.some((jid: string) => jid.endsWith('@lid'))).toBe(false);
	});

	it('uses the poster LID in the key when only the phone number is known', async () => {
		const p = provider(null, { getLIDForPN: jest.fn(async () => POSTER_LID) });
		await p.likeStatus('S3', POSTER_PN, '');
		const out = sent(p);
		expect(out.key.participant).toBe(POSTER_LID);
		expect(out.text).toBe('');
		expect(out.recipients[0]).toBe(POSTER_PN);
	});
});
