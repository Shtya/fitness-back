import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { RedisService } from '../redis/redis.service';
import {
	FitnessLead,
	FitnessLeadsJob,
	FitnessLeadsJobStatus,
} from './entities/fitness-leads.entity';
import { StartFitnessLeadsJobDto, SuggestKeywordsDto } from './dto/fitness-leads.dto';
import {
	FITNESS_CATEGORIES,
	FITNESS_CITIES,
	FITNESS_CITY_COORDS,
	FITNESS_COUNTRIES,
	FitnessCountryKey,
} from './fitness-leads.config';
import { FitnessLeadsCredentialsService } from './fitness-leads-credentials.service';
import { FitnessGooglePlacesService } from './fitness-google-places.service';
import { FitnessOsmService } from './fitness-osm.service';
import { FitnessWebsiteEnrichService } from './fitness-website-enrich.service';
import { AiFreeService } from '../ai-free/ai-free.service';
import {
	classifyBusinessType,
	classifyEmailType,
	dedupePlaces,
	extractCityFromAddress,
	extractNeighborhood,
	extractWhatsAppFromPhone,
	getBestEmail,
	getVerificationStatus,
	sleep,
} from './fitness-leads.utils';

@Injectable()
export class FitnessLeadsService {
	private readonly logger = new Logger(FitnessLeadsService.name);
	private readonly memory = new Map<string, any>();

	constructor(
		@InjectRepository(FitnessLeadsJob)
		private readonly jobRepo: Repository<FitnessLeadsJob>,
		@InjectRepository(FitnessLead)
		private readonly leadRepo: Repository<FitnessLead>,
		private readonly credentials: FitnessLeadsCredentialsService,
		private readonly places: FitnessGooglePlacesService,
		private readonly osm: FitnessOsmService,
		private readonly websiteEnrich: FitnessWebsiteEnrichService,
		private readonly aiFree: AiFreeService,
		private readonly redis: RedisService,
	) {}

	options() {
		return {
			countries: Object.entries(FITNESS_COUNTRIES).map(([key, value]) => ({
				key,
				...value,
				cities: FITNESS_CITIES[key as FitnessCountryKey],
			})),
			categories: FITNESS_CATEGORIES,
			defaults: {
				enrichWebsites: true,
				useOsm: true,
				maxPlaces: 40,
			},
		};
	}

