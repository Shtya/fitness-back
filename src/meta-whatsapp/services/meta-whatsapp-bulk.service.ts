import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FitnessLead } from '../../fitness-leads/entities/fitness-leads.entity';
import {
	MetaWaBulkItemStatus,
	MetaWaBulkJobStatus,
	MetaWaMessageDirection,
	MetaWaMessageStatus,
	MetaWhatsAppBulkItem,
	MetaWhatsAppBulkJob,
	MetaWhatsAppConversation,
	MetaWhatsAppMessage,
} from '../entities/meta-whatsapp.entity';
import { CheckMetaBulkPhonesDto, StartMetaBulkDto } from '../dto/meta-whatsapp.dto';
import { normalizeWaId } from './meta-whatsapp-crypto.service';
import { MetaWhatsAppConfigService } from './meta-whatsapp-config.service';
import { MetaWhatsAppMessagingService } from './meta-whatsapp-messaging.service';
import { MetaWhatsAppActivityService } from './meta-whatsapp-activity.service';

const ALREADY_SENT_REASON = 'Already sent';

@Injectable()
export class MetaWhatsAppBulkService {
	private readonly logger = new Logger(MetaWhatsAppBulkService.name);
	private running = false;
	/** Live pacing info for UI countdown (not persisted). */
	private readonly paceByJob = new Map<
		string,
		{
			phase: 'sending' | 'waiting' | 'idle';
			delayMs: number;
			nextSendAt: number | null;
			waitStartedAt: number | null;
			currentDisplayName: string | null;
			lastDisplayName: string | null;
		}
	>();

	constructor(
		@InjectRepository(MetaWhatsAppBulkJob)
		private readonly jobRepo: Repository<MetaWhatsAppBulkJob>,
		@InjectRepository(MetaWhatsAppBulkItem)
		private readonly itemRepo: Repository<MetaWhatsAppBulkItem>,
		@InjectRepository(MetaWhatsAppConversation)
		private readonly conversationRepo: Repository<MetaWhatsAppConversation>,
		@InjectRepository(MetaWhatsAppMessage)
		private readonly messageRepo: Repository<MetaWhatsAppMessage>,
		@InjectRepository(FitnessLead)
		private readonly leadRepo: Repository<FitnessLead>,
		private readonly configService: MetaWhatsAppConfigService,
		private readonly messaging: MetaWhatsAppMessagingService,
		private readonly activity: MetaWhatsAppActivityService,
	) {}

	async start(userId: string, dto: StartMetaBulkDto) {
		await this.configService.requireRuntime({ requireEnabled: true });
		const templateName = String(dto.templateName || '').trim();
		if (!templateName) throw new BadRequestException('Template name is required');

		const jobId = String(dto.jobId || '').trim();
		const hasRecipients = Boolean(dto.recipients?.length);
		if (!jobId && !hasRecipients) {
			throw new BadRequestException('Provide jobId (Lead Scout sheet) or recipients');
		}

		const recipients = jobId
			? await this.recipientsFromJob(jobId)
			: await this.normalizeRecipients(dto.recipients || []);
		if (!recipients.length) {
			throw new BadRequestException('No recipients with valid phone numbers');
		}

		const previouslySent = await this.previouslySentWaIds(recipients.map(r => r.waId));
		const toSend = recipients.filter(r => !previouslySent.has(r.waId));
		const toSkip = recipients.filter(r => previouslySent.has(r.waId));

		const allSkipped = toSend.length === 0;
		const job = this.jobRepo.create({
			status: allSkipped ? MetaWaBulkJobStatus.DONE : MetaWaBulkJobStatus.RUNNING,
			createdBy: userId || null,
			templateName,
			templateLanguage: (dto.language || 'en').trim(),
			templateComponents: {
				static: dto.components || null,
				variableMap: dto.variableMap || null,
			},
			totalCount: recipients.length,
			skippedCount: toSkip.length,
			sentCount: 0,
			failedCount: 0,
			rateLimitPerMinute: dto.rateLimitPerMinute || 10,
			startedAt: new Date(),
			finishedAt: allSkipped ? new Date() : null,
		});
		await this.jobRepo.save(job);

		if (!allSkipped) {
			this.paceByJob.set(job.id, {
				phase: 'sending',
				delayMs: Math.max(1000, Math.floor(60000 / Math.max(job.rateLimitPerMinute || 1, 1))),
				nextSendAt: null,
				waitStartedAt: null,
				currentDisplayName: toSend[0]?.displayName || toSend[0]?.waId || null,
				lastDisplayName: null,
			});
		}

		const items = [
			...toSend.map(r =>
				this.itemRepo.create({
					jobId: job.id,
					leadId: r.leadId,
					waId: r.waId,
					displayName: r.displayName,
					status: MetaWaBulkItemStatus.QUEUED,
				}),
			),
			...toSkip.map(r =>
				this.itemRepo.create({
					jobId: job.id,
					leadId: r.leadId,
					waId: r.waId,
					displayName: r.displayName,
					status: MetaWaBulkItemStatus.SKIPPED,
					errorMessage: ALREADY_SENT_REASON,
				}),
			),
		];
		await this.itemRepo.save(items);

		await this.activity.log('bulk.started', userId, {
			jobId: job.id,
			leadJobId: jobId || null,
			total: recipients.length,
			toSend: toSend.length,
			skippedAlreadySent: toSkip.length,
			templateName,
		});

		if (!allSkipped) void this.processQueue();
		return this.getJob(job.id);
	}

