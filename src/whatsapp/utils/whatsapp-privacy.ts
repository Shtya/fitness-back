import { WhatsAppAccount } from '../entities/whatsapp.entity';

export type WhatsAppReadReceiptMode = 'on_open' | 'on_reply' | 'manual' | 'never';

export interface WhatsAppPrivacySettings {
	hideStatusViewReceipts: boolean;
	readReceiptMode: WhatsAppReadReceiptMode;
	/** Sender keeps one grey tick until a reply is sent from the app (or the phone comes online). */
	holdDeliveryReceipts: boolean;
}

/** Older clients do not send holdDeliveryReceipts; it then keeps its saved value. */
export type WhatsAppPrivacySettingsInput = Omit<WhatsAppPrivacySettings, 'holdDeliveryReceipts'> & {
	holdDeliveryReceipts?: boolean;
};

export const DEFAULT_WHATSAPP_PRIVACY_SETTINGS: WhatsAppPrivacySettings = {
	hideStatusViewReceipts: true,
	readReceiptMode: 'on_reply',
	holdDeliveryReceipts: false,
};

const HIDE_STATUS_KEY = 'privacy.hideStatusViewReceipts';
const READ_MODE_KEY = 'privacy.readReceiptMode';
const HOLD_DELIVERY_KEY = 'privacy.holdDeliveryReceipts';

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
		holdDeliveryReceipts:
			typeof values[HOLD_DELIVERY_KEY] === 'boolean'
				? Boolean(values[HOLD_DELIVERY_KEY])
				: DEFAULT_WHATSAPP_PRIVACY_SETTINGS.holdDeliveryReceipts,
	};
}

export function mergeWhatsAppPrivacySettings(
	account: Pick<WhatsAppAccount, 'providerCapabilities'>,
	settings: WhatsAppPrivacySettingsInput,
): Record<string, boolean | string> {
	return {
		...(account.providerCapabilities || {}),
		[HIDE_STATUS_KEY]: settings.hideStatusViewReceipts,
		[READ_MODE_KEY]: settings.readReceiptMode,
		[HOLD_DELIVERY_KEY]:
			typeof settings.holdDeliveryReceipts === 'boolean'
				? settings.holdDeliveryReceipts
				: getWhatsAppPrivacySettings(account).holdDeliveryReceipts,
	};
}
