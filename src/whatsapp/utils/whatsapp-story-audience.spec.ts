import {
	getWhatsAppStoryAudience,
	mergeWhatsAppStoryAudience,
	resolveStoryAudience,
} from './whatsapp-story-audience';

const A = '201000000001@s.whatsapp.net';
const B = '201000000002@s.whatsapp.net';
const C = '201000000003@s.whatsapp.net';

describe('whatsapp story audience', () => {
	it('defaults to every contact', () => {
		expect(getWhatsAppStoryAudience({ providerCapabilities: {} } as any)).toEqual({
			mode: 'contacts',
			waIds: [],
		});
	});

	it('normalizes saved ids and keeps other capability keys', () => {
		const merged = mergeWhatsAppStoryAudience(
			{ providerCapabilities: { 'privacy.readReceiptMode': 'never' } } as any,
			{ mode: 'except', waIds: ['201000000001', `${B}`, 'x@g.us', '123@lid'] },
		);
		expect(merged['privacy.readReceiptMode']).toBe('never');
		expect(getWhatsAppStoryAudience({ providerCapabilities: merged } as any)).toEqual({
			mode: 'except',
			waIds: [A, B],
		});
	});

	it('removes excluded people and lets the provider add its own contacts', () => {
		expect(resolveStoryAudience([A, B, C], { mode: 'except', waIds: [B] })).toEqual({
			waIds: [A, C],
			excludeWaIds: [B],
			exact: false,
		});
	});

	it('sends only to the chosen people, nobody else', () => {
		expect(resolveStoryAudience([A, B, C], { mode: 'only', waIds: [C] })).toEqual({
			waIds: [C],
			excludeWaIds: [],
			exact: true,
		});
	});

	it('sends to every candidate in contacts mode', () => {
		expect(resolveStoryAudience([A, B], { mode: 'contacts', waIds: [A] }).waIds).toEqual([A, B]);
	});
});