	/** Preview which phones were already messaged successfully. */
	async checkPhones(dto: CheckMetaBulkPhonesDto) {
		const phones = Array.isArray(dto?.phones) ? dto.phones : [];
		const normalized = phones
			.map(p => ({ raw: String(p || ''), waId: normalizeWaId(p) }))
			.filter(x => x.waId);
		const uniqueWa = [...new Set(normalized.map(x => x.waId!))];
		const contacted = await this.previouslySentWaIds(uniqueWa);
		return {
			total: uniqueWa.length,
			contactedCount: contacted.size,
			newCount: uniqueWa.length - contacted.size,
			phones: normalized.map(x => ({
				phone: x.raw,
				waId: x.waId,
				alreadySent: contacted.has(x.waId!),
			})),
			contactedWaIds: [...contacted],
		};
	}

	async getJob(jobId: string) {
		const job = await this.jobRepo.findOne({ where: { id: jobId } });
		if (!job) throw new NotFoundException('Bulk job not found');

		// Resume worker only if job is active and no in-memory pace (worker died)
		const hasPace = this.paceByJob.has(jobId);
		if (
			!this.running &&
			!hasPace &&
			(job.status === MetaWaBulkJobStatus.QUEUED ||
				job.status === MetaWaBulkJobStatus.RUNNING)
		) {
			void this.processQueue();
		}

		const items = await this.itemRepo.find({
			where: { jobId },
			order: { updatedAt: 'DESC' },
			take: 2000,
		});

		const counts = {
			queued: 0,
			sending: 0,
			sent: 0,
			failed: 0,
			skipped: 0,
		};
		for (const it of items) {
			const s = String(it.status || '');
			if (s in counts) counts[s as keyof typeof counts] += 1;
		}

		const sorted = [...items].sort((a, b) => {
			const rank = (s: string, err?: string | null) => {
				if (s === MetaWaBulkItemStatus.SENDING) return 0;
				if (s === MetaWaBulkItemStatus.SENT) return 1;
				if (
					s === MetaWaBulkItemStatus.SKIPPED &&
					String(err || '').includes(ALREADY_SENT_REASON)
				) {
					return 1.5;
				}
				if (s === MetaWaBulkItemStatus.FAILED) return 2;
				if (s === MetaWaBulkItemStatus.SKIPPED) return 3;
				return 4;
			};
			const d = rank(a.status, a.errorMessage) - rank(b.status, b.errorMessage);
			if (d !== 0) return d;
			return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
		});

		return {
			...this.serializeJob(job),
			// Prefer item-derived counters for the live UI
			sentCount: counts.sent,
			failedCount: counts.failed,
			skippedCount: counts.skipped,
			items: sorted.map(it => ({
				id: it.id,
				jobId: it.jobId,
				leadId: it.leadId,
				waId: it.waId,
				displayName: it.displayName,
				status: it.status,
				messageId: it.messageId,
				wamid: it.wamid,
				errorMessage: it.errorMessage,
				attemptCount: it.attemptCount,
				createdAt: it.createdAt,
				updatedAt: it.updatedAt,
			})),
			itemCounts: counts,
			workerRunning: this.running,
		};
	}

