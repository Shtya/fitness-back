import {
	isStatusReactionText,
	statusActorKey,
	statusMessageKey,
	statusQuoteFromContextInfo,
} from './whatsapp-status-interactions';

describe('statusMessageKey', () => {
	it('extracts the bare id from serialized story ids', () => {
		expect(statusMessageKey('true_status@broadcast_3EB0ABC123_201000000000@c.us')).toBe(
			'3EB0ABC123',
		);
		expect(statusMessageKey('false_status@broadcast_3A11FF_1234@lid')).toBe('3A11FF');
		expect(statusMessageKey('true_status@broadcast_3EB0XYZ')).toBe('3EB0XYZ');
	});

	it('keeps an already-bare id and rejects empty input', () => {
		expect(statusMessageKey('3EB0ABC123')).toBe('3EB0ABC123');
		expect(statusMessageKey('')).toBe('');
		expect(statusMessageKey(null)).toBe('');
	});
});

describe('statusActorKey', () => {
	it('drops the device suffix so one person is one viewer', () => {
		expect(statusActorKey('201000000000:12@s.whatsapp.net')).toBe('201000000000@s.whatsapp.net');
		expect(statusActorKey('201000000000@s.whatsapp.net')).toBe('201000000000@s.whatsapp.net');
		expect(statusActorKey('ABC@LID')).toBe('abc@lid');
	});

	it('folds @c.us into @s.whatsapp.net and rejects bare values', () => {
		expect(statusActorKey('201000000000@c.us')).toBe('201000000000@s.whatsapp.net');
		expect(statusActorKey('201000000000')).toBe('');
		expect(statusActorKey(null)).toBe('');
	});
});

describe('isStatusReactionText', () => {
	it('accepts a single emoji, including multi-codepoint ones', () => {
		for (const emoji of ['😂', '❤️', '👍🏽', '👨‍👩‍👧', '🇪🇬', '1️⃣', '🔥']) {
			expect(isStatusReactionText(emoji)).toBe(true);
		}
		expect(isStatusReactionText('  😮 ')).toBe(true);
	});

	it('rejects text, several emojis and empty input', () => {
		for (const text of ['ok', 'nice 😂', '😂😂', '1', '', '   ', null, 'ح']) {
			expect(isStatusReactionText(text as any)).toBe(false);
		}
	});
});

describe('statusQuoteFromContextInfo', () => {
	it('reads the story a reply quotes', () => {
		expect(
			statusQuoteFromContextInfo({
				remoteJid: 'status@broadcast',
				stanzaId: '3EB0ABC',
				participant: '201000000000@s.whatsapp.net',
			}),
		).toEqual({ statusMessageId: '3EB0ABC', ownerJid: '201000000000@s.whatsapp.net' });
	});

	it('ignores ordinary quotes', () => {
		expect(
			statusQuoteFromContextInfo({ stanzaId: '3EB0ABC', participant: 'x@s.whatsapp.net' }),
		).toBeNull();
		expect(
			statusQuoteFromContextInfo({ remoteJid: '1203@g.us', stanzaId: '3EB0ABC' }),
		).toBeNull();
		expect(statusQuoteFromContextInfo({ remoteJid: 'status@broadcast' })).toBeNull();
		expect(statusQuoteFromContextInfo(null)).toBeNull();
	});
});
