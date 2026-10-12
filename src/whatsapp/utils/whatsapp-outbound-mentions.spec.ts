import { sanitizeWhatsAppOutboundMentions } from './whatsapp-outbound-mentions';

describe('sanitizeWhatsAppOutboundMentions', () => {
	it('keeps member JIDs referenced in the text and drops the rest', () => {
		expect(
			sanitizeWhatsAppOutboundMentions('Hi @201000000002 and @47962537328697', [
				'201000000002@c.us',
				'47962537328697@lid',
				'201000000009@s.whatsapp.net',
				'not-a-jid',
				'201000000002@c.us',
			]),
		).toEqual(['201000000002@c.us', '47962537328697@lid']);
	});

	it('strips device suffixes and refuses prefix-only matches', () => {
		expect(
			sanitizeWhatsAppOutboundMentions('ping @2010000000021', ['201000000002:4@s.whatsapp.net']),
		).toEqual([]);
		expect(
			sanitizeWhatsAppOutboundMentions('ping @201000000002', ['201000000002:4@s.whatsapp.net']),
		).toEqual(['201000000002@s.whatsapp.net']);
	});

	it('ignores non-array input', () => {
		expect(sanitizeWhatsAppOutboundMentions('@123456', 'x')).toEqual([]);
		expect(sanitizeWhatsAppOutboundMentions('@123456', undefined)).toEqual([]);
	});
});
