import {
	getWhatsAppPrivacySettings,
	mergeWhatsAppPrivacySettings,
} from './whatsapp-privacy';

describe('WhatsApp privacy settings', () => {
	it('defaults to hidden status views and read-on-reply', () => {
		expect(
			getWhatsAppPrivacySettings({ providerCapabilities: {} } as any),
		).toEqual({
			hideStatusViewReceipts: true,
			readReceiptMode: 'on_reply',
			holdDeliveryReceipts: false,
		});
	});

	it('saves the hold-delivery setting and keeps it when an older client omits it', () => {
		const on = mergeWhatsAppPrivacySettings({ providerCapabilities: {} } as any, {
			hideStatusViewReceipts: true,
			readReceiptMode: 'on_reply',
			holdDeliveryReceipts: true,
		});
		expect(getWhatsAppPrivacySettings({ providerCapabilities: on } as any).holdDeliveryReceipts).toBe(true);
		const kept = mergeWhatsAppPrivacySettings({ providerCapabilities: on } as any, {
			hideStatusViewReceipts: false,
			readReceiptMode: 'never',
		});
		expect(kept['privacy.holdDeliveryReceipts']).toBe(true);
	});

	it('preserves capabilities while updating privacy settings', () => {
		const providerCapabilities = mergeWhatsAppPrivacySettings(
			{ providerCapabilities: { history: true } } as any,
			{
				hideStatusViewReceipts: false,
				readReceiptMode: 'never',
			},
		);

		expect(providerCapabilities).toMatchObject({
			history: true,
			'privacy.hideStatusViewReceipts': false,
			'privacy.readReceiptMode': 'never',
		});
	});

	it('accepts the explicit manual read-receipt mode', () => {
		expect(
			getWhatsAppPrivacySettings({
				providerCapabilities: {
					'privacy.readReceiptMode': 'manual',
				},
			} as any),
		).toMatchObject({ readReceiptMode: 'manual' });
	});
});
