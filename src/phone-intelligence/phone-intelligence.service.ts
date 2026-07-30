import {
	BadRequestException,
	HttpException,
	HttpStatus,
	Injectable,
	Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import {
	PhoneLookup,
	PhoneReport,
	PhoneReportCategory,
	PublicMatch,
} from './entities/phone-intelligence.entity';
import { CreatePhoneReportDto, LookupPhoneDto } from './dto/phone-intelligence.dto';
import { hashValue, normalizePhone, buildManualSearchLinks, phoneSearchFormats } from './phone-normalize';
import { PhoneLookupProvidersService } from './phone-lookup-providers.service';
import { PhonePublicSearchService } from './phone-public-search.service';
import { PhoneCredentialsService } from './phone-credentials.service';
import { AiFreeService } from '../ai-free/ai-free.service';

const CACHE_TTL_SEC = 60 * 60 * 12; // 12h
const RATE_LIMIT_PER_HOUR = 30;

@Injectable()
export class PhoneIntelligenceService {
	private readonly logger = new Logger(PhoneIntelligenceService.name);

	constructor(
		@InjectRepository(PhoneLookup)
		private readonly lookupRepo: Repository<PhoneLookup>,
		@InjectRepository(PhoneReport)
		private readonly reportRepo: Repository<PhoneReport>,
		@InjectRepository(PublicMatch)
		private readonly matchRepo: Repository<PublicMatch>,
		private readonly providers: PhoneLookupProvidersService,
		private readonly publicSearch: PhonePublicSearchService,
		private readonly credentialsService: PhoneCredentialsService,
		private readonly aiFree: AiFreeService,
		private readonly redis: RedisService,
	) {}

	async providersStatus() {
		const status = await this.providers.status();
		const credentials = await this.credentialsService.listStatus();
		return {
			...status,
			credentials,
			disclaimer: {
				en: 'This tool shows public / network metadata and community reports only. It cannot legally reveal private identity, home address, live location, private social accounts, wallet activity, or leaked databases from a phone number alone.',
				ar: 'هذه الأداة تعرض بيانات عامة وبيانات الشبكة وبلاغات المجتمع فقط. لا يمكنها قانونيًا كشف الهوية الخاصة أو العنوان السكني أو الموقع الحي أو الحسابات الخاصة أو نشاط المحافظ أو قواعد البيانات المسربة من رقم الهاتف وحده.',
			},
			notSupported: [
				'residential_address',
				'live_location_or_movements',
				'bank_or_carrier_legal_name',
				'transfer_or_purchase_history',
				'private_unpublished_social_accounts',
				'whatsapp_profile_or_avatar_scraping',
				'instapay_or_ewallet_data',
				'leaked_telegram_or_breach_databases',
			],
		};
	}

	async lookup(userId: string, dto: LookupPhoneDto, ip?: string) {
		await this.enforceRateLimit(userId || ip || 'anon');

		const phone = normalizePhone(dto.phone, dto.countryCode);
		if (!phone.e164 || phone.e164.replace(/\D/g, '').length < 8) {
			throw new BadRequestException('Invalid phone number');
		}

		const cacheKey = `phone-intel:lookup:${phone.phoneHash}`;
		if (!dto.refresh) {
			const cached = await this.redis.get<any>(cacheKey);
			if (cached) {
				return { ...cached, cached: true };
			}
		}

		const providerResults = await this.providers.lookup(phone);
		const merged = this.providers.merge(providerResults);

		const lookupRow = this.lookupRepo.create({
			phoneHash: phone.phoneHash,
			e164Masked: phone.e164Masked,
			valid: merged.valid ?? phone.valid,
			countryCode: merged.countryCode || phone.countryCode,
			country: merged.country || phone.countryName,
			carrier: merged.carrier,
			lineType: merged.lineType || null,
			riskScore: merged.riskScore,
			riskLevel: merged.riskLevel,
			callerName: merged.possibleCallerName,
			callerNameSource: merged.callerNameSource,
			providerUsed: merged.provider,
			rawProvider: merged.raw as Record<string, unknown>,
		});
		await this.lookupRepo.save(lookupRow);

		let publicMatches: PublicMatch[] = [];
		try {
			const hits = await this.publicSearch.search(phone);
			publicMatches = await this.persistMatches(phone.phoneHash, hits);
		} catch (error: any) {
			this.logger.warn(`Public search failed: ${error?.message || error}`);
			publicMatches = await this.matchRepo.find({
				where: { phoneHash: phone.phoneHash },
				order: { confidenceScore: 'DESC' },
				take: 25,
			});
		}

		const reports = await this.reportRepo.find({
			where: { phoneHash: phone.phoneHash },
			order: { createdAt: 'DESC' },
			take: 50,
		});
		const reportSummary = this.summarizeReports(reports);

		const response = {
			cached: false,
			disclaimer:
				'Possible names and links come from public sources only. They are not proof of ownership.',
			phone: {
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
			},
			network: {
				valid: merged.valid ?? phone.valid,
				country: merged.country || phone.countryName,
				countryCode: merged.countryCode || phone.countryCode,
				carrier: merged.carrier,
				lineType: merged.lineType,
				riskScore: merged.riskScore,
				riskLevel: merged.riskLevel,
				provider: merged.provider,
			},
			identity: {
				possiblePublicName: merged.possibleCallerName
					? {
							label: merged.possibleCallerName,
							source: merged.callerNameSource || merged.provider,
							confidence: merged.callerNameSource === 'twilio_cnam' ? 0.55 : 0.35,
							note: 'Possible name from a public/caller-ID source — not a verified legal owner.',
						}
					: null,
				fromPublicWeb: publicMatches
					.filter(m => m.possibleName)
					.map(m => ({
						label: m.possibleName,
						sourceUrl: m.sourceUrl,
						sourceType: m.sourceType,
						confidence: m.confidenceScore,
						discoveredAt: m.discoveredAt,
						note: 'Name that appeared next to this number on a public page.',
					})),
			},
			reports: {
				total: reports.length,
				byCategory: reportSummary.byCategory,
				topCategory: reportSummary.topCategory,
				recent: reports.slice(0, 10).map(r => ({
					id: r.id,
					category: r.category,
					comment: r.comment,
					createdAt: r.createdAt,
				})),
			},
			publicPresence: publicMatches.map(m => ({
				id: m.id,
				title: m.title,
				snippet: m.snippet,
				sourceUrl: m.sourceUrl,
				sourceType: m.sourceType,
				possibleName: m.possibleName,
				confidenceScore: m.confidenceScore,
				isOfficial: m.isOfficial,
				discoveredAt: m.discoveredAt,
			})),
			externalManualSearch: buildManualSearchLinks(phone),
			searchFormats: phoneSearchFormats(phone),
			insights: {
				verdict:
					(merged.riskLevel || 'low') === 'high'
						? 'Treat carefully — elevated risk signals.'
						: reports.length > 0
							? 'Some community reports exist — verify before trusting.'
							: 'No strong scam signals in available public data.',
				riskLevel: merged.riskLevel || 'low',
				facts: [
					`Valid: ${merged.valid ?? phone.valid}`,
					merged.carrier ? `Carrier: ${merged.carrier}` : 'Carrier unknown',
					`Community reports: ${reports.length}`,
					`Public matches: ${publicMatches.filter(m => !String(m.title || '').toLowerCase().includes('manual')).length}`,
				],
				searchFormats: {
					bestWebQuery: phoneSearchFormats(phone).bestWebQuery,
					localLeadingZero: phoneSearchFormats(phone).localLeadingZero,
					e164: phone.e164,
					noteEn:
						'Social platforms often index Egyptian numbers as 01xxxxxxxxx, not +20…',
					noteAr:
						'منصات التواصل غالبًا تفهرس الأرقام المصرية بصيغة 01xxxxxxxxx وليس +20…',
				},
				nextActions: Object.entries(buildManualSearchLinks(phone))
					.filter(([k]) =>
						['instagram', 'facebook', 'googleLocal', 'truecaller', 'companyAds'].includes(k),
					)
					.map(([id, url], i) => ({
						id,
						labelEn: id,
						labelAr: id,
						url,
						priority: i + 1,
					})),
				dataGaps: [],
			},
			providers: providerResults.map(p => ({
				provider: p.provider,
				configured: p.configured,
				error: p.error || null,
			})),
			checkedAt: lookupRow.checkedAt,
		};

		await this.redis.set(cacheKey, response, CACHE_TTL_SEC);
		return response;
	}

	async createReport(userId: string, dto: CreatePhoneReportDto, ip?: string) {
		const phone = normalizePhone(dto.phone, dto.countryCode);
		if (!phone.valid && !phone.possible) {
			throw new BadRequestException('Invalid phone number');
		}

		const report = this.reportRepo.create({
			phoneHash: phone.phoneHash,
			countryCode: phone.countryCode,
			category: dto.category,
			comment: dto.comment?.trim() || null,
			reporterUserId: userId || null,
			ipHash: ip ? hashValue(ip) : null,
		});
		await this.reportRepo.save(report);
		await this.redis.del(`phone-intel:lookup:${phone.phoneHash}`);

		return {
			id: report.id,
			category: report.category,
			createdAt: report.createdAt,
			message: 'Report submitted. Thank you for helping the community.',
		};
	}

	async listReports(phoneRaw: string, countryCode?: string) {
		const phone = normalizePhone(phoneRaw, countryCode);
		const reports = await this.reportRepo.find({
			where: { phoneHash: phone.phoneHash },
			order: { createdAt: 'DESC' },
			take: 100,
		});
		return {
			total: reports.length,
			byCategory: this.summarizeReports(reports).byCategory,
			items: reports.map(r => ({
				id: r.id,
				category: r.category,
				comment: r.comment,
				createdAt: r.createdAt,
			})),
		};
	}

	async categories() {
		return Object.values(PhoneReportCategory).map(value => ({
			value,
			labelEn: {
				fraud: 'Fraud / scam',
				spam: 'Spam / nuisance calls',
				sales: 'Sales / marketing',
				delivery: 'Delivery',
				trusted_business: 'Trusted business',
				personal: 'Personal number',
				threat: 'Threat / extortion',
				unknown: 'Unknown',
			}[value],
			labelAr: {
				fraud: 'احتيال',
				spam: 'مكالمات مزعجة',
				sales: 'مبيعات / تسويق',
				delivery: 'توصيل',
				trusted_business: 'شركة موثوقة',
				personal: 'رقم شخصي',
				threat: 'تهديد أو ابتزاز',
				unknown: 'غير معروف',
			}[value],
		}));
	}

	async analyzeWithAi(user: any, report: Record<string, any>, locale?: string) {
		const isAr = String(locale || 'en').toLowerCase().startsWith('ar');
		const phone = report?.phone || {};
		const network = report?.network || {};
		const insights = report?.insights || {};
		const formats = report?.searchFormats || insights?.searchFormats || {};
		const reports = report?.reports || {};
		const presence = (report?.publicPresence || [])
			.filter((p: any) => !String(p.title || '').toLowerCase().includes('manual'))
			.slice(0, 12);
		const findings = report?.findings || {};

		const compact = {
			phone,
			network,
			reports,
			insights,
			searchFormats: formats,
			findings,
			publicPresence: presence.map((p: any) => ({
				title: p.title,
				url: p.sourceUrl,
				possibleName: p.possibleName,
				type: p.sourceType,
				snippet: p.snippet,
			})),
			possibleNames: report?.identity?.fromPublicWeb || [],
		};

		const system = isAr
			? `أنت مساعد تحقق من أرقام الهواتف داخل So7baFit (FitCoach).
حلّل تقرير الرقم وأعد ملخصًا عمليًا غنيًا بالعربية فقط بصيغة Markdown.
استخدم عناوين ## وقوائم - ونص **عريض** للنقاط المهمة.
التزم بالقواعد:
- لا تدّعِ معرفة الهوية الرسمية أو العنوان السكني أو الموقع الحي أو الحسابات الخاصة.
- إن وُجد اسم فقل "**اسم محتمل من مصدر عام**" وليس "صاحب الرقم".
- أبرز: الأسماء المحتملة، المواقع المذكورة، نوع النشاط، البلاغات، وروابط الظهور العام.
- لا تكرر تحذيرات طويلة — جملة واحدة كافية.
- أقسام مطلوبة:
## الخلاصة
## إشارات مفيدة
## ما ظهر علنًا
## فجوات
## ماذا تفعل الآن`
			: `You are So7baFit FitCoach helping with phone public-intel checks.
Analyze the phone report and return a rich practical summary in English only as Markdown.
Use ## headings, - lists, and **bold** for key points.
Rules:
- Never claim private identity, home address, live location, or private social accounts.
- If a name appears, call it a "**possible public name**", never "the owner".
- Highlight possible names, mentioned locations, activity hints, reports, and public links.
- Avoid long disclaimer spam — one short sentence is enough.
- Required sections:
## Verdict
## Useful signals
## Public mentions
## Gaps
## What to do next`;

		const userPrompt = `${isAr ? 'حلل هذا التقرير:' : 'Analyze this report:'}\n${JSON.stringify(compact).slice(0, 7000)}`;

		const result = await this.aiFree.chat(user, {
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: userPrompt },
			],
			useProjectKnowledge: false,
			allowFallback: true,
		});

		return {
			ok: true,
			summary: result.reply,
			provider: result.provider,
			elapsedMs: result.elapsedMs,
		};
	}

	private async persistMatches(phoneHash: string, hits: any[]): Promise<PublicMatch[]> {
		const saved: PublicMatch[] = [];
		for (const hit of hits) {
			if (!hit.sourceUrl || hit.provider === 'manual_directory') {
				// Keep manual hints in response only via search service; still return synthetic objects
				const ephemeral = this.matchRepo.create({
					phoneHash,
					title: hit.title,
					snippet: hit.snippet,
					sourceUrl: hit.sourceUrl,
					sourceType: hit.sourceType,
					possibleName: hit.possibleName,
					confidenceScore: hit.confidenceScore,
					isOfficial: hit.isOfficial,
				});
				saved.push(ephemeral);
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
					const row = this.matchRepo.create({
						phoneHash,
						title: hit.title,
						snippet: hit.snippet,
						sourceUrl: hit.sourceUrl,
						sourceType: hit.sourceType,
						possibleName: hit.possibleName,
						confidenceScore: hit.confidenceScore,
						isOfficial: hit.isOfficial,
					});
					saved.push(await this.matchRepo.save(row));
				}
			} catch (error: any) {
				this.logger.warn(`Failed to persist match: ${error?.message || error}`);
			}
		}
		return saved;
	}

	private summarizeReports(reports: PhoneReport[]) {
		const byCategory: Record<string, number> = {};
		for (const r of reports) {
			byCategory[r.category] = (byCategory[r.category] || 0) + 1;
		}
		const topCategory =
			Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
		return { byCategory, topCategory };
	}

	private async enforceRateLimit(key: string) {
		const redisKey = `phone-intel:rl:${hashValue(key)}`;
		try {
			const current = (await this.redis.get<number>(redisKey)) || 0;
			if (Number(current) >= RATE_LIMIT_PER_HOUR) {
				throw new HttpException(
					'Too many phone checks. Please try again later.',
					HttpStatus.TOO_MANY_REQUESTS,
				);
			}
			await this.redis.set(redisKey, Number(current) + 1, 3600);
		} catch (error) {
			if (error instanceof HttpException) throw error;
			// Redis optional — allow request
		}
	}
}
