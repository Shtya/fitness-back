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
		});
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