	async listJobs(limit = 30) {
		const jobs = await this.jobRepo.find({
			order: { createdAt: 'DESC' },
			take: Math.min(Math.max(limit, 1), 100),
		});
		return jobs.map(j => this.serializeJob(j));
	}

	async cancel(userId: string, jobId: string) {
		const job = await this.jobRepo.findOne({ where: { id: jobId } });
		if (!job) throw new NotFoundException('Bulk job not found');
		if (
			job.status === MetaWaBulkJobStatus.DONE ||
			job.status === MetaWaBulkJobStatus.CANCELLED
		) {
			return this.getJob(jobId);
		}
		job.status = MetaWaBulkJobStatus.CANCELLED;
		job.finishedAt = new Date();
		await this.jobRepo.save(job);
		this.paceByJob.delete(jobId);
		await this.itemRepo.update(
			{ jobId, status: In([MetaWaBulkItemStatus.QUEUED, MetaWaBulkItemStatus.SENDING]) },
			{ status: MetaWaBulkItemStatus.SKIPPED, errorMessage: 'Cancelled' },
		);
		await this.activity.log('bulk.cancelled', userId, { jobId });
		return this.getJob(jobId);
	}

	private async processQueue() {
		if (this.running) return;
		this.running = true;
		try {
			while (true) {
				const job = await this.jobRepo.findOne({
					where: {
						status: In([MetaWaBulkJobStatus.QUEUED, MetaWaBulkJobStatus.RUNNING]),
					},
					order: { createdAt: 'ASC' },
				});
				if (!job || job.status === MetaWaBulkJobStatus.CANCELLED) break;

				try {
					// Only recover items stuck in "sending" for > 2 minutes (avoid wiping live sends)
					await this.itemRepo
						.createQueryBuilder()
						.update(MetaWhatsAppBulkItem)
						.set({ status: MetaWaBulkItemStatus.QUEUED })
						.where('job_id = :jobId', { jobId: job.id })
						.andWhere('status = :status', { status: MetaWaBulkItemStatus.SENDING })
						.andWhere('updated_at < :stale', {
							stale: new Date(Date.now() - 2 * 60 * 1000),
						})
						.execute();

					job.status = MetaWaBulkJobStatus.RUNNING;
					job.startedAt = job.startedAt || new Date();
					await this.jobRepo.save(job);

					const delayMs = Math.max(
						1000,
						Math.floor(60000 / Math.max(job.rateLimitPerMinute || 1, 1)),
					);
					const maxAttempts = 3;

					while (true) {
						const fresh = await this.jobRepo.findOne({ where: { id: job.id } });
						if (!fresh || fresh.status === MetaWaBulkJobStatus.CANCELLED) break;

						const item = await this.itemRepo.findOne({
							where: { jobId: job.id, status: MetaWaBulkItemStatus.QUEUED },
							order: { createdAt: 'ASC' },
						});
						if (!item) {
							fresh.status = MetaWaBulkJobStatus.DONE;
							fresh.finishedAt = new Date();
							await this.jobRepo.save(fresh);
							await this.activity.log('bulk.completed', fresh.createdBy, {
								jobId: fresh.id,
								sent: fresh.sentCount,
								failed: fresh.failedCount,
								skipped: fresh.skippedCount,
							});
							break;
						}

						let already = new Set<string>();
						try {
							already = await this.previouslySentWaIds([item.waId], job.id);
						} catch (err: any) {
							this.logger.warn(
								`previouslySentWaIds failed (continuing send): ${err?.message || err}`,
							);
						}
						if (already.has(item.waId)) {
							item.status = MetaWaBulkItemStatus.SKIPPED;
							item.errorMessage = ALREADY_SENT_REASON;
							await this.itemRepo.save(item);
							await this.jobRepo.increment({ id: fresh.id }, 'skippedCount', 1);
							fresh.skippedCount = Number(fresh.skippedCount || 0) + 1;
							continue;
						}

						item.status = MetaWaBulkItemStatus.SENDING;
						item.attemptCount += 1;
						await this.itemRepo.save(item);
						this.paceByJob.set(job.id, {
							phase: 'sending',
							delayMs,
							nextSendAt: null,
							waitStartedAt: null,
							currentDisplayName: item.displayName || item.waId,
							lastDisplayName: item.displayName || item.waId,
						});

						let alreadyWaited = false;
						try {
							const components = await this.resolveComponentsForItem(fresh, item);
							const message = await this.messaging.sendTemplate(
								fresh.createdBy || '',
								{
									leadId: item.leadId || undefined,
									phone: item.waId,
									templateName: fresh.templateName,
									language: fresh.templateLanguage,
									components,
								},
							);
							item.status = MetaWaBulkItemStatus.SENT;
							item.messageId = message.id;
							item.wamid = message.wamid;
							item.errorMessage = null;
							await this.itemRepo.save(item);
							await this.jobRepo.increment({ id: fresh.id }, 'sentCount', 1);
							fresh.sentCount = Number(fresh.sentCount || 0) + 1;
						} catch (error) {
							const errMsg =
								error instanceof Error ? error.message : 'Send failed';
							if (item.attemptCount < maxAttempts && this.isRetryable(error)) {
								item.status = MetaWaBulkItemStatus.QUEUED;
								item.errorMessage = `Retry ${item.attemptCount}: ${errMsg}`;
								this.logger.warn(`Bulk item ${item.id} will retry: ${errMsg}`);
								await this.itemRepo.save(item);
								const waitMs = delayMs * 2;
								const waitStartedAt = Date.now();
								this.paceByJob.set(job.id, {
									phase: 'waiting',
									delayMs: waitMs,
									nextSendAt: waitStartedAt + waitMs,
									waitStartedAt,
									currentDisplayName: item.displayName || item.waId,
									lastDisplayName: item.displayName || item.waId,
								});
								await this.sleepInterruptible(waitMs, job.id);
								alreadyWaited = true;
							} else {
								item.status = MetaWaBulkItemStatus.FAILED;
								item.errorMessage = errMsg;
								await this.itemRepo.save(item);
								await this.jobRepo.increment({ id: fresh.id }, 'failedCount', 1);
								fresh.failedCount = Number(fresh.failedCount || 0) + 1;
								this.logger.warn(`Bulk item ${item.id} failed: ${errMsg}`);
							}
						}

						if (!alreadyWaited) {
							// Ensure latest counters are visible to pollers
							const latest = await this.jobRepo.findOne({ where: { id: job.id } });
							if (latest) {
								fresh.sentCount = latest.sentCount;
								fresh.failedCount = latest.failedCount;
								fresh.skippedCount = latest.skippedCount;
								fresh.status = latest.status;
							}
						}

						const cancelled = await this.jobRepo.findOne({ where: { id: job.id } });
						if (!cancelled || cancelled.status === MetaWaBulkJobStatus.CANCELLED) {
							break;
						}

						const queuedLeft = await this.itemRepo.count({
							where: { jobId: job.id, status: MetaWaBulkItemStatus.QUEUED },
						});
						if (queuedLeft > 0 && !alreadyWaited) {
							const waitStartedAt = Date.now();
							this.paceByJob.set(job.id, {
								phase: 'waiting',
								delayMs,
								nextSendAt: waitStartedAt + delayMs,
								waitStartedAt,
								currentDisplayName: item.displayName || item.waId,
								lastDisplayName: item.displayName || item.waId,
							});
							await this.sleepInterruptible(delayMs, job.id);
						} else if (queuedLeft === 0) {
							this.paceByJob.set(job.id, {
								phase: 'idle',
								delayMs,
								nextSendAt: null,
								waitStartedAt: null,
								currentDisplayName: null,
								lastDisplayName: item.displayName || item.waId,
							});
						}
					}
				} catch (err: any) {
					this.logger.error(
						`Bulk job ${job.id} worker crashed: ${err?.message || err}`,
						err?.stack,
					);
					try {
						job.status = MetaWaBulkJobStatus.FAILED;
						job.errorMessage = err instanceof Error ? err.message : String(err);
						job.finishedAt = new Date();
						await this.jobRepo.save(job);
					} catch {
						/* ignore */
					}
				} finally {
					this.paceByJob.delete(job.id);
				}
			}
		} finally {
			this.running = false;
		}
	}

