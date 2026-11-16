import { BaileysProvider } from './baileys.provider';

const LID = '128050339573779@lid';
const PN = '201001234567@s.whatsapp.net';
const PN_KEY = '201001234567@c.us'; // how the provider normalises phone JIDs

function provider() {
	const p = new BaileysProvider('account-story-test') as any;
	p.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
	p.state = 'connected';
	return p;
}

/** A story stanza Baileys could not decrypt: no content, CIPHERTEXT stub with the error. */
function undecryptable(id: string) {
	return {
		key: { remoteJid: 'status@broadcast', id, fromMe: false, participant: LID, remoteJidAlt: PN },
		messageTimestamp: Math.floor(Date.now() / 1000) - 60,
		messageStubType: 2,
		messageStubParameters: ['No SenderKeyRecord found for decryption'],
	};
}

describe('stories that cannot be decrypted', () => {
	it('records the failure per sender and asks our own phone for the story', async () => {
		const p = provider();
		const requests: any[] = [];
		p.socket = {
			requestPlaceholderResend: jest.fn(async (key: any) => {
				requests.push(key);
				// The phone answers with its decrypted copy: Baileys emits it like any message.
				p.rememberStatus({
					key: { remoteJid: 'status@broadcast', id: key.id, fromMe: false, participant: LID, remoteJidAlt: PN },
					messageTimestamp: Math.floor(Date.now() / 1000) - 60,
					message: { extendedTextMessage: { text: 'hello from the story' } },
				});
			}),
		};
		expect(p.rememberStatus(undecryptable('S1'))).toBe(false);
		// wait for the queue to run
		for (let i = 0; i < 20 && p.storyRecoveryQueue.size; i++) await new Promise((r) => setTimeout(r, 100));
		expect(requests).toEqual([expect.objectContaining({ remoteJid: 'status@broadcast', id: 'S1', fromMe: false })]);
		expect(p.statusesById.size).toBe(1);
		const diag = await p.getStoryDiagnostics();
		expect(diag.senders[0]).toEqual(
			expect.objectContaining({ sender: PN_KEY, failed: 1, recovered: 1, kept: 0, lastError: 'No SenderKeyRecord found for decryption' }),
		);
		expect(diag.pendingPhoneRecovery).toBe(0);
	}, 15_000);

	it('does not ask the phone for expired stories or our own', () => {
		const p = provider();
		p.socket = { requestPlaceholderResend: jest.fn() };
		const old = { ...undecryptable('OLD'), messageTimestamp: Math.floor(Date.now() / 1000) - 25 * 3600 };
		p.rememberStatus(old);
		const own = undecryptable('MINE');
		own.key.fromMe = true;
		p.rememberStatus(own);
		expect(p.storyRecoveryQueue.size).toBe(0);
	});

	it('counts stories that decrypt normally as kept', async () => {
		const p = provider();
		p.rememberStatus({
			key: { remoteJid: 'status@broadcast', id: 'OK1', fromMe: false, participant: LID, remoteJidAlt: PN },
			messageTimestamp: Math.floor(Date.now() / 1000),
			message: { conversation: 'hi' },
		});
		const diag = await p.getStoryDiagnostics();
		expect(diag.senders[0]).toEqual(expect.objectContaining({ sender: PN_KEY, kept: 1, failed: 0 }));
	});
});
