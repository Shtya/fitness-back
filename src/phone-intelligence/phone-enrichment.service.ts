import {
	BadRequestException,
	HttpException,
	HttpStatus,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { RedisService } from '../redis/redis.service';
import {
	PhoneEnrichmentJob,
	PhoneEnrichmentStatus,
	PhoneEnrichmentStepStatus,
	PhoneLookup,
	PhoneReport,
	PublicMatch,
} from './entities/phone-intelligence.entity';
import { LookupPhoneDto } from './dto/phone-intelligence.dto';
import { hashValue, normalizePhone, NormalizedPhone, buildManualSearchLinks, phoneSearchFormats } from './phone-normalize';
import { PhoneLookupProvidersService } from './phone-lookup-providers.service';
import { PhonePublicSearchService } from './phone-public-search.service';
import { PhonePageFetchService } from './phone-page-fetch.service';
import { PhoneSearchSitesService } from './phone-search-sites.service';
import { collectFindings, collectSignalsFromSearchTargets, mergeFindings } from './phone-findings';

const JOB_TTL_SEC = 60 * 60 * 6;
const RATE_LIMIT_PER_HOUR = 20;

type StepDef = {
	id: string;
	labelEn: string;
	labelAr: string;
	status: PhoneEnrichmentStepStatus;
	message?: string | null;
	startedAt?: string | null;
	finishedAt?: string | null;
};

@Injectable()
export class PhoneEnrichmentService {
	private readonly logger = new Logger(PhoneEnrichmentService.name);
	private readonly memoryJobs = new Map<string, any>();

	constructor(
		@InjectRepository(PhoneEnrichmentJob)
		private readonly jobRepo: Repository<PhoneEnrichmentJob>,
		@InjectRepository(PhoneLookup)
		private readonly lookupRepo: Repository<PhoneLookup>,
		@InjectRepository(PhoneReport)
		private readonly reportRepo: Repository<PhoneReport>,
		@InjectRepository(PublicMatch)
		private readonly matchRepo: Repository<PublicMatch>,
		private readonly providers: PhoneLookupProvidersService,
		private readonly publicSearch: PhonePublicSearchService,
		private readonly pageFetch: PhonePageFetchService,
		private readonly searchSites: PhoneSearchSitesService,
		private readonly redis: RedisService,
	) {}

	async start(userId: string, dto: LookupPhoneDto, ip?: string) {
		await this.enforceRateLimit(userId || ip || 'anon');

		const phone = normalizePhone(dto.phone, dto.countryCode);
		if (!phone.e164 || phone.e164.replace(/\D/g, '').length < 8) {
			throw new BadRequestException('Invalid phone number');
		}

		const steps = this.initialSteps();
		const job = this.jobRepo.create({
			id: randomUUID(),
			status: PhoneEnrichmentStatus.QUEUED,
			phoneHash: phone.phoneHash,
			e164Masked: phone.e164Masked,
			e164: phone.e164,
			countryCode: phone.countryCode,
			userId: userId || null,
			progressPercent: 0,
			currentStep: steps[0].id,
			steps,
			partialResult: {
				phone: this.phonePayload(phone),
				disclaimer:
					'Background enrichment uses public APIs and public pages only. Names are not proof of ownership.',
			},
			finalResult: null,
			errorMessage: null,
			finishedAt: null,
		});
		await this.jobRepo.save(job);
		await this.persistJobCache(job);

		// Fire-and-forget background pipeline
		setImmediate(() => {
			this.runJob(job.id).catch(err =>
				this.logger.error(`Enrichment job ${job.id} crashed: ${err?.message || err}`),
			);
		});

		return this.toClient(job);
	}

	async getJob(jobId: string, userId?: string) {
		const cached = await this.redis.get<any>(this.cacheKey(jobId));
		if (cached) {
			if (userId && cached.userId && cached.userId !== userId) {
				throw new NotFoundException('Job not found');
			}
			return cached;
		}

		const job = await this.jobRepo.findOne({ where: { id: jobId } });
		if (!job) {
			const mem = this.memoryJobs.get(jobId);
			if (mem) return mem;
			throw new NotFoundException('Job not found');
		}
		if (userId && job.userId && job.userId !== userId) {
			throw new NotFoundException('Job not found');
		}
		const payload = this.toClient(job);
		await this.persistJobCache(job);
		return payload;
	}

	private async runJob(jobId: string) {
		const job = await this.jobRepo.findOne({ where: { id: jobId } });
		if (!job) return;

		const phone = normalizePhone(job.e164, job.countryCode || undefined);
		job.status = PhoneEnrichmentStatus.RUNNING;
		await this.saveProgress(job, 2, 'normalize', null);

		const bag: any = {
			phone: this.phonePayload(phone),
			network: null,
			identity: { possiblePublicName: null, fromPublicWeb: [] },
			findings: { names: [], locations: [], activities: [], mentions: [] },
			reports: { total: 0, byCategory: {}, topCategory: null, recent: [] },
			publicPresence: [],
			pageInsights: [],
			externalManualSearch: {},
			providers: [],
			searchTargets: [],
			sourcesMerged: [],
			disclaimer:
				'Possible names and links come from public sources only. They are not proof of ownership.',
			enrichment: { mode: 'deep_background', completedSteps: [] },
		};

		let lastPersistAt = 0;
		const upsertTarget = async (target: {
			id: string;
			labelEn: string;
			labelAr: string;
			status: string;
			kind: string;
			message?: string;
			response?: Record<string, unknown> | null;
			progressPercent?: number;
		}) => {
			const list = bag.searchTargets as any[];
			const idx = list.findIndex(t => t.id === target.id);
			const { progressPercent, ...rest } = target;
			if (idx >= 0) list[idx] = { ...list[idx], ...rest };
			else list.push(rest);
			if (typeof progressPercent === 'number') {
				job.progressPercent = Math.max(job.progressPercent || 0, progressPercent);
			}
			job.partialResult = bag;
			const now = Date.now();
			const force =
				rest.status === 'done' || rest.status === 'failed' || rest.status === 'skipped';
			if (force || now - lastPersistAt > 1500) {
				lastPersistAt = now;
				await this.jobRepo.save(job);
			}
			await this.persistJobCache(job);
		};

		try {
			// 1) Normalize already done
			await this.finishStep(job, 'normalize', 'Number normalized');
			await this.saveProgress(job, 8, 'network_lookup', bag);

			// 2) Network providers
			await this.startStep(job, 'network_lookup');
			for (const p of ['twilio', 'abstract', 'numverify', 'local']) {
				await upsertTarget({
					id: `api:${p}`,
					labelEn: p,
					labelAr: p,
					status: 'running',
					kind: 'api',
				});
			}
			const providerResults = await this.providers.lookup(phone);
			const merged = this.providers.merge(providerResults);
			bag.providers = providerResults.map(p => ({
				provider: p.provider,
				configured: p.configured,
				error: p.error || null,
				possibleCallerName: p.possibleCallerName || null,
			}));
			for (const p of providerResults) {
				await upsertTarget({
					id: `api:${p.provider}`,
					labelEn: p.provider,
					labelAr: p.provider,
					status: !p.configured ? 'skipped' : p.error ? 'failed' : 'done',
					kind: 'api',
					message: !p.configured
						? 'API key missing'
						: p.error ||
							(p.possibleCallerName ? `name: ${p.possibleCallerName}` : 'ok'),
					response: {
						configured: p.configured,
						error: p.error || null,
						valid: p.valid ?? null,
						carrier: p.carrier || null,
						lineType: p.lineType || null,
						country: p.country || null,
						countryCode: p.countryCode || null,
						possibleCallerName: p.possibleCallerName || null,
						callerNameSource: p.callerNameSource || null,
						raw: p.raw || null,
					},
				});
			}
			await upsertTarget({
				id: 'api:local',
				labelEn: 'local carrier guess',
				labelAr: 'تخمين شركة محلي',
				status: 'done',
				kind: 'api',
				message: providerResults.find(r => r.provider === 'local')?.carrier || 'ok',
				response: {
					carrier: providerResults.find(r => r.provider === 'local')?.carrier || null,
					raw: providerResults.find(r => r.provider === 'local')?.raw || null,
				},
			});
			bag.network = {
				valid: merged.valid ?? phone.valid,
				country: merged.country || phone.countryName,
				countryCode: merged.countryCode || phone.countryCode,
				carrier: merged.carrier,
				lineType: merged.lineType,
				riskScore: merged.riskScore,
				riskLevel: merged.riskLevel,
				provider: merged.provider,
			};
			bag.identity.possiblePublicName = merged.possibleCallerName
				? {
						label: merged.possibleCallerName,
						source: merged.callerNameSource || merged.provider,
						confidence: merged.callerNameSource === 'twilio_cnam' ? 0.55 : 0.35,
						note: 'Possible name from a public/caller-ID source — not a verified legal owner.',
					}
				: null;
			bag.sourcesMerged.push({
				source: 'network_lookup',
				items: providerResults.filter(p => p.configured && !p.error).map(p => p.provider),
			});

			await this.lookupRepo.save(
				this.lookupRepo.create({
					phoneHash: phone.phoneHash,
					e164Masked: phone.e164Masked,
					valid: bag.network.valid,
					countryCode: bag.network.countryCode,
					country: bag.network.country,
					carrier: bag.network.carrier,
					lineType: bag.network.lineType,
					riskScore: bag.network.riskScore,
					riskLevel: bag.network.riskLevel,
					callerName: merged.possibleCallerName,
					callerNameSource: merged.callerNameSource,
					providerUsed: merged.provider,
					rawProvider: merged.raw as Record<string, unknown>,
				}),
			);
			await this.finishStep(job, 'network_lookup', `Providers: ${bag.providers.length}`);
			await this.saveProgress(job, 28, 'community_reports', bag);

			// 3) Community reports
			await this.startStep(job, 'community_reports');
			const reports = await this.reportRepo.find({
				where: { phoneHash: phone.phoneHash },
				order: { createdAt: 'DESC' },
				take: 50,
			});
			const byCategory: Record<string, number> = {};
			for (const r of reports) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
			const topCategory =
				Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
			bag.reports = {
				total: reports.length,
				byCategory,
				topCategory,
				recent: reports.slice(0, 10).map(r => ({
					id: r.id,
					category: r.category,
					comment: r.comment,
					createdAt: r.createdAt,
				})),
			};
			await this.finishStep(job, 'community_reports', `${reports.length} reports`);
			await this.saveProgress(job, 38, 'public_web_search', bag);

			// 4) Deep public web search across engines + managed sites
			await this.startStep(job, 'public_web_search');
			const sites = await this.searchSites.listEnabled();

			let hits = await this.publicSearch.search(phone, {
				deep: true,
				onProgress: async t => {
					await upsertTarget({
						id: t.id,
						labelEn: t.labelEn,
						labelAr: t.labelAr,
						status: t.status,
						kind: t.kind,
						message: t.message,
						response: t.response || null,
						progressPercent: t.progressPercent,
					});
				},
			});
			bag.sourcesMerged.push({
				source: 'public_web_search',
				items: [...new Set(hits.map(h => h.provider))],
				count: hits.length,
			});
			await this.finishStep(
				job,
				'public_web_search',
				`${hits.filter(h => h.provider !== 'manual_directory').length} public hits`,
			);
			await this.saveProgress(job, 62, 'fetch_public_pages', bag);

			// 5) Open public result pages and extract visible info
			await this.startStep(job, 'fetch_public_pages');
			await upsertTarget({
				id: 'page_fetch',
				labelEn: 'Open public pages',
				labelAr: 'فتح الصفحات العامة',
				status: 'running',
				kind: 'engine',
			});
			const formats = phoneSearchFormats(phone);
			const digits = [
				phone.e164.replace(/\D/g, ''),
				phone.national.replace(/\D/g, ''),
				formats.localLeadingZero,
				formats.withoutCountry,
				formats.bestWebQuery,
			].filter(Boolean);
			hits = await this.pageFetch.enrichHits(hits, digits, 14);
			const pageInsights = hits
				.filter(h => String(h.provider || '').includes('page_fetch'))
				.map(h => ({
					title: h.title,
					sourceUrl: h.sourceUrl,
					snippet: h.snippet,
					possibleName: h.possibleName,
					confidenceScore: h.confidenceScore,
				}));
			bag.pageInsights = pageInsights;

			for (const target of bag.searchTargets as any[]) {
				if (!String(target.id || '').startsWith('site:')) continue;
				const url = target.response?.url || target.response?.hits?.[0]?.url;
				if (!url) continue;
				const matched = pageInsights.filter(p => p.sourceUrl === url);
				if (!matched.length) continue;
				const names = matched.map(m => m.possibleName).filter(Boolean);
				target.response = {
					...(target.response || {}),
					real: true,
					pageFetch: matched,
					namesFound: [
						...new Set([...(target.response?.namesFound || []), ...names]),
					],
					hitCount: Math.max(Number(target.response?.hitCount || 0), matched.length),
				};
				if (names[0]) target.message = `name: ${names[0]}`;
			}

			await upsertTarget({
				id: 'page_fetch',
				labelEn: 'Open public pages',
				labelAr: 'فتح الصفحات العامة',
				status: 'done',
				kind: 'engine',
				message: `Opened ${pageInsights.length}`,
				response: {
					real: true,
					opened: pageInsights.length,
					namesFound: pageInsights.map(p => p.possibleName).filter(Boolean),
					pages: pageInsights.slice(0, 14),
				},
			});
			await this.finishStep(
				job,
				'fetch_public_pages',
				`Opened ${pageInsights.length} public pages`,
			);
			await this.saveProgress(job, 78, 'merge', bag);

			// Early findings so we can follow up by name
			let findings = collectFindings(
				hits.map(h => ({
					title: h.title,
					snippet: h.snippet,
					possibleName: h.possibleName,
					sourceUrl: h.sourceUrl,
					sourceType: h.sourceType,
					confidenceScore: h.confidenceScore,
				})),
			);
			if (!bag.identity.possiblePublicName && findings.names?.[0]) {
				bag.identity.possiblePublicName = {
					label: findings.names[0].label,
					source: findings.names[0].sourceUrl || 'public_web',
					confidence: findings.names[0].confidence,
					note: 'Possible name from public web — not proof of ownership.',
				};
			}

			const followName =
				bag.identity?.possiblePublicName?.label || findings.names?.[0]?.label || null;
			if (followName) {
				const extra = await this.publicSearch.searchNameFollowUp(phone, followName, {
					onProgress: async t => {
						await upsertTarget({
							id: t.id,
							labelEn: t.labelEn,
							labelAr: t.labelAr,
							status: t.status,
							kind: t.kind,
							message: t.message,
							response: t.response || null,
							progressPercent: t.progressPercent,
						});
					},
				});
				if (extra.length) {
					hits = [...hits, ...extra];
					findings = collectFindings(
						hits.map(h => ({
							title: h.title,
							snippet: h.snippet,
							possibleName: h.possibleName,
							sourceUrl: h.sourceUrl,
							sourceType: h.sourceType,
							confidenceScore: h.confidenceScore,
						})),
					);
				}
			}

			// Persist matches
			const publicMatches = await this.persistMatches(phone.phoneHash, hits);
			bag.publicPresence = publicMatches.map(m => ({
				id: m.id,
				title: m.title,
				snippet: m.snippet,
				sourceUrl: m.sourceUrl,
				sourceType: m.sourceType,
				possibleName: m.possibleName,
				confidenceScore: m.confidenceScore,
				isOfficial: m.isOfficial,
				discoveredAt: m.discoveredAt,
			}));
			bag.identity.fromPublicWeb = publicMatches
				.filter(m => m.possibleName)
				.map(m => ({
					label: m.possibleName,
					sourceUrl: m.sourceUrl,
					sourceType: m.sourceType,
					confidence: m.confidenceScore,
					discoveredAt: m.discoveredAt,
					note: 'Name that appeared next to this number on a public page.',
				}));

			bag.findings = mergeFindings(
				findings,
				collectSignalsFromSearchTargets(bag.searchTargets || []),
			);
			if (!bag.identity.possiblePublicName && bag.findings.names?.[0]) {
				bag.identity.possiblePublicName = {
					label: bag.findings.names[0].label,
					source: bag.findings.names[0].sourceUrl || 'public_web',
					confidence: bag.findings.names[0].confidence,
					note: 'Possible name from public web — not proof of ownership.',
				};
			}

			// Prefer community score in network risk hint when available
			const communityScore = bag.findings.scores?.[0]?.value;
			if (communityScore && bag.network) {
				bag.network.communityScore = communityScore;
				bag.network.communityScoreSource = bag.findings.scores[0].sourceUrl || 'public';
			}

			bag.externalManualSearch = this.publicSearch.buildWorkingUsefulLinks(
				phone,
				sites,
				bag.searchTargets,
			);

			// 6) Merge
			await this.startStep(job, 'merge');
			bag.checkedAt = new Date().toISOString();
			bag.searchFormats = phoneSearchFormats(phone);
			bag.insights = this.buildInsights(phone, bag);
			bag.enrichment = {
				mode: 'deep_background',
				completedSteps: (job.steps || [])
					.filter(s => s.status === PhoneEnrichmentStepStatus.DONE)
					.map(s => s.id)
					.concat(['merge']),
				mergedAt: bag.checkedAt,
			};
			await this.finishStep(job, 'merge', 'Report merged');

			job.status = PhoneEnrichmentStatus.DONE;
			job.progressPercent = 100;
			job.currentStep = 'done';
			job.partialResult = bag;
			job.finalResult = bag;
			job.finishedAt = new Date();
			job.errorMessage = null;
			await this.jobRepo.save(job);
			await this.persistJobCache(job);
			await this.redis.set(`phone-intel:lookup:${phone.phoneHash}`, bag, 60 * 60 * 12);
		} catch (error: any) {
			this.logger.error(`Job ${jobId} failed: ${error?.message || error}`);
			job.status = PhoneEnrichmentStatus.FAILED;
			job.errorMessage = error?.message || 'Enrichment failed';
			job.finishedAt = new Date();
			job.partialResult = bag;
			await this.markCurrentFailed(job, job.errorMessage);
			await this.jobRepo.save(job);
			await this.persistJobCache(job);
		}
	}

	private initialSteps(): StepDef[] {
		return [
			{
				id: 'normalize',
				labelEn: 'Normalize',
				labelAr: 'تطبيع الرقم',
				status: PhoneEnrichmentStepStatus.PENDING,
			},
			{
				id: 'network_lookup',
				labelEn: 'Network APIs',
				labelAr: 'واجهات الشبكة',
				status: PhoneEnrichmentStepStatus.PENDING,
			},
			{
				id: 'community_reports',
				labelEn: 'Community reports',
				labelAr: 'بلاغات المجتمع',
				status: PhoneEnrichmentStepStatus.PENDING,
			},
			{
				id: 'public_web_search',
				labelEn: 'Deep web search',
				labelAr: 'بحث عميق على الويب',
				status: PhoneEnrichmentStepStatus.PENDING,
			},
			{
				id: 'fetch_public_pages',
				labelEn: 'Read public pages',
				labelAr: 'قراءة الصفحات العامة',
				status: PhoneEnrichmentStepStatus.PENDING,
			},
			{
				id: 'merge',
				labelEn: 'Merge report',
				labelAr: 'دمج التقرير',
				status: PhoneEnrichmentStepStatus.PENDING,
			},
		];
	}

	private phonePayload(phone: NormalizedPhone) {
		return {
			e164: phone.e164,
			e164Masked: phone.e164Masked,
			international: phone.international,
			national: phone.national,
			countryCode: phone.countryCode,
			callingCode: phone.callingCode,
			country: phone.countryName,
			valid: phone.valid,
			possible: phone.possible,
			type: phone.type,
		};
	}

	private manualLinks(phone: NormalizedPhone) {
		return buildManualSearchLinks(phone);
	}

	private buildInsights(phone: NormalizedPhone, bag: any) {
		const formats = phoneSearchFormats(phone);
		const names = bag.findings?.names || [];
		const locations = bag.findings?.locations || [];
		const activities = bag.findings?.activities || [];
		const scores = bag.findings?.scores || [];
		const highlights = bag.findings?.highlights || [];
		const realHits = (bag.publicPresence || []).filter(
			(p: any) =>
				!String(p.title || '')
					.toLowerCase()
					.includes('manual'),
		);
		const reportCount = bag.reports?.total || 0;
		const risk = bag.network?.riskLevel || 'low';

		const facts: string[] = [];
		if (names[0]?.label) facts.push(`Possible public name: ${names[0].label}`);
		if (locations.length) facts.push(`Locations mentioned: ${locations.slice(0, 4).join(', ')}`);
		if (scores[0]?.value) facts.push(`Community score: ${scores[0].value}`);
		if (activities.length) facts.push(`Activity hints: ${activities.slice(0, 5).join(', ')}`);
		if (highlights.length) facts.push(`${highlights.length} structured public signals`);
		if (realHits.length) facts.push(`${realHits.length} public mentions found`);
		if (reportCount > 0) facts.push(`${reportCount} community report(s)`);
		if (bag.network?.carrier) facts.push(`Carrier: ${bag.network.carrier}`);

		return {
			verdict:
				risk === 'high' || Number(scores[0]?.value) >= 7
					? 'Elevated risk signals — verify carefully.'
					: reportCount > 0
						? 'Community reports exist — verify before trusting.'
						: names.length || realHits.length || scores.length
							? 'Public signals found — still not proof of ownership.'
							: 'Limited public signal so far.',
			riskLevel: risk,
			facts,
			searchFormats: {
				bestWebQuery: formats.bestWebQuery,
				e164: formats.e164,
			},
			dataGaps: [
				!names.length ? 'public_name' : null,
				!locations.length ? 'location' : null,
				!realHits.length ? 'public_web_listings' : null,
			].filter(Boolean),
		};
	}

	private async persistMatches(phoneHash: string, hits: any[]): Promise<PublicMatch[]> {
		const saved: PublicMatch[] = [];
		for (const hit of hits) {
			if (!hit.sourceUrl || hit.provider === 'manual_directory') {
				saved.push(
					this.matchRepo.create({
						phoneHash,
						title: hit.title,
						snippet: hit.snippet,
						sourceUrl: hit.sourceUrl,
						sourceType: hit.sourceType,
						possibleName: hit.possibleName,
						confidenceScore: hit.confidenceScore,
						isOfficial: hit.isOfficial,
					}),
				);
				continue;
			}
			try {
				let existing = await this.matchRepo.findOne({
					where: { phoneHash, sourceUrl: hit.sourceUrl },
				});
				if (existing) {
					existing.title = hit.title;
					existing.snippet = hit.snippet;
					existing.possibleName = hit.possibleName;
					existing.confidenceScore = hit.confidenceScore;
					existing.sourceType = hit.sourceType;
					existing.isOfficial = hit.isOfficial;
					existing = await this.matchRepo.save(existing);
					saved.push(existing);
				} else {
					saved.push(
						await this.matchRepo.save(
							this.matchRepo.create({
								phoneHash,
								title: hit.title,
								snippet: hit.snippet,
								sourceUrl: hit.sourceUrl,
								sourceType: hit.sourceType,
								possibleName: hit.possibleName,
								confidenceScore: hit.confidenceScore,
								isOfficial: hit.isOfficial,
							}),
						),
					);
				}
			} catch (error: any) {
				this.logger.warn(`persist match failed: ${error?.message || error}`);
			}
		}
		return saved;
	}

	private async startStep(job: PhoneEnrichmentJob, stepId: string) {
		job.steps = (job.steps || []).map(s =>
			s.id === stepId
				? {
						...s,
						status: PhoneEnrichmentStepStatus.RUNNING,
						startedAt: new Date().toISOString(),
						message: null,
					}
				: s,
		);
		job.currentStep = stepId;
		await this.jobRepo.save(job);
		await this.persistJobCache(job);
	}

	private async finishStep(job: PhoneEnrichmentJob, stepId: string, message?: string) {
		job.steps = (job.steps || []).map(s =>
			s.id === stepId
				? {
						...s,
						status: PhoneEnrichmentStepStatus.DONE,
						finishedAt: new Date().toISOString(),
						message: message || null,
					}
				: s,
		);
		await this.jobRepo.save(job);
		await this.persistJobCache(job);
	}

	private async markCurrentFailed(job: PhoneEnrichmentJob, message: string) {
		const current = job.currentStep;
		job.steps = (job.steps || []).map(s =>
			s.id === current && s.status === PhoneEnrichmentStepStatus.RUNNING
				? {
						...s,
						status: PhoneEnrichmentStepStatus.FAILED,
						finishedAt: new Date().toISOString(),
						message,
					}
				: s,
		);
	}

	private async saveProgress(
		job: PhoneEnrichmentJob,
		percent: number,
		currentStep: string,
		partial: any,
	) {
		job.progressPercent = percent;
		job.currentStep = currentStep;
		if (partial) job.partialResult = partial;
		await this.jobRepo.save(job);
		await this.persistJobCache(job);
	}

	private toClient(job: PhoneEnrichmentJob) {
		const result = job.finalResult || job.partialResult || null;
		return {
			jobId: job.id,
			status: job.status,
			progressPercent: job.progressPercent,
			currentStep: job.currentStep,
			steps: job.steps,
			searchTargets: (result as any)?.searchTargets || [],
			phoneMasked: job.e164Masked,
			e164: job.e164,
			userId: job.userId,
			errorMessage: job.errorMessage,
			result,
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
			finishedAt: job.finishedAt,
		};
	}

	private cacheKey(jobId: string) {
		return `phone-intel:job:${jobId}`;
	}

	private async persistJobCache(job: PhoneEnrichmentJob) {
		const payload = this.toClient(job);
		this.memoryJobs.set(job.id, payload);
		await this.redis.set(this.cacheKey(job.id), payload, JOB_TTL_SEC);
	}

	private async enforceRateLimit(key: string) {
		const redisKey = `phone-intel:enrich-rl:${hashValue(key)}`;
		try {
			const current = (await this.redis.get<number>(redisKey)) || 0;
			if (Number(current) >= RATE_LIMIT_PER_HOUR) {
				throw new HttpException(
					'Too many enrichment jobs. Please try again later.',
					HttpStatus.TOO_MANY_REQUESTS,
				);
			}
			await this.redis.set(redisKey, Number(current) + 1, 3600);
		} catch (error) {
			if (error instanceof HttpException) throw error;
		}
	}
}
