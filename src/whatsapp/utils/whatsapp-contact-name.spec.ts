import {
	isWeakWhatsAppContactName,
	preferWhatsAppContactName,
	resolveWhatsAppContactLabel,
} from './whatsapp-contact-name';

describe('whatsapp-contact-name', () => {
	it('treats raw phone / wa ids as weak labels', () => {
		expect(isWeakWhatsAppContactName('201551495772', '201551495772@c.us', '201551495772')).toBe(
			true,
		);
		expect(isWeakWhatsAppContactName('123456789012345', '123456789012345@lid')).toBe(true);
		expect(isWeakWhatsAppContactName('Ahmed Ibrahim')).toBe(false);
	});

	it('never replaces a saved contact name with a pushName', () => {
		expect(
			preferWhatsAppContactName('Ahmed Ibrahim', 'yassinnasser', '201000@c.us', '201000'),
		).toBe('Ahmed Ibrahim');
	});

	it('fills an empty/weak label from WhatsApp display name', () => {
		expect(preferWhatsAppContactName(null, 'yassinnasser')).toBe('yassinnasser');
		expect(preferWhatsAppContactName('201000', 'yassinnasser', '201000@c.us', '201000')).toBe(
			'yassinnasser',
		);
	});

	it('resolves saved name over pushName', () => {
		expect(
			resolveWhatsAppContactLabel({
				savedName: 'كابتن رفيع',
				pushName: 'aaaaaaaaasa211',
			}),
		).toBe('كابتن رفيع');
		expect(
			resolveWhatsAppContactLabel({
				savedName: null,
				pushName: 'aaaaaaaaasa211',
			}),
		).toBe('aaaaaaaaasa211');
		expect(
			resolveWhatsAppContactLabel({
				savedName: null,
				pushName: null,
				phone: '201551495772',
				chatId: '201551495772@c.us',
			}),
		).toBe(null);
	});
});