	private async previouslySentWaIds(
		waIds: string[],
		excludeJobId?: string,
	): Promise<Set<string>> {
		const ids = [...new Set((waIds || []).map(id => String(id || '').trim()).filter(Boolean))];
		if (!ids.length) return new Set();

		const contacted = new Set<string>();

		try {
			const bulkQb = this.itemRepo
				.createQueryBuilder('i')
				.select('DISTINCT i.wa_id', 'waId')
				.where('i.status IN (:...statuses)', {
					statuses: [MetaWaBulkItemStatus.SENT, MetaWaBulkItemStatus.SENDING],
				})
				.andWhere('i.wa_id IN (:...ids)', { ids });
			if (excludeJobId) {
				bulkQb.andWhere('i.job_id != :excludeJobId', { excludeJobId });
			}
			const bulkRows = await bulkQb.getRawMany<{ waId: string }>();
			for (const row of bulkRows) {
				if (row.waId) contacted.add(row.waId);
			}
		} catch (err: any) {
			this.logger.warn(`bulk previously-sent lookup failed: ${err?.message || err}`);
		}

		try {
			const msgRows = await this.messageRepo
				.createQueryBuilder('m')
				.innerJoin(
					'meta_whatsapp_conversations',
					'c',
					'c.id = m.conversation_id',
				)
				.select('DISTINCT c.wa_id', 'waId')
				.where('m.direction = :direction', {
					direction: MetaWaMessageDirection.OUTBOUND,
				})
				.andWhere('m.status IN (:...msgStatuses)', {
					msgStatuses: [
						MetaWaMessageStatus.SENT,
						MetaWaMessageStatus.DELIVERED,
						MetaWaMessageStatus.READ,
					],
				})
				.andWhere('c.wa_id IN (:...ids)', { ids })
				.getRawMany<{ waId: string }>();
			for (const row of msgRows) {
				if (row.waId) contacted.add(row.waId);
			}
		} catch (err: any) {
			this.logger.warn(`message previously-sent lookup failed: ${err?.message || err}`);
		}

		return contacted;
	}

