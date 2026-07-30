import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PhoneSearchSite } from './entities/phone-intelligence.entity';
import { NormalizedPhone, phoneSearchFormats } from './phone-normalize';

export type SearchSiteInput = {
	name: string;
	urlTemplate: string;
	domain?: string | null;
	mode?: 'engine' | 'url' | 'manual';
	enabled?: boolean;
	needsLogin?: boolean;
	notes?: string | null;
	sortOrder?: number;
};

/** Free / public reverse-phone oriented sources (no private login automation). */
const DEFAULT_SITES: SearchSiteInput[] = [
	{
		name: 'Google name hunt',
		urlTemplate:
			'https://www.google.com/search?q={quotedLocal}+(name+OR+%D8%A7%D8%B3%D9%85+OR+caller+OR+%D8%B5%D8%A7%D8%AD%D8%A8)',
		domain: null,
		mode: 'engine',
		enabled: true,
		needsLogin: false,
		notes: 'Best free shot at a public name for EG/MENA numbers.',
		sortOrder: 5,
	},
	{
		name: 'Google (local format)',
		urlTemplate: 'https://www.google.com/search?q={quotedLocal}',
		domain: null,
		mode: 'engine',
		enabled: true,
		needsLogin: false,
		sortOrder: 10,
	},
	{
		name: 'tellows (EG/community)',
		urlTemplate: 'https://www.tellows.com/num/{e164Digits}',
		domain: 'tellows.com',
		mode: 'url',
		enabled: true,
		needsLogin: false,
		notes: 'Community caller comments / score — often has a public label.',
		sortOrder: 15,
	},
	{
		name: 'tellows Egypt',
		urlTemplate: 'https://eg.tellows.net/num/{e164Digits}',
		domain: 'tellows.net',
		mode: 'url',
		enabled: true,
		needsLogin: false,
		sortOrder: 16,
	},
	{
		name: 'Should I Answer',
		urlTemplate: 'https://www.shouldianswer.com/phone/{e164Digits}',
		domain: 'shouldianswer.com',
		mode: 'url',
		enabled: true,
		needsLogin: false,
		sortOrder: 18,
	},
	{
		name: 'WhoCallsMe',
		urlTemplate: 'https://whocallsme.com/Phone-Number.aspx/{e164Digits}',
		domain: 'whocallsme.com',
		mode: 'url',
		enabled: true,
		needsLogin: false,
		sortOrder: 19,
	},
	{
		name: 'NumLookup',
		urlTemplate: 'https://www.numlookup.com/{e164Digits}',
		domain: 'numlookup.com',
		mode: 'url',
		enabled: true,
		needsLogin: false,
		sortOrder: 20,
	},
	{
		name: 'Instagram (via Google)',
		urlTemplate: 'https://www.google.com/search?q=site%3Ainstagram.com+{quotedLocal}',
		domain: 'instagram.com',
		mode: 'engine',
		enabled: true,
		needsLogin: false,
		sortOrder: 30,
	},
	{
		name: 'Facebook (via Google)',
		urlTemplate: 'https://www.google.com/search?q=site%3Afacebook.com+{quotedLocal}',
		domain: 'facebook.com',
		mode: 'engine',
		enabled: true,
		needsLogin: false,
		sortOrder: 31,
	},
	{
		name: 'CallApp (via Google)',
		urlTemplate: 'https://www.google.com/search?q=site%3Acallapp.com+{quotedLocal}',
		domain: 'callapp.com',
		mode: 'engine',
		enabled: true,
		needsLogin: false,
		notes: 'Public indexed CallApp pages only — no app login.',
		sortOrder: 35,
	},
	{
		name: 'Sync.me (via Google)',
		urlTemplate: 'https://www.google.com/search?q=site%3Async.me+{quotedLocal}',
		domain: 'sync.me',
		mode: 'engine',
		enabled: true,
		needsLogin: false,
		sortOrder: 36,
	},
	{
		name: 'Truecaller (via Google)',
		urlTemplate: 'https://www.google.com/search?q=site%3Atruecaller.com+{quotedLocal}',
		domain: 'truecaller.com',
		mode: 'engine',
		enabled: true,
		needsLogin: false,
		notes: 'Only publicly indexed pages. Direct Truecaller still needs login in browser.',
		sortOrder: 40,
	},
	{
		name: 'GetContact (via Google)',
		urlTemplate: 'https://www.google.com/search?q=site%3Agetcontact.com+{quotedLocal}',
		domain: 'getcontact.com',
		mode: 'engine',
		enabled: true,
		needsLogin: false,
		notes: 'Only publicly indexed pages. App login is not automated.',
		sortOrder: 41,
	},
	{
		name: 'LinkedIn (via Google)',
		urlTemplate: 'https://www.google.com/search?q=site%3Alinkedin.com+{quotedLocal}',
		domain: 'linkedin.com',
		mode: 'engine',
		enabled: true,
		needsLogin: false,
		sortOrder: 50,
	},
	{
		name: 'TruePeopleSearch (US)',
		urlTemplate: 'https://www.truepeoplesearch.com/results.php?phoneno={e164Digits}',
		domain: 'truepeoplesearch.com',
		mode: 'url',
		enabled: true,
		needsLogin: false,
		notes: 'Strong for US numbers; usually empty for Egypt.',
		sortOrder: 80,
	},
	{
		name: 'FastPeopleSearch (US)',
		urlTemplate: 'https://www.fastpeoplesearch.com/{e164Digits}',
		domain: 'fastpeoplesearch.com',
		mode: 'url',
		enabled: true,
		needsLogin: false,
		notes: 'Strong for US numbers; usually empty for Egypt.',
		sortOrder: 81,
	},
];

