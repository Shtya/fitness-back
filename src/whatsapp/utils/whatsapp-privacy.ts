import { WhatsAppAccount } from '../entities/whatsapp.entity';

export type WhatsAppReadReceiptMode = 'on_open' | 'on_reply' | 'manual' | 'never';

export interface WhatsAppPrivacySettings {
	hideStatusViewReceipts: boolean;
	readReceiptMode: WhatsAppReadReceiptMode;
	/** Sender keeps one grey tick until a reply is sent from the app (or the phone comes online). */
	holdDeliveryReceipts: boolean;
	/** When true, composing/recording presence is not sent to contacts. */
	hideTypingIndicator: boolean;
}

/** Older clients omit optional flags; those keep their saved values. */
export type WhatsAppPrivacySettingsInput = Omit<
	WhatsAppPrivacySettings,
	'holdDeliveryReceipts' | 'hideTypingIndicator'
> & {
	holdDeliveryReceipts?: boolean;
	hideTypingIndicator?: boolean;
};

export const DEFAULT_WHATSAPP_PRIVACY_SETTINGS: WhatsAppPrivacySettings = {
	hideStatusViewReceipts: true,
	readReceiptMode: 'on_reply',
	holdDeliveryReceipts: false,
	hideTypingIndicator: false,
};

const HIDE_STATUS_KEY = 'privacy.hideStatusViewReceipts';
const READ_MODE_KEY = 'privacy.readReceiptMode';
const HOLD_DELIVERY_KEY = 'privacy.holdDeliveryReceipts';
const HIDE_TYPING_KEY = 'privacy.hideTypingIndicator';

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
		hideTypingIndicator:
			typeof values[HIDE_TYPING_KEY] === 'boolean'
				? Boolean(values[HIDE_TYPING_KEY])
				: DEFAULT_WHATSAPP_PRIVACY_SETTINGS.hideTypingIndicator,
	};
}

export function mergeWhatsAppPrivacySettings(
	account: Pick<WhatsAppAccount, 'providerCapabilities'>,
	settings: WhatsAppPrivacySettingsInput,
): Record<string, boolean | string> {
	const current = getWhatsAppPrivacySettings(account);
	return {
		...(account.providerCapabilities || {}),
		[HIDE_STATUS_KEY]: settings.hideStatusViewReceipts,
		[READ_MODE_KEY]: settings.readReceiptMode,
		[HOLD_DELIVERY_KEY]:
			typeof settings.holdDeliveryReceipts === 'boolean'
				? settings.holdDeliveryReceipts
				: current.holdDeliveryReceipts,
		[HIDE_TYPING_KEY]:
			typeof settings.hideTypingIndicator === 'boolean'
				? settings.hideTypingIndicator
				: current.hideTypingIndicator,
	};
}
