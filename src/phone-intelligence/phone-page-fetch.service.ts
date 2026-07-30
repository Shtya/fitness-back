import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PublicMatchSourceType } from './entities/phone-intelligence.entity';
import { PublicSearchHit } from './phone-public-search.service';
import { extractPossibleNameFromText } from './phone-findings';

const BLOCKED_HOST_FRAGMENTS = [
	'truecaller.com',
	'whatsapp.com',
	'wa.me',
	'facebook.com/login',
	'instagram.com/accounts',
	'accounts.google.com',
];

@Injectable()
export class PhonePageFetchService {
	private readonly logger = new Logger(PhonePageFetchService.name);

	/**
	 * Fetch publicly reachable pages (no login). Extract title/snippet/possible names
	 * when the phone number appears in the HTML.
	 */
	async enrichHits(
		hits: PublicSearchHit[],
		phoneDigits: string[],
		limit = 6,
	): Promise<PublicSearchHit[]> {
		const candidates = hits
			.filter(h => h.provider !== 'manual_directory')
			.filter(h => this.isAllowedUrl(h.sourceUrl))
			.slice(0, limit);

		const enriched: PublicSearchHit[] = [];
		for (const hit of candidates) {
			try {
				const page = await this.fetchPage(hit.sourceUrl, phoneDigits);
				if (!page) {
					enriched.push(hit);
					continue;
				}
				enriched.push({
					...hit,
					title: page.title || hit.title,
					snippet: page.snippet || hit.snippet,
					possibleName: page.possibleName || hit.possibleName,
					confidenceScore: Math.min(
						0.92,
						(hit.confidenceScore || 0.3) + (page.phoneMentioned ? 0.12 : 0),
					),
					sourceType: hit.sourceType || PublicMatchSourceType.OTHER,
					provider: `${hit.provider}+page_fetch`,
				});
			} catch (error: any) {
				this.logger.warn(`Page fetch failed for ${hit.sourceUrl}: ${error?.message || error}`);
				enriched.push(hit);
			}
		}

		// Keep non-fetched hits too
		const fetchedUrls = new Set(enriched.map(e => e.sourceUrl));
		for (const hit of hits) {
			if (!fetchedUrls.has(hit.sourceUrl)) enriched.push(hit);
		}
		return enriched;
	}

	private isAllowedUrl(url: string): boolean {
		try {
			const u = new URL(url);
			if (!['http:', 'https:'].includes(u.protocol)) return false;
			const hostPath = `${u.hostname}${u.pathname}`.toLowerCase();
			if (BLOCKED_HOST_FRAGMENTS.some(b => hostPath.includes(b))) return false;
			if (u.hostname.includes('google.') && u.pathname.includes('/search')) return false;
			if (u.hostname.includes('bing.com') && u.pathname.includes('/search')) return false;
			if (u.hostname.includes('duckduckgo.com')) return false;
			return true;
		} catch {
			return false;
		}
	}

	private async fetchPage(url: string, phoneDigits: string[]) {
		const { data, status } = await axios.get(url, {
			timeout: 12000,
			maxRedirects: 3,
			responseType: 'text',
			headers: {
				'User-Agent':
					'Mozilla/5.0 (compatible; So7baFitPhoneCheck/1.0; +https://so7bafit.local)',
				Accept: 'text/html,application/xhtml+xml',
			},
			validateStatus: s => s >= 200 && s < 400,
		});
		if (status >= 400 || typeof data !== 'string') return null;

		const html = data.slice(0, 400_000);
		const text = this.stripTags(html);
		const phoneMentioned = phoneDigits.some(d => d && text.replace(/\D/g, '').includes(d));
		if (!phoneMentioned && !html.toLowerCase().includes('tel:')) {
			// Still return light metadata if page loaded
		}

		const title =
			this.matchMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
			this.matchMeta(html, /property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
			null;
		const description =
			this.matchMeta(html, /name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
			this.matchMeta(html, /property=["']og:description["'][^>]*content=["']([^"']+)["']/i) ||
			null;

		const snippet = description || this.nearbySnippet(text, phoneDigits) || null;
		const possibleName = this.guessName(title, snippet);

		return {
			title: title ? this.decodeEntities(title).slice(0, 500) : null,
			snippet: snippet ? this.decodeEntities(snippet).slice(0, 800) : null,
			possibleName,
			phoneMentioned,
		};
	}

	private nearbySnippet(text: string, phoneDigits: string[]): string | null {
		const compact = text.replace(/\s+/g, ' ');
		for (const d of phoneDigits) {
			if (!d || d.length < 8) continue;
			const idx = compact.replace(/\D/g, '').indexOf(d);
			if (idx < 0) continue;
			// Approximate position in original compact text
			const pos = compact.indexOf(d.slice(0, 4));
			if (pos < 0) continue;
			const start = Math.max(0, pos - 80);
			return compact.slice(start, start + 220);
		}
		return compact.slice(0, 180) || null;
	}

	private guessName(title: string | null, snippet: string | null): string | null {
		return extractPossibleNameFromText(title, snippet);
	}

	private matchMeta(html: string, re: RegExp): string | null {
		const m = re.exec(html);
		return m?.[1]?.trim() || null;
	}

	private stripTags(html: string): string {
		return html
			.replace(/<script[\s\S]*?<\/script>/gi, ' ')
			.replace(/<style[\s\S]*?<\/style>/gi, ' ')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private decodeEntities(value: string): string {
		return value
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&nbsp;/g, ' ');
	}
}
