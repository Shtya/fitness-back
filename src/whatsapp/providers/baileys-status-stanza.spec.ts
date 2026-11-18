import { BaileysProvider } from './baileys.provider';

const POSTER = '128050339573779@lid';

function provider() {
	const p = new BaileysProvider('account-status-stanza') as any;
	p.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
	p.state = 'connected';
	return p;
}

function socket() {
	return {
		sendNode: jest.fn(async () => undefined),
		signalRepository: {},
		authState: { creds: { me: { id: '201000000000:5@s.whatsapp.net', lid: '99999@lid' } } },
	};
}

/** A <status> stanza as WhatsApp now sends contacts' stories. */
function stanza(attrs: Record<string, string>) {
	return {
		tag: 'status',
		attrs: { id: 'ST1', type: 'media', t: String(Math.floor(Date.now() / 1000)), ...attrs },
		content: [{ tag: 'enc', attrs: { type: 'skmsg', v: '2' }, content: new Uint8Array([1, 2, 3]) }],
	};
}

function decryptingTo(message: any) {
	return jest.fn((node: any) => ({
		fullMessage: {
			key: { remoteJid: node.attrs.from, id: node.attrs.id, fromMe: false, participant: node.attrs.participant },
			messageTimestamp: Number(node.attrs.t),
			message,
		},
		decrypt: jest.fn(async () => undefined),
	}));
}

describe('stories delivered as a <status> stanza', () => {
	it('reads the story like a status@broadcast message, keeps it, and acks the stanza', async () => {
		const p = provider();
		const sock = socket();
		p.decryptMessageNode = decryptingTo({ imageMessage: { caption: 'my story' } });
		await p.handleStatusStanza(stanza({ from: 'status@broadcast', participant: POSTER }), sock);
		const [node] = p.decryptMessageNode.mock.calls[0];
		expect(node.tag).toBe('message');
		expect(node.attrs).toEqual(expect.objectContaining({ from: 'status@broadcast', participant: POSTER }));
		expect(p.statusesById.size).toBe(1);
		expect(sock.sendNode).toHaveBeenCalledWith(
			expect.objectContaining({ tag: 'ack', attrs: expect.objectContaining({ id: 'ST1', class: 'status', type: 'media' }) }),
		);
		expect((await p.getStoryDiagnostics()).statusStanzas).toBe(1);
	});

	it('takes the poster from `from` when the stanza carries no participant', async () => {
		const p = provider();
		p.decryptMessageNode = decryptingTo({ conversation: 'text story' });
		await p.handleStatusStanza(stanza({ from: POSTER }), socket());
		expect(p.decryptMessageNode.mock.calls[0][0].attrs).toEqual(
			expect.objectContaining({ from: 'status@broadcast', participant: POSTER }),
		);
		expect(p.statusesById.size).toBe(1);
	});

	it('still acks when the story cannot be read (an unacked stanza drops the connection)', async () => {
		const p = provider();
		const sock = socket();
		p.decryptMessageNode = jest.fn(() => {
			throw new Error('boom');
		});
		await p.handleStatusStanza(stanza({ from: 'status@broadcast', participant: POSTER }), sock);
		expect(sock.sendNode).toHaveBeenCalledTimes(1);
		expect(p.statusesById.size).toBe(0);
	});

	it('asks the poster to send a story again when it cannot be decrypted (missing story key)', async () => {
		const p = provider();
		const sock: any = { ...socket(), sendRetryRequest: jest.fn(async () => undefined) };
		p.decryptMessageNode = jest.fn((node: any) => ({
			fullMessage: {
				key: { remoteJid: 'status@broadcast', id: node.attrs.id, fromMe: false, participant: node.attrs.participant },
				messageTimestamp: Number(node.attrs.t),
				messageStubType: 2,
				messageStubParameters: ['No session found to decrypt message'],
			},
			decrypt: jest.fn(async () => undefined),
		}));
		const st = stanza({ from: 'status@broadcast', participant: POSTER });
		await p.handleStatusStanza(st, sock);
		expect(sock.sendRetryRequest).toHaveBeenCalledTimes(1);
		const [retryNode] = sock.sendRetryRequest.mock.calls[0];
		// Receipt goes back to whoever sent the stanza, with its participant.
		expect(retryNode.tag).toBe('message');
		expect(retryNode.attrs).toEqual(st.attrs);
		expect(p.statusesById.size).toBe(0);
		expect(sock.sendNode).toHaveBeenCalledTimes(1);
		expect((await p.getStoryDiagnostics()).statusRetryReceipts).toBe(1);
	});

	it('does not ask again for a duplicate or a story older than a day', async () => {
		const p = provider();
		const sock: any = { ...socket(), sendRetryRequest: jest.fn(async () => undefined) };
		const failing = (reason: string) =>
			jest.fn((node: any) => ({
				fullMessage: {
					key: { remoteJid: 'status@broadcast', id: node.attrs.id, fromMe: false, participant: node.attrs.participant },
					messageTimestamp: Number(node.attrs.t),
					messageStubType: 2,
					messageStubParameters: [reason],
				},
				decrypt: jest.fn(async () => undefined),
			}));
		p.decryptMessageNode = failing('Key used already or never filled');
		await p.handleStatusStanza(stanza({ from: 'status@broadcast', participant: POSTER }), sock);
		p.decryptMessageNode = failing('No session found to decrypt message');
		const old = String(Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60);
		await p.handleStatusStanza(stanza({ from: 'status@broadcast', participant: POSTER, t: old }), sock);
		expect(sock.sendRetryRequest).not.toHaveBeenCalled();
		expect(sock.sendNode).toHaveBeenCalledTimes(2);
	});

	it('passes on a like on our story that came as a <status> stanza', async () => {
		const p = provider();
		const events: any[] = [];
		p.emit = (event: any) => events.push(event);
		p.decryptMessageNode = decryptingTo({
			reactionMessage: { text: '❤️', key: { remoteJid: 'status@broadcast', id: 'OUR-STORY', fromMe: true } },
		});
		await p.handleStatusStanza(stanza({ from: 'status@broadcast', participant: POSTER, type: 'reaction' }), socket());
		const like = events.find(event => event.type === 'status_like');
		expect(like).toEqual(
			expect.objectContaining({ statusMessageId: 'OUR-STORY', actorJid: POSTER, emoji: '❤️', fromMe: false }),
		);
		expect(p.statusesById.size).toBe(0);
		expect((await p.getStoryDiagnostics()).statusLikeStanzas).toBe(1);
	});

	it('acks group statuses without storing them as a contact story', async () => {
		const p = provider();
		const sock = socket();
		p.decryptMessageNode = jest.fn();
		await p.handleStatusStanza(stanza({ from: '120363000000@g.us', participant: POSTER }), sock);
		expect(p.decryptMessageNode).not.toHaveBeenCalled();
		expect(sock.sendNode).toHaveBeenCalledTimes(1);
	});
});
