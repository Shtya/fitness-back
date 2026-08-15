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
		`http://localhost:${process.env.PORT || 3030}`;
	return String(raw).replace(/\/$/, '').replace(/\/api\/v1$/i, '');
}

export function gmailRedirectUri() {
	return (
		process.env.GOOGLE_REDIRECT_URI?.trim() ||
		`${publicApiOrigin()}/api/v1/email-memo/gmail/callback`
	);
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
	const bodyText = (bodies.text.trim() || htmlToCleanText(bodies.html) || String(raw?.snippet || '')).slice(
		0,
		20000,
	);
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
