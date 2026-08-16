export type GmailOAuthTokens = {
	accessToken: string;
	refreshToken: string;
	expiryDate: number;
	scope?: string;
};

export type ExtractedGmailMessage = {
	gmailMessageId: string;
	threadId: string;
	senderName: string;
	senderEmail: string;
	subject: string;
	snippet: string;
	bodyText: string;
	gmailUrl: string;
	labelIds: string[];
	receivedAt: Date | null;
	unread: boolean;
	headers: Record<string, string>;
};

const BLOCKED_LABELS = new Set(['SENT', 'DRAFT', 'SPAM', 'TRASH']);

export function allowedFrontendOrigins(raw?: string | null) {
	const fromEnv = String(raw || process.env.FRONTEND_URL || '')
		.split(',')
		.map((item) => item.trim().replace(/\/$/, ''))
		.filter(Boolean);
	return [
		...new Set([
			...fromEnv,
			'http://localhost:3000',
			'http://127.0.0.1:3000',
			'https://so7bafit.com',
			'https://www.so7bafit.com',
		]),
	];
}

export function firstFrontendOrigin(raw?: string | null) {
	return allowedFrontendOrigins(raw)[0];
}

export function resolveFrontendOrigin(candidate?: string | null, raw?: string | null) {
	const allowed = allowedFrontendOrigins(raw);
	try {
		if (candidate) {
			const origin = new URL(candidate).origin;
			if (allowed.includes(origin)) return origin;
		}
	} catch {
		/* ignore invalid */
	}
	return firstFrontendOrigin(raw);
}

export function publicApiOrigin() {
	const raw =
		process.env.EMAIL_MEMO_PUBLIC_API_URL ||
		process.env.META_WHATSAPP_PUBLIC_API_URL ||
		`http://localhost:${String(process.env.PORT || 8083).replace(/\s/g, '')}`;
	return String(raw).replace(/\/$/, '').replace(/\/api\/v1$/i, '');
}

export function gmailRedirectUri(rawFromConfig?: string | null) {
	const callbackPath = '/api/v1/email-memo/gmail/callback';
	const raw = String(
		rawFromConfig ||
			process.env.GOOGLE_REDIRECT_URI ||
			process.env.GOOGLE_REDIRECT_BASE_URL ||
			process.env.EMAIL_MEMO_PUBLIC_API_URL ||
			'',
	)
		.trim()
		.replace(/\/$/, '');
	if (!raw) return `${publicApiOrigin()}${callbackPath}`;
	if (/\/email-memo\/gmail\/callback$/i.test(raw)) return raw;
	return `${raw.replace(/\/api\/v1$/i, '')}${callbackPath}`;
}

export function htmlToCleanText(html: string) {
	return String(html || '')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_, code) => {
			const n = Number(code);
			return n && n < 1114111 ? String.fromCharCode(n) : ' ';
		})
		.replace(/\r/g, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]{2,}/g, ' ')
		.trim()
		.slice(0, 20000);
}

export function cleanEmailBodyText(value: string) {
	let text = htmlToCleanText(value).replace(/=\r?\n/g, '').replace(/=3D/gi, '=');
	text = text.replace(/(https?:\/\/[^\s]+)\n([^\s]+)/g, '$1$2');
	text = text.replace(/https?:\/\/[^\s<]+/gi, ' ');
	const drop =
		/^(unsubscribe|privacy policy|help centre|help center|terms of service|manage preferences|view (in|as) (browser|web)|this email was sent|if you no longer|you received this|copyright)/i;
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => {
			if (line.length < 2) return false;
			if (/^[\s[\]().,\-_]+$/.test(line)) return false;
			if (drop.test(line)) return false;
			if (/^[A-Za-z0-9+/=]{40,}$/.test(line)) return false;
			return true;
		});
	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000);
}

function readableBodyScore(text: string) {
	const raw = String(text || '');
	if (!raw) return -1;
	const urls = raw.match(/https?:\/\/\S+/gi) || [];
	const letters = (raw.match(/[A-Za-z\u0600-\u06FF0-9]/g) || []).length;
	return letters - urls.join('').length;
}

export function pickReadableEmailBody(plain: string, html: string, snippet: string) {
	const candidates = [
		cleanEmailBodyText(plain),
		cleanEmailBodyText(html),
		String(snippet || '').trim(),
	].filter(Boolean);
	let best = candidates[0] || '';
	let bestScore = -1;
	for (const item of candidates) {
		const score = readableBodyScore(item);
		if (score > bestScore) {
			best = item;
			bestScore = score;
		}
	}
	return best.slice(0, 12000);
}

function decodeBase64Url(value?: string | null) {
	if (!value) return '';
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	try {
		return Buffer.from(padded, 'base64').toString('utf8');
	} catch {
		return '';
	}
}

