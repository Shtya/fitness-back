import { createCipheriv, createHmac, randomBytes } from 'crypto';
import {
	decryptWaSecretEncryptedPayload,
	findWaMessageSecret,
	waMessageSecretKey,
	waNonAdJid,
	waSecretBytes,
} from './whatsapp-message-secret';

/** Manual HKDF exactly as Baileys' decryptPollVote does it (extract with 32 zero bytes, one expand block). */
function baileysStyleKey(secret: Buffer, id: string, orig: string, modifier: string, useCase: string) {
	const sign = Buffer.concat([
		Buffer.from(id),
		Buffer.from(orig),
		Buffer.from(modifier),
		Buffer.from(useCase),
		Buffer.from([1]),
	]);
	const prk = createHmac('sha256', Buffer.alloc(32)).update(secret).digest();
	return createHmac('sha256', prk).update(sign).digest();
}

function encrypt(key: Buffer, iv: Buffer, plain: Buffer) {
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

describe('whatsapp message secret', () => {
	const secret = randomBytes(32);
	const id = '3A50E3F7B314895E4062';
	const lid = '123456789012345@lid';
	const phone = '201000000001@s.whatsapp.net';

	it('derives the same key as the Baileys poll-vote HKDF', () => {
		expect(waMessageSecretKey(secret, id, phone, phone, 'Message Edit')).toEqual(
			baileysStyleKey(secret, id, phone, phone, 'Message Edit'),
		);
	});

	it('decrypts with whichever jid form the sender used (LID here)', () => {
		const iv = randomBytes(12);
		const plain = Buffer.from('edited payload');
		const encPayload = encrypt(waMessageSecretKey(secret, id, lid, lid, 'Message Edit'), iv, plain);
		const result = decryptWaSecretEncryptedPayload({
			secret,
			origMsgId: id,
			origSenders: ['201000000001@c.us', `123456789012345:7@lid`],
			modificationSenders: [phone, lid],
			encPayload,
			encIv: iv,
		});
		expect(result?.toString()).toBe('edited payload');
	});

	it('returns null with the wrong secret', () => {
		const iv = randomBytes(12);
		const encPayload = encrypt(waMessageSecretKey(secret, id, phone, phone, 'Message Edit'), iv, Buffer.from('x'));
		expect(
			decryptWaSecretEncryptedPayload({
				secret: randomBytes(32),
				origMsgId: id,
				origSenders: [phone],
				modificationSenders: [phone],
				encPayload,
				encIv: iv,
			}),
		).toBeNull();
	});

	it('normalizes jids and reads secrets in any stored shape', () => {
		expect(waNonAdJid('201000000001:12@s.whatsapp.net')).toBe(phone);
		expect(waNonAdJid('201000000001@c.us')).toBe(phone);
		expect(waSecretBytes(secret.toString('base64'))).toEqual(secret);
		expect(waSecretBytes({ type: 'Buffer', data: [...secret] })).toEqual(secret);
		expect(waSecretBytes({ 0: 1, 1: 2 })).toEqual(Buffer.from([1, 2]));
		expect(
			findWaMessageSecret({
				ephemeralMessage: { message: { conversation: 'x', messageContextInfo: { messageSecret: secret } } },
			}),
		).toEqual(secret);
	});
});
