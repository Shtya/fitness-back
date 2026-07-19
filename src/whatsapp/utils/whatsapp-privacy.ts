import { WhatsAppAccount } from '../entities/whatsapp.entity';

export type WhatsAppReadReceiptMode = 'on_open' | 'on_reply' | 'manual' | 'never';

export interface WhatsAppPrivacySettings {
	hideStatusViewReceipts: boolean;
	readReceiptMode: WhatsAppReadReceiptMode;
}

export const DEFAULT_WHATSAPP_PRIVACY_SETTINGS: WhatsAppPrivacySettings = {
	hideStatusViewReceipts: true,
	readReceiptMode: 'on_reply',
};

const HIDE_STATUS_KEY = 'privacy.hideStatusViewReceipts';
const READ_MODE_KEY = 'privacy.readReceiptMode';

export function getWhatsAppPrivacySettings(
	account: Pick<WhatsAppAccount, 'providerCapabilities'>,
): WhatsAppPrivacySettings {
	const values = account?.providerCapabilities || {};
	const mode = values[READ_MODE_KEY];

	return {
		hideStatusViewReceipts:
			typeof values[HIDE_STATUS_KEY] === 'boolean'
				? Boolean(values[HIDE_STATUS_KEY])
				: DEFAULT_WHATSAPP_PRIVACY_SETTINGS.hideStatusViewReceipts,
		readReceiptMode:
			mode === 'on_open' || mode === 'on_reply' || mode === 'manual' || mode === 'never'
				? mode
				: DEFAULT_WHATSAPP_PRIVACY_SETTINGS.readReceiptMode,
	};
}

export function mergeWhatsAppPrivacySettings(
	account: Pick<WhatsAppAccount, 'providerCapabilities'>,
	settings: WhatsAppPrivacySettings,
): Record<string, boolean | string> {
	return {
		...(account.providerCapabilities || {}),
		[HIDE_STATUS_KEY]: settings.hideStatusViewReceipts,
		[READ_MODE_KEY]: settings.readReceiptMode,
	};
}
