/**
 * Messages for WhatsApp connection alerts. When a linked device drops, new messages stop
 * arriving without any visible error, so the people who manage the account are told directly
 * (in-app, web push, mobile push) instead of finding out from a quiet inbox.
 */
export type WhatsAppConnectionAlertKind = 'logged_out' | 'error' | 'still_down' | 'restored';

/** A drop shorter than this is a normal reconnect and is not worth an alert. */
export const WHATSAPP_OUTAGE_ALERT_AFTER_MS = 10 * 60 * 1000;

export function whatsappAccountName(account?: { label?: string | null; phoneNumber?: string | null } | null) {
	const label = String(account?.label || '').trim();
	const phone = String(account?.phoneNumber || '').trim();
	if (label && phone) return `${label} (${phone})`;
	return label || phone || 'WhatsApp';
}

export function buildWhatsAppConnectionAlert(
	kind: WhatsAppConnectionAlertKind,
	accountName: string,
	options: { downMinutes?: number; reason?: string | null } = {},
): { title: string; message: string; requiresScan: boolean } {
	const name = accountName || 'WhatsApp';
	switch (kind) {
		case 'logged_out':
			return {
				title: 'واتساب اتفصل ومحتاج لينك جديد',
				message: `الحساب ${name} اتشال من الأجهزة المرتبطة، والرسايل الجديدة مش هتوصل. افتح واتساب في الداشبورد وامسح الـ QR تاني. · WhatsApp unlinked ${name}: scan the QR again.`,
				requiresScan: true,
			};
		case 'error':
			return {
				title: 'واتساب وقف عن الاتصال',
				message: `الحساب ${name} وقف${options.reason ? `: ${options.reason}` : ''}. افتح واتساب في الداشبورد واعمل إعادة اتصال. · WhatsApp stopped for ${name}.`,
				requiresScan: false,
			};
		case 'still_down': {
			const minutes = Math.max(1, Math.round(Number(options.downMinutes) || 0));
			return {
				title: `واتساب مفصول من ${minutes} دقيقة`,
				message: `الحساب ${name} مش متصل، والرسايل الجديدة مش بتوصل. افتح واتساب في الداشبورد وشوف الاتصال، ولو طلب QR اعمل لينك تاني. · ${name} has been offline for ${minutes} min.`,
				requiresScan: false,
			};
		}
		case 'restored':
		default:
			return {
				title: 'واتساب رجع اتصل',
				message: `الحساب ${name} متصل تاني والرسايل بتوصل. · ${name} is back online.`,
				requiresScan: false,
			};
	}
}

/** True when an unannounced outage has lasted long enough to report. */
export function shouldAlertOutage(
	outage: { since: number; alerted: boolean } | undefined,
	now: number,
	afterMs = WHATSAPP_OUTAGE_ALERT_AFTER_MS,
) {
	return Boolean(outage && !outage.alerted && now - outage.since >= afterMs);
}
