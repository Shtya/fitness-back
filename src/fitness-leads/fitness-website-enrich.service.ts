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

@Injectable()
export class FitnessWebsiteEnrichService {
	private readonly logger = new Logger(FitnessWebsiteEnrichService.name);

	constructor(private readonly emailProviders: FitnessEmailProvidersService) {}

	async enrichFromWebsite(websiteUrl: string, phone?: string | null) {
		const emptySocial = {
			instagram: '',
			linkedin: '',
			facebook: '',
			twitter: '',
			tiktok: '',
			youtube: '',
			whatsapp: '',
		};
		const empty = {
			emails: [] as string[],
			sourceUrl: null as string | null,
			social: { ...emptySocial },
			verification: null as string | null,
			emailSource: null as string | null,
		};

		if (!websiteUrl || !this.isScrapable(websiteUrl)) return empty;

		let allEmails: string[] = [];
		let sourceUrl: string | null = null;
		let social = { ...emptySocial };

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
			} catch (error: any) {
				this.logger.warn(`Fetch ${pageUrl} failed: ${error?.message || error}`);
			}
		}

		allEmails = filterValidBusinessEmails(allEmails);
		let emailSource: string | null = sourceUrl ? 'Website' : null;
		let verification: string | null = null;

		if (!allEmails.length) {
			const fromProviders = await this.emailProviders.findEmailsFromProviders(websiteUrl);
			allEmails = fromProviders.emails;
			emailSource = fromProviders.source;
			if (fromProviders.linkedin && !social.linkedin) social.linkedin = fromProviders.linkedin;
		}

		const best = getBestEmail(allEmails);
		if (best && emailSource === 'Hunter.io') {
			verification = await this.emailProviders.hunterVerifyEmail(best);
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
		const pages = new Set<string>([websiteUrl]);
		try {
			const origin = new URL(
				websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`,
			).origin;
			for (const p of FITNESS_CONTACT_PATHS.slice(0, 5)) {
				pages.add(`${origin}/${p}`);
			}
		} catch {
			/* ignore */
		}
		return [...pages].slice(0, 6);
	}

	private async fetchHtml(url: string) {
		const { data, status } = await axios.get(url, {
			timeout: 10000,
			maxRedirects: 3,
			responseType: 'text',
			headers: {
				'User-Agent':
					'Mozilla/5.0 (compatible; So7baFitFitnessLeads/1.0; +https://so7bafit.local)',
				Accept: 'text/html,application/xhtml+xml',
			},
			validateStatus: s => s >= 200 && s < 400,
		});
		if (status >= 400 || typeof data !== 'string') return null;
		return data.slice(0, 350_000);
	}
}
