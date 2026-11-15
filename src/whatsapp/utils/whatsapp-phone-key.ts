/**
 * One bucket key per real phone number: strips "00", and turns a national number with a leading
 * 0 into international form using the linked account's own country code (WHATSAPP_DEFAULT_COUNTRY_CODE, else Egypt).
 */
export function normalizePhoneKey(digits: string, ownDigits = ''): string {
	let value = String(digits || '').replace(/\D/g, '');
	if (!value) return '';
	if (value.startsWith('00')) value = value.slice(2);
	if (value.startsWith('0') && value.length >= 9 && value.length <= 11) {
		const own = String(ownDigits || '').replace(/\D/g, '');
		const codes = ['20', '966', '971', '965', '974', '973', '968', '962', '961', '212', '213', '216', '218', '249', '1', '44', '90'];
		const code = codes.find((item) => own.startsWith(item) && own.length > item.length + 6) || String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '20').replace(/\D/g, '') || '20';
		value = `${code}${value.slice(1)}`;
	}
	return value.length >= 8 && value.length <= 15 ? value : '';
}