	private isRetryable(error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		return /rate|throttle|timeout|temporar|5\d\d|try again/i.test(msg);
	}

	/** Sleep in short slices so Cancel can take effect without waiting the full delay. */
	private async sleepInterruptible(ms: number, jobId: string) {
		const end = Date.now() + Math.max(0, ms);
		while (Date.now() < end) {
			const fresh = await this.jobRepo.findOne({ where: { id: jobId } });
			if (!fresh || fresh.status === MetaWaBulkJobStatus.CANCELLED) return;
			const slice = Math.min(1000, end - Date.now());
			if (slice <= 0) return;
			await this.sleep(slice);
		}
	}

	private async recipientsFromJob(jobId: string) {
		const leads = await this.leadRepo.find({
			where: { jobId },
			order: { createdAt: 'ASC' },
		});
		if (!leads.length) {
			throw new BadRequestException('Lead Scout sheet not found or has no rows');
		}
		return this.normalizeRecipients(
			leads.map(l => ({
				leadId: l.id,
				phone: l.phone || undefined,
				displayName: l.businessName || undefined,
			})),
		);
	}

	private async normalizeRecipients(
		recipients: Array<{ leadId?: string; phone?: string; displayName?: string }>,
	) {
		const out: Array<{ leadId: string | null; waId: string; displayName: string | null }> = [];
		const seen = new Set<string>();

		for (const r of recipients) {
			let lead: FitnessLead | null = null;
			if (r.leadId) {
				lead = await this.leadRepo.findOne({ where: { id: r.leadId } });
			}
			const waId = normalizeWaId(r.phone || lead?.phone);
			if (!waId || seen.has(waId)) continue;
			seen.add(waId);
			out.push({
				leadId: lead?.id || r.leadId || null,
				waId,
				displayName: r.displayName || lead?.businessName || waId,
			});
		}
		return out;
	}

