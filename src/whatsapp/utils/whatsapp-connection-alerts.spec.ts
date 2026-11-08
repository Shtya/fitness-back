import {
	buildWhatsAppConnectionAlert,
	shouldAlertOutage,
	WHATSAPP_OUTAGE_ALERT_AFTER_MS,
	whatsappAccountName,
} from './whatsapp-connection-alerts';

describe('whatsapp connection alerts', () => {
	it('names the account by label and number', () => {
		expect(whatsappAccountName({ label: 'Main', phoneNumber: '2010' })).toBe('Main (2010)');
		expect(whatsappAccountName({ label: '', phoneNumber: '2010' })).toBe('2010');
		expect(whatsappAccountName(null)).toBe('WhatsApp');
	});

	it('asks for a new scan only when the device was unlinked', () => {
		expect(buildWhatsAppConnectionAlert('logged_out', 'Main').requiresScan).toBe(true);
		expect(buildWhatsAppConnectionAlert('still_down', 'Main', { downMinutes: 12 }).title).toContain('12');
		expect(buildWhatsAppConnectionAlert('restored', 'Main').requiresScan).toBe(false);
		expect(buildWhatsAppConnectionAlert('error', 'Main', { reason: 'boom' }).message).toContain('boom');
	});

	it('reports an outage once, after the grace period', () => {
		const since = 1_000_000;
		expect(shouldAlertOutage(undefined, since + WHATSAPP_OUTAGE_ALERT_AFTER_MS)).toBe(false);
		expect(shouldAlertOutage({ since, alerted: false }, since + WHATSAPP_OUTAGE_ALERT_AFTER_MS - 1)).toBe(false);
		expect(shouldAlertOutage({ since, alerted: false }, since + WHATSAPP_OUTAGE_ALERT_AFTER_MS)).toBe(true);
		expect(shouldAlertOutage({ since, alerted: true }, since + 10 * WHATSAPP_OUTAGE_ALERT_AFTER_MS)).toBe(false);
	});
});
