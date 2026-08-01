import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { FITNESS_CONTACT_PATHS, FITNESS_SKIP_DOMAINS } from './fitness-leads.config';
import { FitnessEmailProvidersService } from './fitness-email-providers.service';
import {
	extractEmailsFromHtml,
	extractSocialLinks,
	extractWhatsAppFromPhone,
	filterValidBusinessEmails,
	getBestEmail,
} from './fitness-leads.utils';

const EMPTY_SOCIAL = {
	instagram: '',
	linkedin: '',
	facebook: '',
	twitter: '',
	tiktok: '',
	youtube: '',
	whatsapp: '',
};

/** Hard ceiling so one bad site cannot stall the whole job. */
const ENRICH_BUDGET_MS = 8_000;
const PAGE_TIMEOUT_MS = 4_000;
const MAX_PAGES = 2;

@Injectable()
export class FitnessWebsiteEnrichService {
	private readonly logger = new Logger(FitnessWebsiteEnrichService.name);

	constructor(private readonly emailProviders: FitnessEmailProvidersService) {}

	async enrichFromWebsite(websiteUrl: string, phone?: string | null) {
		const empty = {
			emails: [] as string[],
			sourceUrl: null as string | null,
			social: { ...EMPTY_SOCIAL },
			verification: null as string | null,
			emailSource: null as string | null,
		};

		try {
			if (!websiteUrl || !this.isScrapable(websiteUrl)) return empty;

			return await this.withTimeout(
				this.enrichFromWebsiteInner(websiteUrl, phone, empty),
				ENRICH_BUDGET_MS,
				empty,
				`enrich ${websiteUrl}`,
			);
		} catch (error: any) {
			this.logger.warn(`enrichFromWebsite failed for ${websiteUrl}: ${error?.message || error}`);
			return empty;
		}
	}

	private async enrichFromWebsiteInner(
		websiteUrl: string,
		phone: string | null | undefined,
		empty: {
			emails: string[];
			sourceUrl: string | null;
			social: typeof EMPTY_SOCIAL;
			verification: string | null;
			emailSource: string | null;
		},
	) {
		let allEmails: string[] = [];
		let sourceUrl: string | null = null;
		let social = { ...EMPTY_SOCIAL };

		const pages = await this.discoverPages(websiteUrl);
		for (const pageUrl of pages) {
			try {
				const html = await this.fetchHtml(pageUrl);
				if (!html) continue;
				const emails = filterValidBusinessEmails(extractEmailsFromHtml(html));
				if (emails.length && !sourceUrl) sourceUrl = pageUrl;
				allEmails.push(...emails);
				const pageSocial = extractSocialLinks(html);
				social = {
					instagram: social.instagram || pageSocial.instagram,
					linkedin: social.linkedin || pageSocial.linkedin,
					facebook: social.facebook || pageSocial.facebook,
					twitter: social.twitter || pageSocial.twitter,
					tiktok: social.tiktok || pageSocial.tiktok,
					youtube: social.youtube || pageSocial.youtube,
					whatsapp: social.whatsapp || pageSocial.whatsapp,
				};
				// Homepage already gave us emails — skip extra contact pages.
				if (allEmails.length) break;
			} catch (error: any) {
				this.logger.warn(`Fetch ${pageUrl} failed: ${error?.message || error}`);
			}
		}

		allEmails = filterValidBusinessEmails(allEmails);
		let emailSource: string | null = sourceUrl ? 'Website' : null;
		let verification: string | null = null;

		// Only hit paid/slow providers when the site yielded nothing.
		if (!allEmails.length) {
			try {
				const fromProviders = await this.withTimeout(
					this.emailProviders.findEmailsFromProviders(websiteUrl),
					5_000,
					{ emails: [] as string[], verification: null, source: null, linkedin: '' },
					`providers ${websiteUrl}`,
				);
				allEmails = fromProviders.emails || [];
				emailSource = fromProviders.source;
				if (fromProviders.linkedin && !social.linkedin) social.linkedin = fromProviders.linkedin;
			} catch (error: any) {
				this.logger.warn(`Email providers failed for ${websiteUrl}: ${error?.message || error}`);
			}
		}

		if (!social.whatsapp && phone) social.whatsapp = extractWhatsAppFromPhone(phone);

		return {
			emails: allEmails,
			sourceUrl,
			social,
			verification,
			emailSource,
		};
	}

	private async withTimeout<T>(
		promise: Promise<T>,
		ms: number,
		fallback: T,
		label: string,
	): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | null = null;
		try {
			return await Promise.race([
				promise,
				new Promise<T>(resolve => {
					timer = setTimeout(() => {
						this.logger.warn(`Timeout ${ms}ms: ${label}`);
						resolve(fallback);
					}, ms);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private isScrapable(websiteUrl: string) {
		try {
			const host = new URL(
				websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`,
			).hostname.replace(/^www\./, '');
			return !FITNESS_SKIP_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
		} catch {
			return false;
		}
	}

	private async discoverPages(websiteUrl: string) {
		const pages: string[] = [];
		try {
			const normalized = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
			pages.push(normalized);
			const origin = new URL(normalized).origin;
			// Prefer one contact page only (was up to 5 — too slow).
			const contact = FITNESS_CONTACT_PATHS.find(Boolean);
			if (contact) pages.push(`${origin}/${contact}`);
		} catch {
			if (websiteUrl) pages.push(websiteUrl);
		}
		return [...new Set(pages)].slice(0, MAX_PAGES);
	}

	private async fetchHtml(url: string) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
		try {
			const { data, status } = await axios.get(url, {
				timeout: PAGE_TIMEOUT_MS,
				signal: controller.signal,
				maxRedirects: 2,
				maxContentLength: 400_000,
				responseType: 'text',
				headers: {
					'User-Agent':
						'Mozilla/5.0 (compatible; So7baFitFitnessLeads/1.0; +https://so7bafit.local)',
					Accept: 'text/html,application/xhtml+xml',
				},
				validateStatus: s => s >= 200 && s < 400,
			});
			if (status >= 400 || typeof data !== 'string') return null;
			return data.slice(0, 200_000);
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
	}
}
