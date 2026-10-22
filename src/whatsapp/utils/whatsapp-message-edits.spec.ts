import { appendWhatsAppEditHistory, whatsAppEditSource } from './whatsapp-message-edits';

const at = new Date('2026-10-22T10:00:00.000Z');

describe('appendWhatsAppEditHistory', () => {
	it('appends the previous and new text on the first edit', () => {
		expect(
			appendWhatsAppEditHistory(null, { previousText: 'hello', text: 'hello there', editedAt: at, by: 'contact' }),
		).toEqual([
			{ previousText: 'hello', text: 'hello there', editedAt: '2026-10-22T10:00:00.000Z', by: 'contact' },
		]);
	});

	it('skips duplicate deliveries of the same edit and unchanged text', () => {
		const first = appendWhatsAppEditHistory([], { previousText: 'a', text: 'b', editedAt: at, by: 'contact' });
		expect(appendWhatsAppEditHistory(first, { previousText: 'a', text: 'b', editedAt: at, by: 'contact' })).toBeNull();
		expect(appendWhatsAppEditHistory(first, { previousText: 'b', text: 'b', editedAt: at, by: 'contact' })).toBeNull();
		expect(appendWhatsAppEditHistory(first, { previousText: 'b', text: '   ', editedAt: at, by: 'contact' })).toBeNull();
	});

	it('relabels the phone echo of a CRM edit as staff instead of duplicating it', () => {
		const echoed = appendWhatsAppEditHistory([], { previousText: 'a', text: 'b', editedAt: at, by: 'phone' });
		expect(appendWhatsAppEditHistory(echoed, { previousText: 'a', text: 'b', editedAt: at, by: 'staff' })).toEqual([
			{ previousText: 'a', text: 'b', editedAt: '2026-10-22T10:00:00.000Z', by: 'staff' },
		]);
	});

	it('keeps successive edits in order and caps the history', () => {
		let history: any = null;
		const texts = ['v1', 'v2', 'v3', 'v4'];
		for (let index = 1; index < texts.length; index += 1) {
			history = appendWhatsAppEditHistory(
				history,
				{ previousText: texts[index - 1], text: texts[index], editedAt: at, by: 'contact' },
				2,
			);
		}
		expect(history.map((entry: any) => `${entry.previousText}>${entry.text}`)).toEqual(['v2>v3', 'v3>v4']);
	});

	it('ignores malformed stored entries', () => {
		expect(
			appendWhatsAppEditHistory([null, { foo: 1 }], { previousText: 'a', text: 'b', editedAt: at, by: 'contact' }),
		).toHaveLength(1);
	});
});

describe('whatsAppEditSource', () => {
	it('labels inbound edits as contact and own edits as phone', () => {
		expect(whatsAppEditSource('inbound', false)).toBe('contact');
		expect(whatsAppEditSource('outbound', false)).toBe('phone');
		expect(whatsAppEditSource('inbound', true)).toBe('phone');
	});
});