function headerMap(headers: Array<{ name?: string; value?: string }> = []) {
	const map: Record<string, string> = {};
	for (const header of headers) {
		const name = String(header?.name || '').trim().toLowerCase();
		if (!name) continue;
		map[name] = String(header?.value || '').trim();
	}
	return map;
}

function parseFrom(raw: string) {
	const value = String(raw || '').trim();
	const angled = value.match(/^(.*)<([^>]+)>\s*$/);
	if (angled) {
		return {
			senderName: angled[1].replace(/["']/g, '').trim() || angled[2].trim(),
			senderEmail: angled[2].trim().toLowerCase(),
		};
	}
	if (value.includes('@')) {
		return { senderName: value, senderEmail: value.toLowerCase() };
	}
	return { senderName: value, senderEmail: '' };
}

function collectBodies(part: any, acc: { text: string; html: string }) {
	if (!part) return acc;
	const mime = String(part.mimeType || '').toLowerCase();
	const data = decodeBase64Url(part.body?.data);
	if (mime === 'text/plain' && data) acc.text += `${acc.text ? '\n' : ''}${data}`;
	if (mime === 'text/html' && data) acc.html += `${acc.html ? '\n' : ''}${data}`;
	for (const child of part.parts || []) collectBodies(child, acc);
	return acc;
}

export function extractGmailPayload(raw: any): ExtractedGmailMessage {
	const headers = headerMap(raw?.payload?.headers || []);
	const from = parseFrom(headers.from || '');
	const bodies = collectBodies(raw?.payload, { text: '', html: '' });
	const bodyText = pickReadableEmailBody(bodies.text, bodies.html, String(raw?.snippet || '')).slice(0, 12000);
	const threadId = String(raw?.threadId || '');
	const gmailMessageId = String(raw?.id || '');
	const labelIds = Array.isArray(raw?.labelIds) ? raw.labelIds.map(String) : [];
	const internal = Number(raw?.internalDate || 0);
	return {
		gmailMessageId,
		threadId,
		senderName: from.senderName,
		senderEmail: from.senderEmail,
		subject: headers.subject || '(no subject)',
		snippet: String(raw?.snippet || '').slice(0, 500),
		bodyText,
		gmailUrl: threadId
			? `https://mail.google.com/mail/u/0/#inbox/${threadId}`
			: `https://mail.google.com/mail/u/0/#inbox/${gmailMessageId}`,
		labelIds,
		receivedAt: internal ? new Date(internal) : null,
		unread: labelIds.includes('UNREAD'),
		headers,
	};
}

export function isBlockedGmailMessage(labelIds: string[] = []) {
	return labelIds.some((label) => BLOCKED_LABELS.has(String(label).toUpperCase()));
}

export function looksLikeNewsletter(extracted: ExtractedGmailMessage) {
	const headers = extracted.headers || {};
	const from = `${extracted.senderEmail} ${extracted.senderName}`.toLowerCase();
	if (headers['list-unsubscribe'] || headers['list-id'] || headers.precedence === 'bulk') return true;
	return /newsletter|noreply|no-reply|donotreply|mailer-daemon|notifications@|news@/.test(from);
}

const MULTI_TLD = new Set(['co.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'co.za', 'com.eg']);

const CONSUMER_MAILBOXES = new Set([
	'gmail.com',
	'googlemail.com',
	'outlook.com',
	'hotmail.com',
	'live.com',
	'msn.com',
	'yahoo.com',
	'ymail.com',
	'icloud.com',
	'me.com',
	'mac.com',
	'proton.me',
	'protonmail.com',
	'aol.com',
]);

const PROVIDER_ALIASES: Array<{ match: string; key: string; label: string }> = [
	{ match: 'google.com', key: 'google.com', label: 'Google' },
	{ match: 'linkedin.com', key: 'linkedin.com', label: 'LinkedIn' },
	{ match: 'linkedinmail.com', key: 'linkedin.com', label: 'LinkedIn' },
	{ match: 'cursor.com', key: 'cursor.com', label: 'Cursor' },
	{ match: 'cursor.sh', key: 'cursor.com', label: 'Cursor' },
	{ match: 'pinterest.com', key: 'pinterest.com', label: 'Pinterest' },
	{ match: 'pinterestmail.com', key: 'pinterest.com', label: 'Pinterest' },
	{ match: 'facebook.com', key: 'facebook.com', label: 'Facebook' },
	{ match: 'facebookmail.com', key: 'facebook.com', label: 'Facebook' },
	{ match: 'instagram.com', key: 'instagram.com', label: 'Instagram' },
	{ match: 'whatsapp.com', key: 'whatsapp.com', label: 'WhatsApp' },
	{ match: 'vercel.com', key: 'vercel.com', label: 'Vercel' },
	{ match: 'github.com', key: 'github.com', label: 'GitHub' },
	{ match: 'microsoft.com', key: 'microsoft.com', label: 'Microsoft' },
	{ match: 'apple.com', key: 'apple.com', label: 'Apple' },
	{ match: 'stripe.com', key: 'stripe.com', label: 'Stripe' },
	{ match: 'notion.so', key: 'notion.so', label: 'Notion' },
];

export function senderHost(value: unknown) {
	const raw = String(value || '').trim().toLowerCase();
	if (!raw) return '';
	if (raw.includes('@')) return raw.split('@').pop() || '';
	return raw.replace(/^@+/, '');
}

export function registrableDomain(host: string) {
	const parts = String(host || '')
		.replace(/^www\./, '')
		.split('.')
		.filter(Boolean);
	if (parts.length <= 2) return parts.join('.');
	const last2 = parts.slice(-2).join('.');
	if (MULTI_TLD.has(last2)) return parts.slice(-3).join('.');
	return last2;
}

export function senderProvider(value: unknown) {
	const raw = String(value || '').trim().toLowerCase();
	const host = senderHost(value);
	const domain = registrableDomain(host) || host || raw;
	for (const alias of PROVIDER_ALIASES) {
		if (host === alias.match || host.endsWith(`.${alias.match}`) || domain === alias.match) {
			return { key: alias.key, label: alias.label, domain: alias.key, brand: true };
		}
	}
	if (CONSUMER_MAILBOXES.has(domain)) {
		const email = raw.includes('@') ? raw : domain;
		const local = email.includes('@') ? email.split('@')[0] : domain.split('.')[0];
		const label = local ? `${local.charAt(0).toUpperCase()}${local.slice(1)}` : email;
		return { key: email, label, domain, brand: false };
	}
	const base = domain.split('.')[0] || domain;
	const label = base ? `${base.charAt(0).toUpperCase()}${base.slice(1)}` : domain;
	return { key: domain, label, domain, brand: false };
}

export function isSenderExcluded(senderEmail: string, list: string[] = []) {
	const email = String(senderEmail || '').trim().toLowerCase();
	if (!email || !list.length) return false;
	const provider = senderProvider(email);
	return list.some((item) => {
		const needle = String(item || '').trim().toLowerCase();
		if (!needle) return false;
		const blocked = senderProvider(needle);
		if (blocked.brand) return provider.brand && provider.key === blocked.key;
		return provider.key === blocked.key || email === needle;
	});
}

export function addExcludedSender(list: string[] = [], value: string) {
	const added = senderProvider(value).key;
	if (!added) return list;
	const next = new Set<string>();
	for (const item of list) {
		const n = String(item || '').trim().toLowerCase();
		if (!n) continue;
		next.add(senderProvider(n).key);
	}
	next.add(added);
	return [...next];
}

export function removeExcludedSender(list: string[] = [], value: string) {
	const key = senderProvider(value).key;
	return (list || [])
		.map((item) => String(item || '').trim().toLowerCase())
		.filter((item) => item && senderProvider(item).key !== key);
}

export function normalizeWhatsAppChatId(value?: string | null) {
	const raw = String(value || '').trim();
	if (!raw) return '';
	if (raw.includes('@')) return raw;
	let digits = raw.replace(/\D/g, '');
	if (digits.startsWith('00')) digits = digits.slice(2);
	if (digits.length >= 8 && digits.length <= 15) return `${digits}@s.whatsapp.net`;
	return '';
}

export function cairoDateTimeLabel(date?: Date | null) {
	if (!date) return '';
	return date.toLocaleString('ar-EG', {
		timeZone: 'Africa/Cairo',
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	});
}

export function cairoCalendarDay(now = new Date()) {
	return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function startOfZonedDay(timeZone = 'Africa/Cairo', now = new Date()) {
	const day = now.toLocaleDateString('en-CA', { timeZone });
	let t = Date.parse(`${day}T12:00:00.000Z`);
	while (new Date(t - 60 * 1000).toLocaleDateString('en-CA', { timeZone }) === day) {
		t -= 60 * 1000;
	}
	return new Date(t);
}

export function gmailAfterDate(now = new Date()) {
	const [year, month, day] = cairoCalendarDay(now).split('-');
	return `${year}/${Number(month)}/${Number(day)}`;
}

export function gmailAfterUnix(now = new Date()) {
	return Math.floor(startOfZonedDay(undefined, now).getTime() / 1000);
}

export function todaysInboxQuery(now = new Date()) {
	return `in:inbox after:${gmailAfterUnix(now)}`;
}