	private async resolveComponentsForItem(
		job: MetaWhatsAppBulkJob,
		item: MetaWhatsAppBulkItem,
	) {
		const stored = job.templateComponents;
		const staticComponents = Array.isArray(stored)
			? stored
			: Array.isArray(stored?.static)
				? stored.static
				: null;
		const variableMap =
			stored && !Array.isArray(stored) && stored.variableMap
				? (stored.variableMap as Record<string, string>)
				: null;

		let lead: FitnessLead | null = null;
		if (item.leadId) {
			lead = await this.leadRepo.findOne({ where: { id: item.leadId } });
		}

		// Prefer per-lead variable map so {{1}} becomes business name, etc.
		if (variableMap && Object.keys(variableMap).length) {
			return this.buildComponentsFromVariableMap(variableMap, lead, item);
		}

		// Auto-fill from Meta template definition when map was not provided.
		try {
			const templates = await this.configService.listTemplates();
			const def =
				templates.find(
					(t: any) =>
						t.name === job.templateName &&
						String(t.language || '') === String(job.templateLanguage || ''),
				) || templates.find((t: any) => t.name === job.templateName);
			const autoMap = this.autoVariableMapFromTemplate(def?.components);
			if (Object.keys(autoMap).length) {
				return this.buildComponentsFromVariableMap(autoMap, lead, item);
			}
		} catch (err: any) {
			this.logger.warn(`Could not auto-map template vars: ${err?.message || err}`);
		}

		return staticComponents || undefined;
	}

	private autoVariableMapFromTemplate(components: any[] | undefined) {
		const map: Record<string, string> = {};
		const defaults = ['businessName', 'city', 'businessType', 'country', 'phone'];
		for (const c of components || []) {
			const type = String(c?.type || '').toUpperCase();
			if (type === 'BODY' || type === 'HEADER') {
				const idxs = this.placeholderIndexes(c.text);
				idxs.forEach((n, i) => {
					map[`${type}:${n}`] = defaults[i] || 'businessName';
				});
			}
			if (type === 'BUTTONS' && Array.isArray(c.buttons)) {
				c.buttons.forEach((btn: any, bi: number) => {
					if (String(btn?.type || '').toUpperCase() !== 'URL') return;
					const idxs = this.placeholderIndexes(btn.url);
					idxs.forEach(n => {
						map[`BUTTON:${bi}:${n}`] = 'websitePath';
					});
				});
			}
		}
		return map;
	}

