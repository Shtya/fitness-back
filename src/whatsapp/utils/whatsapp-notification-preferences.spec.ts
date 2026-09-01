import {
	DEFAULT_WHATSAPP_NOTIFICATION_PREFERENCES,
	getWhatsAppNotificationPreferences,
	userAllowsWhatsAppNotifications,
} from './whatsapp-notification-preferences';

describe('whatsapp-notification-preferences', () => {
	it('defaults to enabled when access row is missing', () => {
		expect(getWhatsAppNotificationPreferences(null)).toEqual(
			DEFAULT_WHATSAPP_NOTIFICATION_PREFERENCES,
		);
		expect(userAllowsWhatsAppNotifications(undefined)).toBe(true);
	});

	it('respects the stored notifications flag', () => {
		expect(
			getWhatsAppNotificationPreferences({ notificationsEnabled: false }),
		).toEqual({ notificationsEnabled: false });
		expect(userAllowsWhatsAppNotifications({ notificationsEnabled: false })).toBe(
			false,
		);
	});
});