@Injectable()
export class PhoneSearchSitesService {
	constructor(
		@InjectRepository(PhoneSearchSite)
		private readonly repo: Repository<PhoneSearchSite>,
	) {}

	async ensureDefaults() {
		const count = await this.repo.count();
		if (count === 0) {
			for (const site of DEFAULT_SITES) {
				await this.repo.save(this.toEntity(site, true));
			}
			return;
		}

		// Seed any newly added builtin sites without wiping user customizations
		for (const site of DEFAULT_SITES) {
			const exists = await this.repo.findOne({ where: { name: site.name } });
			if (!exists) {
				await this.repo.save(this.toEntity(site, true));
			}
		}

		// Migrate old login-wall entries toward Google-indexed engine search
		await this.migrateLegacyLoginSites();
	}

	private async migrateLegacyLoginSites() {
		const pairs = [
			{
				old: 'Truecaller',
				neu: 'Truecaller (via Google)',
				domain: 'truecaller.com',
				urlTemplate:
					'https://www.google.com/search?q=site%3Atruecaller.com+{quotedLocal}',
				notes:
					'Only publicly indexed pages. Direct Truecaller still needs login in browser.',
			},
			{
				old: 'GetContact',
				neu: 'GetContact (via Google)',
				domain: 'getcontact.com',
				urlTemplate:
					'https://www.google.com/search?q=site%3Agetcontact.com+{quotedLocal}',
				notes: 'Only publicly indexed pages. App login is not automated.',
			},
		];

		for (const p of pairs) {
			const oldRow = await this.repo.findOne({ where: { name: p.old } });
			if (!oldRow) continue;
			const neu = await this.repo.findOne({ where: { name: p.neu } });
			if (neu) {
				await this.repo.remove(oldRow);
				continue;
			}
			oldRow.name = p.neu;
			oldRow.mode = 'engine';
			oldRow.needsLogin = false;
			oldRow.domain = p.domain;
			oldRow.urlTemplate = p.urlTemplate;
			oldRow.notes = p.notes;
			await this.repo.save(oldRow);
		}
	}

	private toEntity(site: SearchSiteInput, isBuiltin: boolean) {
		return this.repo.create({
			...site,
			domain: site.domain || null,
			notes: site.notes || null,
			isBuiltin,
			mode: site.mode || 'engine',
			enabled: site.enabled !== false,
			needsLogin: Boolean(site.needsLogin),
			sortOrder: site.sortOrder ?? 100,
		});
	}

	async list() {
		await this.ensureDefaults();
		return this.repo.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
	}

	async listEnabled() {
		await this.ensureDefaults();
		return this.repo.find({
			where: { enabled: true },
			order: { sortOrder: 'ASC', createdAt: 'ASC' },
		});
	}

	async create(input: SearchSiteInput) {
		this.validate(input);
		return this.repo.save(this.toEntity(input, false));
	}

	async update(id: string, input: Partial<SearchSiteInput>) {
		const row = await this.repo.findOne({ where: { id } });
		if (!row) throw new NotFoundException('Search site not found');
		if (input.name != null) row.name = input.name.trim();
		if (input.urlTemplate != null) row.urlTemplate = input.urlTemplate.trim();
		if (input.domain !== undefined) row.domain = input.domain?.trim() || null;
		if (input.mode != null) row.mode = input.mode;
		if (input.enabled != null) row.enabled = input.enabled;
		if (input.needsLogin != null) row.needsLogin = input.needsLogin;
		if (input.notes !== undefined) row.notes = input.notes?.trim() || null;
		if (input.sortOrder != null) row.sortOrder = input.sortOrder;
		this.validate(row);
		return this.repo.save(row);
	}

	async remove(id: string) {
		const row = await this.repo.findOne({ where: { id } });
		if (!row) throw new NotFoundException('Search site not found');
		await this.repo.remove(row);
		return { ok: true };
	}

	buildAbsoluteUrl(site: PhoneSearchSite, phone: NormalizedPhone): string {
		const f = phoneSearchFormats(phone);
		const country = (phone.countryCode || 'eg').toLowerCase();
		const map: Record<string, string> = {
			local: f.bestWebQuery,
			e164: f.e164,
			e164Digits: f.e164Digits,
			national: f.nationalDigits || f.bestWebQuery,
			country,
			quotedLocal: `"${f.bestWebQuery}"`,
			quotedE164: `"${f.e164}"`,
		};
		return site.urlTemplate.replace(/\{(\w+)\}/g, (_, key: string) => {
			const val = map[key] ?? '';
			return encodeURIComponent(val);
		});
	}

	private validate(input: { name?: string; urlTemplate?: string; mode?: string }) {
		if (!input.name?.trim()) throw new BadRequestException('Name is required');
		if (!input.urlTemplate?.trim()) throw new BadRequestException('URL template is required');
		if (input.mode && !['engine', 'url', 'manual'].includes(input.mode)) {
			throw new BadRequestException('Invalid mode');
		}
		const lower = input.urlTemplate.toLowerCase();
		if (lower.includes('javascript:') || lower.includes('data:')) {
			throw new BadRequestException('Unsupported URL scheme');
		}
	}
}
