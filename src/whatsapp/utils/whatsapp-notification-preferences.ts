import { WhatsAppAccountAccess } from '../entities/whatsapp.entity';

export interface WhatsAppNotificationPreferences {
	notificationsEnabled: boolean;
}

export const DEFAULT_WHATSAPP_NOTIFICATION_PREFERENCES: WhatsAppNotificationPreferences = {
	notificationsEnabled: true,
};

export function getWhatsAppNotificationPreferences(
	access?: Pick<WhatsAppAccountAccess, 'notificationsEnabled'> | null,
): WhatsAppNotificationPreferences {
	return {
		notificationsEnabled:
			typeof access?.notificationsEnabled === 'boolean'
				? access.notificationsEnabled
				: DEFAULT_WHATSAPP_NOTIFICATION_PREFERENCES.notificationsEnabled,
	};
}

export function userAllowsWhatsAppNotifications(
	access?: Pick<WhatsAppAccountAccess, 'notificationsEnabled'> | null,
): boolean {
	return getWhatsAppNotificationPreferences(access).notificationsEnabled;
}
