import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { FitnessLeadsCredentialsService } from './fitness-leads-credentials.service';
import { filterValidBusinessEmails, getBestEmail } from './fitness-leads.utils';

@Injectable()
export class FitnessEmailProvidersService {
	private readonly logger = new Logger(FitnessEmailProvidersService.name);

	constructor(private readonly credentials: FitnessLeadsCredentialsService) {}

	async findEmailsFromProviders(websiteUrl: string) {
		const domain = this.getDomain(websiteUrl);
		if (!domain) return { emails: [], verification: null, source: null, linkedin: '' };

		const hunter = await this.hunterDomainSearch(domain);
		if (hunter.emails.length) return hunter;

		const apollo = await this.apolloDomainSearch(domain);
		if (apollo.emails.length) return apollo;

		const clearbit = await this.clearbitDomainSearch(domain);
		return clearbit;
	}

	async hunterVerifyEmail(email: string) {
		const apiKey = await this.credentials.resolveApiKey('hunter');
		if (!apiKey || !email) return null;
		try {
			const { data } = await axios.get('https://api.hunter.io/v2/email-verifier', {
				params: { email, api_key: apiKey },
				timeout: 15000,
			});
			return data.data?.status || null;
		} catch {
			return null;
		}
	}

	private getDomain(url: string) {
		try {
			const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
			return host.replace(/^www\./, '');
		} catch {
			return null;
		}
	}

	private async hunterDomainSearch(domain: string) {
		const apiKey = await this.credentials.resolveApiKey('hunter');
		if (!apiKey) return { emails: [], verification: null, source: null, linkedin: '' };
		try {
			const { data } = await axios.get('https://api.hunter.io/v2/domain-search', {
				params: { domain, api_key: apiKey, limit: 10 },
				timeout: 15000,
			});
			const emails = (data.data?.emails || [])
				.map((e: any) => e.value)
				.filter(Boolean);
			const values = filterValidBusinessEmails(emails);
			return {
				emails: values,
				verification: null,
				source: values.length ? 'Hunter.io' : null,
				linkedin: '',
			};
		} catch (error: any) {
			this.logger.warn(`Hunter failed: ${error?.message || error}`);
			return { emails: [], verification: null, source: null, linkedin: '' };
		}
	}

	private async apolloDomainSearch(domain: string) {
		const apiKey = await this.credentials.resolveApiKey('apollo');
		if (!apiKey) return { emails: [], verification: null, source: null, linkedin: '' };
		try {
			const { data } = await axios.get(
				`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`,
				{
					headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
					timeout: 15000,
				},
			);
			const org = data.organization || {};
			const values = filterValidBusinessEmails(
				[org.primary_email, org.email].filter(Boolean),
			);
			return {
				emails: values,
				verification: null,
				source: values.length ? 'Apollo.io' : null,
				linkedin: org.linkedin_url || '',
			};
		} catch (error: any) {
			this.logger.warn(`Apollo failed: ${error?.message || error}`);
			return { emails: [], verification: null, source: null, linkedin: '' };
		}
	}

	private async clearbitDomainSearch(domain: string) {
		const apiKey = await this.credentials.resolveApiKey('clearbit');
		if (!apiKey) return { emails: [], verification: null, source: null, linkedin: '' };
		try {
			const { data } = await axios.get(
				`https://company.clearbit.com/v2/companies/find?domain=${encodeURIComponent(domain)}`,
				{
					headers: { Authorization: `Bearer ${apiKey}` },
					timeout: 15000,
				},
			);
			const values = filterValidBusinessEmails(
				[data.email, data.site?.email].filter(Boolean),
			);
			return {
				emails: values,
				verification: null,
				source: values.length ? 'Clearbit' : null,
				linkedin: data.linkedin?.handle
					? `https://linkedin.com/company/${data.linkedin.handle}`
					: '',
			};
		} catch (error: any) {
			this.logger.warn(`Clearbit failed: ${error?.message || error}`);
			return { emails: [], verification: null, source: null, linkedin: '' };
		}
	}
}
