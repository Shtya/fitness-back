import { createCipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'crypto';
import { deflateSync } from 'zlib';
import {
	decodeBundleMessages,
	decryptGroupHistoryBlob,
	isSafeDirectPath,
	prepareBundleMessages,
	readGroupHistoryBundle,
	topLevelFields,
	unpackCandidates,
} from './whatsapp-group-history-bundle';

/*
 * Stand-in proto: a "message" is its JSON. Real bundles go through Baileys' generated proto;
 * here only the framing (fields, layouts, crypto, packing) is under test.
 */
const enc = (value: unknown) => Buffer.from(JSON.stringify(value));
const dec = (bytes: Uint8Array) => JSON.parse(Buffer.from(bytes).toString('utf8'));
const proto = {
	WebMessageInfo: { decode: dec },
	HistorySync: {
		decode: (bytes: Uint8Array) => {
			const value = dec(bytes);
			if (!value || !Array.isArray(value.conversations)) throw new Error('not a HistorySync');
			return value;
		},
	},
};

function varint(n: number) {
	const out: number[] = [];
	while (n > 127) {
		out.push((n & 0x7f) | 0x80);
		n = Math.floor(n / 128);
	}
	out.push(n);
	return Buffer.from(out);
}

function lengthField(field: number, value: Buffer) {
	return Buffer.concat([varint(field * 8 + 2), varint(value.length), value]);
}

function encryptBlob(plain: Buffer, info: string) {
	const mediaKey = randomBytes(32);
	const expanded = Buffer.from(hkdfSync('sha256', mediaKey, Buffer.alloc(0), info, 112));
	const iv = expanded.subarray(0, 16);
	const cipher = createCipheriv('aes-256-cbc', expanded.subarray(16, 48), iv);
	const body = Buffer.concat([cipher.update(plain), cipher.final()]);
	const mac = createHmac('sha256', expanded.subarray(48, 80)).update(iv).update(body).digest().subarray(0, 10);
	const encrypted = Buffer.concat([body, mac]);
	return {
		encrypted,
		pointer: {
			mediaKey,
			fileSha256: createHash('sha256').update(plain).digest(),
			fileEncSha256: createHash('sha256').update(encrypted).digest(),
		},
	};
}

const GROUP = '120363000000000001@g.us';
const msg = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
	key: { remoteJid: GROUP, id, fromMe: false, participant: '201000000001@s.whatsapp.net' },
	message: { conversation: text },
	messageTimestamp: 1_790_000_000 + Number(id.replace(/\D/g, '') || 0),
	...extra,
});

