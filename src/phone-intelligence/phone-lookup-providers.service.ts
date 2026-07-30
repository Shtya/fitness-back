import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
	guessCarrierFromNumber,
	mapLineType,
	NormalizedPhone,
} from './phone-normalize';
import { PhoneCredentialsService } from './phone-credentials.service';

export interface LookupProviderResult {
	provider: string;
	valid?: boolean;
	carrier?: string | null;
	lineType?: string | null;
	country?: string | null;
	countryCode?: string | null;
	riskScore?: number | null;
	riskLevel?: string | null;
	/** Never treat as confirmed owner — US CNAM / business caller ID only */
	possibleCallerName?: string | null;
	callerNameSource?: string | null;
	raw?: Record<string, unknown>;
	configured: boolean;
	error?: string;
}

@Injectable()
export class PhoneLookupProvidersService {
	private readonly logger = new Logger(PhoneLookupProvidersService.name);

	constructor(private readonly credentials: PhoneCredentialsService) {}

	async status() {
		const list = await this.credentials.listStatus();
		const byId = Object.fromEntries(
			(list.providers || []).map((p: any) => [p.provider, Boolean(p.configured)]),
		);
		return {
			twilio: Boolean(byId.twilio),
			abstract: Boolean(byId.abstract),
			numverify: Boolean(byId.numverify),
			serpapi: Boolean(byId.serpapi),
			googleCse: Boolean(byId.google_cse),
			localCarrierGuess: true,
			ddgSearchEnabled: list.ddgSearchEnabled,
			note:
				'Caller name / CNAM is limited (mainly US). Personal address, private social accounts, and leaked data are intentionally not supported.',
		};
	}

	async lookup(phone: NormalizedPhone): Promise<LookupProviderResult[]> {
		const results: LookupProviderResult[] = [];

		const local: LookupProviderResult = {
			provider: 'local',
			configured: true,
			valid: phone.valid,
			country: phone.countryName,
			countryCode: phone.countryCode,
			lineType: mapLineType(phone.type),
			carrier: guessCarrierFromNumber(phone.e164, phone.countryCode),
			raw: {
				international: phone.international,
				national: phone.national,
				possible: phone.possible,
			},
		};
		results.push(local);

		const [twilio, abstract, numverify] = await Promise.all([
			this.twilioLookup(phone.e164),
			this.abstractLookup(phone.e164),
			this.numverifyLookup(phone.e164),
		]);

		if (twilio) results.push(twilio);
		if (abstract) results.push(abstract);
		if (numverify) results.push(numverify);

		return results;
	}

	merge(results: LookupProviderResult[]): LookupProviderResult {
		const preferred = [...results].reverse().find(r => r.configured && !r.error) || results[0];
		const merged: LookupProviderResult = {
			provider: preferred?.provider || 'local',
			configured: true,
			valid: preferred?.valid,
			carrier: null,
			lineType: null,
			country: null,
			countryCode: null,
			riskScore: null,
			riskLevel: null,
			possibleCallerName: null,
			callerNameSource: null,
			raw: {},
		};

		for (const r of results) {
			if (!r || r.error) continue;
			if (r.valid !== undefined) merged.valid = r.valid;
			if (r.carrier) merged.carrier = r.carrier;
			if (r.lineType) merged.lineType = r.lineType;
			if (r.country) merged.country = r.country;
			if (r.countryCode) merged.countryCode = r.countryCode;
			if (r.riskScore != null) merged.riskScore = r.riskScore;
			if (r.riskLevel) merged.riskLevel = r.riskLevel;
			if (r.possibleCallerName) {
				merged.possibleCallerName = r.possibleCallerName;
				merged.callerNameSource = r.callerNameSource || r.provider;
			}
			merged.raw = { ...(merged.raw || {}), [r.provider]: r.raw || r };
			if (r.provider !== 'local') merged.provider = r.provider;
		}

		if (merged.riskScore == null) {
			merged.riskScore = this.estimateRisk(merged);
		}
		merged.riskLevel = this.scoreToLevel(merged.riskScore);

		return merged;
	}

	private estimateRisk(data: LookupProviderResult): number {
		let score = 15;
		if (data.valid === false) score += 40;
		if (data.lineType === 'voip') score += 25;
		if (data.lineType === 'toll_free') score += 10;
		if (!data.carrier) score += 10;
		return Math.min(100, Math.max(0, score));
	}

	private scoreToLevel(score: number | null | undefined): string {
		const s = score ?? 0;
		if (s >= 70) return 'high';
		if (s >= 40) return 'medium';
		return 'low';
	}

	private async twilioLookup(e164: string): Promise<LookupProviderResult | null> {
		const creds = await this.credentials.resolve('twilio');
		if (!creds?.accountSid || !creds?.authToken) {
			return { provider: 'twilio', configured: false };
		}

		try {
			const fields = ['line_type_intelligence', 'caller_name'];
			const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}`;
			const { data } = await axios.get(url, {
				auth: { username: creds.accountSid, password: creds.authToken },
				params: { Fields: fields.join(',') },
				timeout: 15000,
			});

			const line = data.line_type_intelligence || {};
			const caller = data.caller_name || {};

			return {
				provider: 'twilio',
				configured: true,
				valid: data.valid !== false,
				carrier: line.carrier_name || null,
				lineType: (line.type || '').toLowerCase() || null,
				countryCode: data.country_code || null,
				possibleCallerName: caller.caller_name || null,
				callerNameSource: caller.caller_name ? 'twilio_cnam' : null,
				raw: data,
			};
		} catch (error: any) {
			this.logger.warn(`Twilio lookup failed: ${error?.message || error}`);
			return {
				provider: 'twilio',
				configured: true,
				error: error?.response?.data?.message || error?.message || 'Twilio lookup failed',
			};
		}
	}

	private async abstractLookup(e164: string): Promise<LookupProviderResult | null> {
		const creds = await this.credentials.resolve('abstract');
		if (!creds?.apiKey) return { provider: 'abstract', configured: false };

		try {
			const { data } = await axios.get('https://phonevalidation.abstractapi.com/v1/', {
				params: { api_key: creds.apiKey, phone: e164 },
				timeout: 15000,
			});

			return {
				provider: 'abstract',
				configured: true,
				valid: Boolean(data.valid),
				carrier: data.carrier || null,
				lineType: (data.type || '').toLowerCase() || null,
				country: data.country?.name || null,
				countryCode: data.country?.code || null,
				raw: data,
			};
		} catch (error: any) {
			this.logger.warn(`Abstract lookup failed: ${error?.message || error}`);
			return {
				provider: 'abstract',
				configured: true,
				error: error?.message || 'Abstract lookup failed',
			};
		}
	}

	private async numverifyLookup(e164: string): Promise<LookupProviderResult | null> {
		const creds = await this.credentials.resolve('numverify');
		if (!creds?.apiKey) return { provider: 'numverify', configured: false };

		try {
			const number = e164.replace(/^\+/, '');
			const { data } = await axios.get('http://apilayer.net/api/validate', {
				params: { access_key: creds.apiKey, number, format: 1 },
				timeout: 15000,
			});

			return {
				provider: 'numverify',
				configured: true,
				valid: Boolean(data.valid),
				carrier: data.carrier || null,
				lineType: (data.line_type || '').toLowerCase() || null,
				country: data.country_name || null,
				countryCode: data.country_code || null,
				raw: data,
			};
		} catch (error: any) {
			this.logger.warn(`Numverify lookup failed: ${error?.message || error}`);
			return {
				provider: 'numverify',
				configured: true,
				error: error?.message || 'Numverify lookup failed',
			};
		}
	}
}