	private placeholderIndexes(text: string | undefined) {
		return [
			...new Set(
				[...String(text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => Number(m[1])),
			),
		].sort((a, b) => a - b);
	}

	private buildComponentsFromVariableMap(
		variableMap: Record<string, string>,
		lead: FitnessLead | null,
		item: MetaWhatsAppBulkItem,
	) {
		const values = this.leadFieldValues(lead, item);
		const body: Array<{ type: string; text: string; _index: number }> = [];
		const header: Array<{ type: string; text: string; _index: number }> = [];
		const buttonGroups: Record<string, Array<{ type: string; text: string }>> = {};

		for (const [key, field] of Object.entries(variableMap || {})) {
			const text = this.resolveFieldValue(values, field);
			if (!text) {
				throw new BadRequestException(
					`Missing value for template variable ${key} (mapped to ${field})`,
				);
			}
			if (key.startsWith('BODY:')) {
				body.push({ type: 'text', text, _index: Number(key.split(':')[1]) || 0 });
			} else if (key.startsWith('HEADER:')) {
				header.push({ type: 'text', text, _index: Number(key.split(':')[1]) || 0 });
			} else if (key.startsWith('BUTTON:')) {
				const parts = key.split(':');
				const bi = String(parts[1] ?? 0);
				if (!buttonGroups[bi]) buttonGroups[bi] = [];
				buttonGroups[bi].push({ type: 'text', text });
			}
		}

		const components: any[] = [];
		if (header.length) {
			header.sort((a, b) => a._index - b._index);
			components.push({
				type: 'header',
				parameters: header.map(({ type, text }) => ({ type, text })),
			});
		}
		if (body.length) {
			body.sort((a, b) => a._index - b._index);
			components.push({
				type: 'body',
				parameters: body.map(({ type, text }) => ({ type, text })),
			});
		}
		Object.keys(buttonGroups)
			.sort((a, b) => Number(a) - Number(b))
			.forEach(index => {
				components.push({
					type: 'button',
					sub_type: 'url',
					index,
					parameters: buttonGroups[index],
				});
			});

		return components.length ? components : undefined;
	}

	private leadFieldValues(lead: FitnessLead | null, item: MetaWhatsAppBulkItem) {
		const website = String(lead?.website || '').trim();
		let websitePath = '';
		try {
			if (website) {
				const u = new URL(website.startsWith('http') ? website : `https://${website}`);
				websitePath = (u.pathname.replace(/^\//, '') || u.hostname).slice(0, 40);
			}
		} catch {
			websitePath = website.replace(/^https?:\/\//i, '').slice(0, 40);
		}
		return {
			businessName: lead?.businessName || item.displayName || (lead?.city ? `Gym ${lead.city}` : 'there'),
			businessType: lead?.businessType || '',
			city: lead?.city || '',
			country: lead?.country || '',
			neighborhood: lead?.neighborhood || '',
			phone: lead?.phone || item.waId || '',
			email: lead?.email || '',
			website: website || '',
			websitePath: websitePath || 'demo',
			address: lead?.address || '',
			displayName: item.displayName || lead?.businessName || '',
		};
	}

	private resolveFieldValue(
		values: Record<string, string>,
		field: string,
	) {
		const key = String(field || '').trim();
		if (!key) return '';
		if (key in values) return String(values[key] || '').trim();
		// Allow literal values prefixed with =
		if (key.startsWith('=')) return key.slice(1).trim();
		return '';
	}

	private serializeJob(job: MetaWhatsAppBulkJob) {
		const pace = this.paceByJob.get(job.id);
		const delayMs =
			pace?.delayMs ??
			Math.max(1000, Math.floor(60000 / Math.max(job.rateLimitPerMinute || 10, 1)));
		return {
			id: job.id,
			status: job.status,
			createdBy: job.createdBy,
			templateName: job.templateName,
			templateLanguage: job.templateLanguage,
			templateComponents: job.templateComponents,
			totalCount: job.totalCount,
			sentCount: job.sentCount,
			failedCount: job.failedCount,
			skippedCount: job.skippedCount,
			rateLimitPerMinute: job.rateLimitPerMinute,
			delayMs,
			pacePhase: pace?.phase || (job.status === MetaWaBulkJobStatus.RUNNING ? 'sending' : 'idle'),
			nextSendAt: pace?.nextSendAt || null,
			waitStartedAt: pace?.waitStartedAt || null,
			currentDisplayName: pace?.currentDisplayName || null,
			lastDisplayName: pace?.lastDisplayName || null,
			serverNow: Date.now(),
			errorMessage: job.errorMessage,
			startedAt: job.startedAt,
			finishedAt: job.finishedAt,
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
		};
	}

	private sleep(ms: number) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