	async suggestKeywords(user: any, dto: SuggestKeywordsDto) {
		const intent = String(dto.intent || '').trim();
		if (intent.length < 3) {
			throw new BadRequestException('intent is required (min 3 characters)');
		}
		const isAr = String(dto.locale || 'en').toLowerCase().startsWith('ar');
		const countryKey = String(dto.countryKey || '').toLowerCase() as FitnessCountryKey;
		const country = FITNESS_COUNTRIES[countryKey];
		const countryLabel = country
			? isAr
				? country.nameAr
				: country.name
			: '';

		const system = isAr
			? `أنت مساعد كشّاف العملاء (Lead Scout) داخل So7baFit.
اقترح كلمات بحث قصيرة مناسبة لـ Google Places / OSM للعثور على أنشطة تجارية عامة.
أرجع JSON فقط بالشكل:
{"keywords":["..."],"rationale":"شرح قصير بالعربية بصيغة Markdown"}
القواعد:
- 6 إلى 12 كلمة/عبارة قصيرة (عربي أو إنجليزي حسب السياق).
- لا تقترح بيانات خاصة أو سرقة هويات.
- ركّز على أنواع الأعمال والمنافذ العامة.`
			: `You are Lead Scout inside So7baFit.
Suggest short search keywords suitable for Google Places / OSM to find public businesses.
Return JSON only in this shape:
{"keywords":["..."],"rationale":"short English Markdown explanation"}
Rules:
- 6 to 12 short keywords/phrases (match the user's language when useful).
- Do not suggest private-data scraping or identity theft.
- Focus on public business types and niches.`;

		const userPrompt = isAr
			? `النية: ${intent}\nالدولة: ${countryLabel || 'غير محددة'}\nأرجع JSON فقط.`
			: `Intent: ${intent}\nCountry: ${countryLabel || 'unspecified'}\nReturn JSON only.`;

		const result = await this.aiFree.chat(user, {
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: userPrompt },
			],
			useProjectKnowledge: false,
			allowFallback: true,
		});

		const parsed = this.parseSuggestJson(result.reply);
		return {
			ok: true,
			keywords: parsed.keywords,
			rationale: parsed.rationale || result.reply,
			provider: result.provider,
			elapsedMs: result.elapsedMs,
		};
	}

	private parseSuggestJson(raw: string): { keywords: string[]; rationale: string } {
		const text = String(raw || '').trim();
		const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
		const candidate = fence?.[1]?.trim() || text;
		const brace = candidate.match(/\{[\s\S]*\}/);
		try {
			const obj = JSON.parse(brace?.[0] || candidate);
			const keywords = Array.isArray(obj?.keywords)
				? obj.keywords.map((k: any) => String(k || '').trim()).filter(Boolean).slice(0, 16)
				: [];
			return {
				keywords,
				rationale: String(obj?.rationale || '').trim(),
			};
		} catch {
			return { keywords: [], rationale: text };
		}
	}

	async start(userId: string, dto: StartFitnessLeadsJobDto) {
		const countryKey = String(dto.countryKey || '').toLowerCase() as FitnessCountryKey;
		if (!FITNESS_COUNTRIES[countryKey]) {
			throw new BadRequestException('Unsupported countryKey');
		}

		const apiKey = await this.credentials.resolveApiKey('google_places');
		if (!apiKey) {
			throw new ServiceUnavailableException(
				'Google Places API key is required. Save it from Lead Scout → Manage API keys.',
			);
		}

		const known = FITNESS_CITIES[countryKey] || [];
		const cities =
			dto.cities?.length > 0
				? [
						...new Set(
							dto.cities
								.map(c => String(c || '').trim())
								.filter(c => c.length >= 2 && c.length <= 80),
						),
					]
				: known.slice(0, 2);
		if (!cities.length) {
			throw new BadRequestException('At least one city is required');
		}

		const categories =
			dto.categories?.length > 0
				? [
						...new Set(
							dto.categories
								.map(c => String(c || '').trim())
								.filter(c => c.length >= 2 && c.length <= 80),
						),
					]
				: FITNESS_CATEGORIES.filter(c => !/[ء-ي]/.test(c)).slice(0, 5);
		if (!categories.length) {
			throw new BadRequestException('At least one keyword/category is required');
		}

		const steps = [
			{ id: 'places_search', labelEn: 'Google Places search', labelAr: 'بحث Google Places', status: 'pending' },
			{ id: 'osm_search', labelEn: 'OpenStreetMap directory', labelAr: 'دليل OpenStreetMap', status: 'pending' },
			{ id: 'enrich_websites', labelEn: 'Enrich websites / emails', labelAr: 'إثراء المواقع والإيميلات', status: 'pending' },
			{ id: 'save', labelEn: 'Save merged leads', labelAr: 'حفظ النتائج المدمجة', status: 'pending' },
		];

		const job = this.jobRepo.create({
			id: randomUUID(),
			status: FitnessLeadsJobStatus.QUEUED,
			userId: userId || null,
			countryKey,
			cities,
			categories,
			enrichWebsites: dto.enrichWebsites !== false,
			useOsm: dto.useOsm !== false,
			maxPlaces: dto.maxPlaces || 40,
			progressPercent: 0,
			currentStep: steps[0].id,
			steps,
			leadsCount: 0,
		});
		await this.jobRepo.save(job);
		await this.cacheJob(job);

		setImmediate(() => {
			this.runJob(job.id, apiKey).catch(err =>
				this.logger.error(`Fitness leads job ${job.id} failed: ${err?.message || err}`),
			);
		});

		return this.toClient(job, []);
	}

	async getJob(jobId: string, userId?: string) {
		const job = await this.jobRepo.findOne({ where: { id: jobId } });
		if (!job) throw new NotFoundException('Job not found');
		if (userId && job.userId && job.userId !== userId) throw new NotFoundException('Job not found');

		// Job process died / hung during enrich — recover so UI does not spin forever.
		if (
			job.status === FitnessLeadsJobStatus.RUNNING &&
			this.isJobStale(job)
		) {
			const savedCount = await this.leadRepo.count({ where: { jobId } });
			if (savedCount > 0) {
				this.logger.warn(`Auto-finalizing stale job ${jobId} with ${savedCount} leads`);
				return this.finalizeJob(jobId, userId);
			}
			job.status = FitnessLeadsJobStatus.FAILED;
			job.errorMessage =
				job.errorMessage ||
				'Job stalled during enrichment (no new progress). Try again with Enrich websites off, or lower max places.';
			job.finishedAt = new Date();
			await this.jobRepo.save(job);
			await this.redis.del(`fitness-leads:job:${jobId}`).catch(() => null);
		}

		const cached = await this.redis.get<any>(`fitness-leads:job:${jobId}`);
		if (
			cached &&
			cached.status === job.status &&
			cached.progressPercent === job.progressPercent &&
			cached.leadsCount === job.leadsCount
		) {
			if (userId && cached.userId && cached.userId !== userId) {
				throw new NotFoundException('Job not found');
			}
			return cached;
		}
		const leads = await this.leadRepo.find({
			where: { jobId },
			order: { createdAt: 'DESC' },
			take: 2000,
		});
		const payload = this.toClient(job, leads);
		await this.redis.set(`fitness-leads:job:${jobId}`, payload, 60 * 60 * 6);
		return payload;
	}

	private isJobStale(job: FitnessLeadsJob) {
		const updated = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
		if (!updated) return false;
		// Enrich often pauses >30s on bad sites; treat >3 min with no DB update as stuck.
		return Date.now() - updated > 180_000;
	}

	async listLeads(userId: string, jobId?: string) {
		const where: any = {};
		if (jobId) where.jobId = jobId;
		if (userId) where.userId = userId;
		const leads = await this.leadRepo.find({
			where,
			order: { createdAt: 'DESC' },
			take: 500,
		});
		return { total: leads.length, items: leads.map(l => this.mapLead(l)) };
	}

	async listJobs(userId: string) {
		const where: any = {};
		if (userId) where.userId = userId;
		const jobs = await this.jobRepo.find({
			where,
			order: { createdAt: 'DESC' },
			take: 80,
		});
		const items = jobs
			.map(job => ({
				jobId: job.id,
				status: job.status,
				countryKey: job.countryKey,
				cities: job.cities || [],
				categories: job.categories || [],
				leadsCount: job.leadsCount || 0,
				progressPercent: job.progressPercent || 0,
				isFavorite: Boolean(job.isFavorite),
				errorMessage: job.errorMessage,
				createdAt: job.createdAt,
				finishedAt: job.finishedAt,
			}))
			.sort((a, b) => {
				if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
				return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
			});
		return {
			total: items.length,
			items,
		};
	}

	async setJobFavorite(jobId: string, userId: string | undefined, isFavorite: boolean) {
		const job = await this.jobRepo.findOne({ where: { id: jobId } });
		if (!job) throw new NotFoundException('Job not found');
		if (userId && job.userId && job.userId !== userId) {
			throw new NotFoundException('Job not found');
		}
		job.isFavorite = Boolean(isFavorite);
		await this.jobRepo.save(job);
		await this.redis.del(`fitness-leads:job:${jobId}`).catch(() => null);
		return { jobId: job.id, isFavorite: job.isFavorite };
	}

	async deleteJob(jobId: string, userId?: string) {
		const job = await this.jobRepo.findOne({ where: { id: jobId } });
		if (!job) throw new NotFoundException('Job not found');
		if (userId && job.userId && job.userId !== userId) {
			throw new NotFoundException('Job not found');
		}
		await this.leadRepo.delete({ jobId });
		await this.jobRepo.delete({ id: jobId });
		await this.redis.del(`fitness-leads:job:${jobId}`).catch(() => null);
		return { ok: true, jobId };
	}

	/** Mark a failed/interrupted job as done when leads were already saved. */
	async finalizeJob(jobId: string, userId?: string) {
		const job = await this.jobRepo.findOne({ where: { id: jobId } });
		if (!job) throw new NotFoundException('Job not found');
		if (userId && job.userId && job.userId !== userId) {
			throw new NotFoundException('Job not found');
		}
		const savedCount = await this.leadRepo.count({ where: { jobId } });
		if (!savedCount) {
			throw new BadRequestException('No leads to finalize for this job');
		}
		const savedLeads = await this.leadRepo.find({
			where: { jobId },
			order: { createdAt: 'ASC' },
			take: 2000,
		});
		job.status = FitnessLeadsJobStatus.DONE;
		job.progressPercent = 100;
		job.currentStep = 'done';
		job.finishedAt = new Date();
		job.leadsCount = savedCount;
		if (!job.errorMessage) {
			job.errorMessage = 'Finalized with partial results after an interruption.';
		}
		job.steps = (job.steps || []).map((s: any) => {
			if (['enrich_websites', 'save'].includes(s.id) && s.status !== 'done' && s.status !== 'skipped') {
				return {
					...s,
					status: 'done',
					message: s.id === 'save' ? 'Saved partial' : `${savedCount} leads (finalized)`,
					finishedAt: new Date().toISOString(),
				};
			}
			return s;
		});
		await this.jobRepo.save(job);
		await this.cacheJob(job, savedLeads);
		return this.toClient(job, savedLeads);
	}

	private async runJob(jobId: string, apiKey: string) {
		const job = await this.jobRepo.findOne({ where: { id: jobId } });
		if (!job) return;
		job.status = FitnessLeadsJobStatus.RUNNING;
		await this.saveJob(job, 5, 'places_search');

		const country = FITNESS_COUNTRIES[job.countryKey as FitnessCountryKey];
		const knownCities = FITNESS_CITIES[job.countryKey as FitnessCountryKey] || [];

		try {
			await this.setStep(job, 'places_search', 'running');
			let places: any[] = [];
			for (const city of job.cities) {
				for (const category of job.categories) {
					const query = `${category} in ${city}, ${country.name}`;
					const batch = await this.places.textSearch(apiKey, query, country.code, 1);
					places.push(...batch);
					await sleep(900);
					if (places.length >= job.maxPlaces * 2) break;
				}
				const coords = FITNESS_CITY_COORDS[job.countryKey as FitnessCountryKey]?.[city];
				if (coords) {
					const nearby = await this.places.nearbyGridSearch(
						apiKey,
						coords.lat,
						coords.lng,
						3,
						4,
					);
					places.push(...nearby);
				}
				if (places.length >= job.maxPlaces * 2) break;
			}
			places = dedupePlaces(places).slice(0, job.maxPlaces);
			await this.setStep(job, 'places_search', 'done', `${places.length} places`);
			await this.saveJob(job, 35, 'osm_search');

			await this.setStep(job, 'osm_search', job.useOsm ? 'running' : 'skipped');
			if (job.useOsm) {
				for (const city of job.cities) {
					const coords = FITNESS_CITY_COORDS[job.countryKey as FitnessCountryKey]?.[city];
					if (!coords) continue;
					const osmPlaces = await this.osm.search(coords.lat, coords.lng, city);
					places.push(...osmPlaces);
					await sleep(700);
				}
				places = dedupePlaces(places).slice(0, job.maxPlaces);
				await this.setStep(job, 'osm_search', 'done', `${places.length} after OSM`);
			}
			await this.saveJob(job, 50, 'enrich_websites');

			await this.setStep(job, 'enrich_websites', job.enrichWebsites ? 'running' : 'skipped');
			const leads: FitnessLead[] = [];
			let enrichFailures = 0;
			for (let i = 0; i < places.length; i++) {
				const latest = await this.jobRepo.findOne({
					where: { id: jobId },
					select: ['id', 'status'] as any,
				});
				if (!latest || latest.status !== FitnessLeadsJobStatus.RUNNING) {
					this.logger.warn(`Job ${jobId} stopped externally — ending enrich worker`);
					return;
				}
				const place = places[i];
				try {
					const lead = await this.buildLeadFromPlace(job, place, country, knownCities);
					leads.push(await this.leadRepo.save(lead));
				} catch (placeErr: any) {
					enrichFailures += 1;
					this.logger.warn(
						`Lead enrich skipped for "${place?.displayName?.text || 'unknown'}": ${
							placeErr?.message || placeErr
						}`,
					);
					try {
						// Still keep the place as a basic lead (no website enrich).
						const fallback = await this.buildLeadFromPlace(job, place, country, knownCities, {
							skipWebsiteEnrich: true,
						});
						leads.push(await this.leadRepo.save(fallback));
					} catch (fallbackErr: any) {
						this.logger.warn(
							`Could not save fallback lead: ${fallbackErr?.message || fallbackErr}`,
						);
					}
				}

				const pct = 50 + Math.round(((i + 1) / Math.max(places.length, 1)) * 40);
				job.leadsCount = leads.length;
				await this.saveJob(job, pct, 'enrich_websites', leads);
			}
			const enrichMsg =
				enrichFailures > 0
					? `${leads.length} leads (${enrichFailures} enrich issues skipped)`
					: `${leads.length} enriched`;
			await this.setStep(job, 'enrich_websites', 'done', enrichMsg);
			await this.saveJob(job, 95, 'save', leads);

			await this.setStep(job, 'save', 'running');
			job.status = FitnessLeadsJobStatus.DONE;
			job.progressPercent = 100;
			job.currentStep = 'done';
			job.finishedAt = new Date();
			job.leadsCount = leads.length;
			job.errorMessage =
				enrichFailures > 0
					? `Completed with ${enrichFailures} website enrich skip(s). Leads were still saved.`
					: null;
			await this.setStep(job, 'save', 'done', 'Saved');
			await this.saveJob(job, 100, 'done', leads);
		} catch (error: any) {
			this.logger.error(`Fitness leads job ${jobId} failed: ${error?.message || error}`);
			// If we already saved leads, finish as DONE so the UI can use them.
			const savedCount = await this.leadRepo.count({ where: { jobId } });
			if (savedCount > 0) {
				const savedLeads = await this.leadRepo.find({
					where: { jobId },
					order: { createdAt: 'ASC' },
					take: 2000,
				});
				job.status = FitnessLeadsJobStatus.DONE;
				job.progressPercent = 100;
				job.currentStep = 'done';
				job.finishedAt = new Date();
				job.leadsCount = savedCount;
				job.errorMessage = `Completed with partial results after error: ${
					error?.message || 'Job interrupted'
				}`;
				job.steps = (job.steps || []).map((s: any) => {
					if (s.id === 'enrich_websites' && s.status === 'running') {
						return {
							...s,
							status: 'done',
							message: `${savedCount} leads (partial)`,
							finishedAt: new Date().toISOString(),
						};
					}
					if (s.id === 'save' && s.status !== 'done') {
						return {
							...s,
							status: 'done',
							message: 'Saved partial',
							finishedAt: new Date().toISOString(),
						};
					}
					return s;
				});
				await this.jobRepo.save(job);
				await this.cacheJob(job, savedLeads);
				return;
			}
			job.status = FitnessLeadsJobStatus.FAILED;
			job.errorMessage = error?.message || 'Job failed';
			job.finishedAt = new Date();
			await this.jobRepo.save(job);
			await this.cacheJob(job);
		}
	}

	private async buildLeadFromPlace(
		job: FitnessLeadsJob,
		place: any,
		country: { name: string },
		knownCities: string[],
		opts?: { skipWebsiteEnrich?: boolean },
	) {
		const phone = place.internationalPhoneNumber || place.nationalPhoneNumber || '';
		let enrichment = {
			emails: [] as string[],
			sourceUrl: null as string | null,
			social: {
				instagram: '',
				linkedin: '',
				facebook: '',
				twitter: '',
				tiktok: '',
				youtube: '',
				whatsapp: '',
			},
			verification: null as string | null,
			emailSource: null as string | null,
		};
		const websiteUri = place.websiteUri || '';
		if (!opts?.skipWebsiteEnrich && job.enrichWebsites && websiteUri) {
			try {
				enrichment = await this.websiteEnrich.enrichFromWebsite(websiteUri, phone);
			} catch (err: any) {
				this.logger.warn(
					`Website enrich failed for ${websiteUri}: ${err?.message || err}`,
				);
			}
		}
		const osmSocial = place._osmSocial || {};
		enrichment.social = {
			instagram: enrichment.social.instagram || osmSocial.instagram || '',
			linkedin: enrichment.social.linkedin || osmSocial.linkedin || '',
			facebook: enrichment.social.facebook || osmSocial.facebook || '',
			twitter: enrichment.social.twitter || osmSocial.twitter || '',
			tiktok: enrichment.social.tiktok || '',
			youtube: enrichment.social.youtube || osmSocial.youtube || '',
			whatsapp: enrichment.social.whatsapp || osmSocial.whatsapp || '',
		};
		if (!enrichment.social.whatsapp && phone) {
			enrichment.social.whatsapp = extractWhatsAppFromPhone(phone);
		}

		const bestEmail = getBestEmail(enrichment.emails);
		const city = extractCityFromAddress(
			place.formattedAddress || '',
			knownCities,
			job.cities[0] || '',
		);
		const neighborhood = extractNeighborhood(place, city);
		const address = String(
			place.formattedAddress || place.shortFormattedAddress || '',
		).trim();
		const notes = [
			enrichment.emailSource ? `Email source: ${enrichment.emailSource}` : null,
			neighborhood ? `Area: ${neighborhood}` : null,
			place._source ? `Found via: ${place._source}` : null,
			opts?.skipWebsiteEnrich ? 'Enrich skipped (site error)' : null,
		]
			.filter(Boolean)
			.join(' | ');

		return this.leadRepo.create({
			jobId: job.id,
			userId: job.userId,
			businessName: place.displayName?.text || 'Unknown',
			businessType: classifyBusinessType(place.displayName?.text),
			email: bestEmail,
			country: country.name,
			city,
			neighborhood: neighborhood || null,
			address: address || null,
			website: websiteUri || null,
			sourceUrl: enrichment.sourceUrl || place.googleMapsUri || null,
			linkedinUrl: enrichment.social.linkedin || null,
			instagramUrl: enrichment.social.instagram || null,
			facebookUrl: enrichment.social.facebook || null,
			twitterUrl: enrichment.social.twitter || null,
			tiktokUrl: enrichment.social.tiktok || null,
			youtubeUrl: enrichment.social.youtube || null,
			whatsappUrl: enrichment.social.whatsapp || null,
			emailType: bestEmail ? classifyEmailType(bestEmail) : null,
			verificationStatus: bestEmail
				? enrichment.verification ||
					getVerificationStatus(bestEmail, Boolean(enrichment.sourceUrl))
				: 'No Email Found',
			notes: notes || null,
			phone: phone || null,
			foundVia: place._source || null,
		});
	}

	private async setStep(job: FitnessLeadsJob, id: string, status: string, message?: string) {
		job.steps = (job.steps || []).map((s: any) =>
			s.id === id
				? {
						...s,
						status,
						message: message || null,
						finishedAt:
							status === 'done' || status === 'failed' || status === 'skipped'
								? new Date().toISOString()
								: s.finishedAt || null,
					}
				: s,
		);
		job.currentStep = id;
		await this.jobRepo.save(job);
		await this.cacheJob(job);
	}

	private async saveJob(
		job: FitnessLeadsJob,
		percent: number,
		step: string,
		leads?: FitnessLead[],
	) {
		job.progressPercent = percent;
		job.currentStep = step;
		await this.jobRepo.save(job);
		await this.cacheJob(job, leads);
	}

	private async cacheJob(job: FitnessLeadsJob, leads?: FitnessLead[]) {
		let items = leads;
		if (!items) {
			items = await this.leadRepo.find({
				where: { jobId: job.id },
				order: { createdAt: 'DESC' },
				take: 300,
			});
		}
		const payload = this.toClient(job, items);
		this.memory.set(job.id, payload);
		await this.redis.set(`fitness-leads:job:${job.id}`, payload, 60 * 60 * 6);
	}

	private toClient(job: FitnessLeadsJob, leads: FitnessLead[]) {
		return {
			jobId: job.id,
			status: job.status,
			progressPercent: job.progressPercent,
			currentStep: job.currentStep,
			steps: job.steps,
			countryKey: job.countryKey,
			cities: job.cities,
			categories: job.categories,
			leadsCount: job.leadsCount || leads.length,
			errorMessage: job.errorMessage,
			userId: job.userId,
			leads: leads.map(l => this.mapLead(l)),
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
			finishedAt: job.finishedAt,
		};
	}

	private mapLead(l: FitnessLead) {
		return {
			id: l.id,
			businessName: l.businessName,
			businessType: l.businessType,
			email: l.email,
			country: l.country,
			city: l.city,
			neighborhood: l.neighborhood,
			address: l.address,
			website: l.website,
			sourceUrl: l.sourceUrl,
			linkedinUrl: l.linkedinUrl,
			instagramUrl: l.instagramUrl,
			facebookUrl: l.facebookUrl,
			twitterUrl: l.twitterUrl,
			tiktokUrl: l.tiktokUrl,
			youtubeUrl: l.youtubeUrl,
			whatsappUrl: l.whatsappUrl,
			emailType: l.emailType,
			verificationStatus: l.verificationStatus,
			notes: l.notes,
			phone: l.phone,
			foundVia: l.foundVia,
			createdAt: l.createdAt,
		};
	}
}
