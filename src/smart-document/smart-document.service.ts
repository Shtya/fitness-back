import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { SmartSharedDocument } from 'entities/smart-document.entity';

function makeToken() {
	return randomBytes(12).toString('base64url');
}

const VISIT_TZ = 'Africa/Cairo';

function formatVisitStamp(date = new Date()) {
	try {
		const day = date.toLocaleDateString('en-GB', {
			timeZone: VISIT_TZ,
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
		const time = date.toLocaleTimeString('en-GB', {
			timeZone: VISIT_TZ,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
		});
		return `${day} · ${time} (Cairo)`;
	} catch {
		return date.toISOString();
	}
}

function clientIp(req: any): string {
	const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
		.split(',')[0]
		.trim();
	const raw =
		forwarded ||
		String(req?.headers?.['x-real-ip'] || '').trim() ||
		String(req?.headers?.['cf-connecting-ip'] || '').trim() ||
		String(req?.ip || req?.socket?.remoteAddress || '').trim();
	return raw.replace(/^::ffff:/, '') || 'unknown';
}

function parseBrowser(uaRaw: string, browserHint?: string) {
	const hint = String(browserHint || '').trim();
	const ua = String(uaRaw || '');
	let browser = 'Unknown browser';
	if (hint && !/^not.?a.?brand$/i.test(hint)) {
		browser = hint.replace(/^Google\s+/i, '').slice(0, 40);
	} else if (/Edg\//i.test(ua)) browser = 'Edge';
	else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
	else if (/Brave/i.test(ua)) browser = 'Brave';
	else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
	else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
	else if (/Firefox\//i.test(ua)) browser = 'Firefox';

	let os = 'Unknown OS';
	if (/Windows NT/i.test(ua)) os = 'Windows';
	else if (/Android/i.test(ua)) os = 'Android';
	else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
	else if (/Mac OS X/i.test(ua)) os = 'macOS';
	else if (/Linux/i.test(ua)) os = 'Linux';

	let device = 'Desktop';
	if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) device = 'Tablet';
	else if (/Mobi|iPhone|Android.*Mobile/i.test(ua)) device = 'Mobile';

	return { browser, os, device };
}

function isPrivateIp(ip: string) {
	const value = String(ip || '').trim().toLowerCase();
	if (!value || value === 'unknown' || value === '::1' || value === '127.0.0.1' || value === 'localhost') {
		return true;
	}
	if (value.startsWith('10.') || value.startsWith('192.168.') || value.startsWith('fc') || value.startsWith('fd')) {
		return true;
	}
	const m = value.match(/^172\.(\d+)\./);
	if (m) {
		const second = Number(m[1]);
		if (second >= 16 && second <= 31) return true;
	}
	return false;
}

async function lookupGeo(ip: string) {
	if (isPrivateIp(ip)) {
		return {
			city: null,
			region: null,
			country: null,
			countryCode: null,
			label: 'Local network (this machine / LAN)',
			isp: null,
		};
	}
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 2500);
		const res = await fetch(
			`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,isp,query`,
			{ signal: controller.signal },
		);
		clearTimeout(timer);
		if (!res.ok) return { city: null, region: null, country: null, countryCode: null, label: null, isp: null };
		const data: any = await res.json();
		if (data?.status !== 'success') {
			return { city: null, region: null, country: null, countryCode: null, label: null, isp: null };
		}
		const parts = [data.city, data.regionName, data.country].filter(Boolean);
		return {
			city: data.city || null,
			region: data.regionName || null,
			country: data.country || null,
			countryCode: data.countryCode || null,
			label: parts.join(', ') || null,
			isp: data.isp || null,
		};
	} catch {
		return { city: null, region: null, country: null, countryCode: null, label: null, isp: null };
	}
}

function normalizeVisit(raw: Record<string, unknown>) {
	const visit = raw && typeof raw === 'object' ? { ...raw } : {};
	const atRaw = typeof visit.at === 'string' ? visit.at : null;
	const atDate = atRaw ? new Date(atRaw) : null;
	const stamp =
		(typeof visit.stamp === 'string' && visit.stamp && !/T\d{2}:\d{2}/.test(visit.stamp)
			? visit.stamp
			: null) ||
		(atDate && !Number.isNaN(atDate.getTime()) ? formatVisitStamp(atDate) : null) ||
		atRaw ||
		'—';

	const ip = String(visit.ip || 'unknown');
	let location = typeof visit.location === 'string' ? visit.location : null;
	if (!location && isPrivateIp(ip)) {
		location = 'Local network (this machine / LAN)';
	}

	const ua = String(visit.userAgent || '');
	let browser = typeof visit.browser === 'string' ? visit.browser : '';
	let os = typeof visit.os === 'string' ? visit.os : '';
	let device = typeof visit.device === 'string' ? visit.device : '';
	if ((!browser || !os || !device) && ua) {
		const parsed = parseBrowser(ua, typeof visit.browserHint === 'string' ? visit.browserHint : '');
		browser = browser || parsed.browser;
		os = os || parsed.os;
		device = device || parsed.device;
	}

	return {
		...visit,
		at: atRaw,
		stamp,
		ip,
		location: location || null,
		browser: browser || null,
		os: os || null,
		device: device || null,
		language: visit.language || null,
		platform: visit.platform || null,
		timezone: visit.timezone || null,
		screen: visit.screen || null,
		isp: visit.isp || null,
	};
}

@Injectable()
export class SmartDocumentService {
	constructor(
		@InjectRepository(SmartSharedDocument)
		private readonly repo: Repository<SmartSharedDocument>,
	) {}

	async upsertShare(
		userId: string,
		body: {
			localDocId?: string | null;
			title?: string;
			content?: string;
			typography?: Record<string, unknown> | null;
			token?: string | null;
		},
	) {
		const localDocId = body.localDocId ? String(body.localDocId).slice(0, 80) : null;
		const title = String(body.title || 'Untitled').trim().slice(0, 200) || 'Untitled';
		const content = String(body.content ?? '');
		const typography = body.typography && typeof body.typography === 'object' ? body.typography : null;

		let row: SmartSharedDocument | null = null;
		const requestedToken = String(body.token || '').trim();
		if (requestedToken) {
			row = await this.repo.findOne({ where: { token: requestedToken, ownerUserId: userId } });
		}
		if (!row && localDocId) {
			row = await this.repo.findOne({
				where: { localDocId, ownerUserId: userId },
				order: { updated_at: 'DESC' },
			});
		}

		if (!row) {
			row = this.repo.create({
				token: makeToken(),
				localDocId,
				ownerUserId: userId,
				title,
				content,
				typography,
				visits: [],
			});
		} else {
			row.localDocId = localDocId || row.localDocId;
			row.title = title;
			row.content = content;
			row.typography = typography;
		}

		const saved = await this.repo.save(row);
		return {
			token: saved.token,
			title: saved.title,
			updatedAt: saved.updated_at,
			path: `/d/${saved.token}`,
			visitCount: Array.isArray(saved.visits) ? saved.visits.length : 0,
		};
	}

	async getPublic(token: string) {
		const row = await this.repo.findOne({ where: { token: String(token || '').trim() } });
		if (!row) throw new NotFoundException('Shared document not found');
		return {
			token: row.token,
			title: row.title,
			content: row.content,
			typography: row.typography,
			updatedAt: row.updated_at,
		};
	}

	async updatePublic(
		token: string,
		body: { content?: string; title?: string; typography?: Record<string, unknown> | null },
	) {
		const row = await this.repo.findOne({ where: { token: String(token || '').trim() } });
		if (!row) throw new NotFoundException('Shared document not found');
		if (body.content != null) row.content = String(body.content);
		if (body.title != null) {
			const next = String(body.title).trim().slice(0, 200);
			if (next) row.title = next;
		}
		if (body.typography !== undefined) {
			row.typography =
				body.typography && typeof body.typography === 'object' ? body.typography : null;
		}
		const saved = await this.repo.save(row);
		return {
			token: saved.token,
			title: saved.title,
			content: saved.content,
			typography: saved.typography,
			updatedAt: saved.updated_at,
		};
	}

	async listVisitsForOwner(userId: string, token: string) {
		const row = await this.repo.findOne({ where: { token: String(token || '').trim() } });
		if (!row) throw new NotFoundException('Shared document not found');
		if (String(row.ownerUserId || '') !== String(userId)) {
			throw new ForbiddenException('Not allowed');
		}
		const visits = Array.isArray(row.visits)
			? [...row.visits].reverse().map((v) => normalizeVisit((v || {}) as Record<string, unknown>))
			: [];
		return {
			token: row.token,
			title: row.title,
			visitCount: visits.length,
			visits,
		};
	}

	/** Record every open with IP / geo / browser metadata (no name gate). */
	async recordVisit(
		token: string,
		req: any,
		body: {
			language?: string;
			platform?: string;
			timezone?: string;
			screen?: string;
			userAgent?: string;
			browserHint?: string;
		} = {},
	) {
		const row = await this.repo.findOne({ where: { token: String(token || '').trim() } });
		if (!row) throw new NotFoundException('Shared document not found');

		const at = new Date();
		const ip = clientIp(req);
		const userAgent = String(body.userAgent || req?.headers?.['user-agent'] || '').slice(0, 500);
		const browserHint = String(body.browserHint || '').slice(0, 60);
		const { browser, os, device } = parseBrowser(userAgent, browserHint);
		const geo = await lookupGeo(ip);
		const language = String(body.language || '').slice(0, 40) || null;
		const platform = String(body.platform || '').slice(0, 80) || null;
		const timezone = String(body.timezone || '').slice(0, 80) || null;
		const screen = String(body.screen || '').slice(0, 40) || null;

		const entry = {
			at: at.toISOString(),
			stamp: formatVisitStamp(at),
			ip,
			location: geo.label,
			city: geo.city,
			region: geo.region,
			country: geo.country,
			countryCode: geo.countryCode,
			isp: geo.isp,
			browser,
			os,
			device,
			browserHint: browserHint || null,
			language,
			platform,
			timezone,
			screen,
			userAgent,
		};

		const prev = Array.isArray(row.visits) ? row.visits : [];
		row.visits = [...prev, entry].slice(-300);
		const saved = await this.repo.save(row);

		return {
			ok: true,
			visit: normalizeVisit(entry as Record<string, unknown>),
			visitCount: Array.isArray(saved.visits) ? saved.visits.length : 0,
		};
	}
}