describe('group history bundle', () => {
	it('decrypts with whichever key derivation passes the MAC', () => {
		for (const info of ['Group History', 'WhatsApp History Keys']) {
			const plain = Buffer.from(`hello ${info}`);
			const { encrypted, pointer } = encryptBlob(plain, info);
			const out = decryptGroupHistoryBlob(encrypted, pointer);
			expect(out.info).toBe(info);
			expect(out.plain.toString()).toBe(plain.toString());
		}
	});

	it('refuses a tampered blob or a wrong hash instead of decoding garbage', () => {
		const { encrypted, pointer } = encryptBlob(Buffer.from('x'.repeat(64)), 'Group History');
		const tampered = Buffer.from(encrypted);
		tampered[3] ^= 1;
		expect(() => decryptGroupHistoryBlob(tampered, { ...pointer, fileEncSha256: null })).toThrow(/MAC/);
		expect(() => decryptGroupHistoryBlob(tampered, pointer)).toThrow(/hash/);
		expect(() => decryptGroupHistoryBlob(encrypted, { ...pointer, mediaKey: randomBytes(32), fileEncSha256: null })).toThrow(/MAC/);
	});

	it('reads a zlib GroupHistory list (fields 1 and 4)', () => {
		const bytes = Buffer.concat([
			lengthField(1, enc(msg('AAAA0001', 'first'))),
			lengthField(1, enc(msg('AAAA0002', 'second'))),
			lengthField(4, enc(msg('AAAA0003', 'pinned'))),
		]);
		const unpacked = unpackCandidates(deflateSync(bytes));
		expect(unpacked[0].label).toBe('zlib');
		const decoded = decodeBundleMessages(unpacked[0].bytes, proto);
		expect(decoded?.layout).toBe('group-history');
		expect(decoded?.messages.map(m => m.key.id)).toEqual(['AAAA0001', 'AAAA0002', 'AAAA0003']);
	});

	it('reads a HistorySync layout when the top level is not a message list', () => {
		const sync = { conversations: [{ id: GROUP, messages: [{ message: msg('BBBB0001', 'hi') }, { message: msg('BBBB0002', 'yo') }] }] };
		// One opaque top-level field so the scan passes but the GroupHistory reading does not.
		const bytes = enc(sync);
		const decoded = decodeBundleMessages(bytes, {
			...proto,
			WebMessageInfo: { decode: () => ({}) },
			HistorySync: { decode: () => sync },
		});
		// a JSON buffer is not valid protobuf framing, so the scan rejects it outright
		expect(topLevelFields(bytes)).toBeNull();
		expect(decoded).toBeNull();
		const framed = lengthField(2, enc({ opaque: true }));
		const viaSync = decodeBundleMessages(framed, {
			...proto,
			WebMessageInfo: { decode: () => ({ key: { id: '' } }) },
			HistorySync: { decode: () => sync },
		});
		expect(viaSync?.layout).toBe('history-sync');
		expect(viaSync?.messages).toHaveLength(2);
	});

	it('stops on malformed framing and on too many entries', () => {
		expect(topLevelFields(Buffer.from([0x0a, 0x7f, 0x01]))).toBeNull();
		const many = Buffer.concat(Array.from({ length: 30 }, () => lengthField(1, Buffer.from('x'))));
		expect(topLevelFields(many, 10)).toBeNull();
		expect(topLevelFields(many, 100)).toHaveLength(30);
	});

	it('keeps only this group, maps "fromMe" to the sharer, dedupes and sorts', () => {
		const sharer = '201555000000@s.whatsapp.net';
		const own = '201999000000@s.whatsapp.net';
		const out = prepareBundleMessages(
			[
				msg('C0000003', 'third'),
				msg('C0000001', 'first'),
				msg('C0000001', 'dup'),
				{ ...msg('C0000002', 'from sharer'), key: { remoteJid: GROUP, id: 'C0000002', fromMe: true } },
				{ ...msg('C0000004', 'other chat'), key: { remoteJid: '1203@g.us', id: 'C0000004' } },
				{ ...msg('C0000005', 'mine'), key: { remoteJid: GROUP, id: 'C0000005', participant: `${own.split('@')[0]}:12@s.whatsapp.net` } },
			],
			{ groupJid: GROUP, sharerJid: sharer, ownJids: [own] },
		);
		expect(out.map(m => m.key.id)).toEqual(['C0000001', 'C0000002', 'C0000003', 'C0000005']);
		const fromSharer = out.find(m => m.key.id === 'C0000002');
		expect(fromSharer.key).toMatchObject({ fromMe: false, participant: sharer, remoteJid: GROUP });
		expect(out.find(m => m.key.id === 'C0000005').key.fromMe).toBe(true);
	});

	it('only fetches safe media paths, and reads a bundle end to end', async () => {
		expect(isSafeDirectPath('/v/t62.1234/abc?ccb=11')).toBe(true);
		expect(isSafeDirectPath('https://evil.example/x')).toBe(false);
		expect(isSafeDirectPath('//evil.example/x')).toBe(false);
		const bytes = deflateSync(Buffer.concat([lengthField(1, enc(msg('D0000001', 'hello'))), lengthField(1, enc(msg('D0000002', 'مرحبا')))]));
		const { encrypted, pointer } = encryptBlob(bytes, 'Group History');
		const urls: string[] = [];
		const fetchImpl = (async (url: string) => {
			urls.push(url);
			return new Response(encrypted, { status: 200 });
		}) as unknown as typeof fetch;
		const out = await readGroupHistoryBundle({ ...pointer, directPath: '/v/t62.1/xyz' }, proto, { fetchImpl });
		expect(urls).toEqual(['https://mmg.whatsapp.net/v/t62.1/xyz']);
		expect(out).toMatchObject({ layout: 'group-history', keyInfo: 'Group History', packing: 'zlib' });
		expect(out.messages.map(m => m.message.conversation)).toEqual(['hello', 'مرحبا']);
		await expect(
			readGroupHistoryBundle({ ...pointer, directPath: '/x', messageHistoryMetadata: { messageCount: 999999 } }, proto, { fetchImpl }),
		).rejects.toThrow(/too many/);
	});
});
