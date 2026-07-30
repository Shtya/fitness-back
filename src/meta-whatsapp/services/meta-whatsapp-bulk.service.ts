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
	MetaWhatsAppBulkItem,
	MetaWhatsAppBulkJob,
} from '../entities/meta-whatsapp.entity';
import { StartMetaBulkDto } from '../dto/meta-whatsapp.dto';
import { normalizeWaId } from './meta-whatsapp-crypto.service';
import { MetaWhatsAppConfigService } from './meta-whatsapp-config.service';
import { MetaWhatsAppMessagingService } from './meta-whatsapp-messaging.service';
import { MetaWhatsAppActivityService } from './meta-whatsapp-activity.service';

@Injectable()
export class MetaWhatsAppBulkService {
	private readonly logger = new Logger(MetaWhatsAppBulkService.name);
	private running = false;

	constructor(
		@InjectRepository(MetaWhatsAppBulkJob)
		private readonly jobRepo: Repository<MetaWhatsAppBulkJob>,
		@InjectRepository(MetaWhatsAppBulkItem)
		private readonly itemRepo: Repository<MetaWhatsAppBulkItem>,
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
		if (!dto.recipients?.length) {
			throw new BadRequestException('At least one recipient is required');
		}

		const recipients = await this.normalizeRecipients(dto.recipients);
		if (!recipients.length) {
			throw new BadRequestException('No recipients with valid phone numbers');
		}

		const job = this.jobRepo.create({
			status: MetaWaBulkJobStatus.QUEUED,
			createdBy: userId || null,
			templateName,
			templateLanguage: (dto.language || 'en').trim(),
			templateComponents: dto.components || null,
			totalCount: recipients.length,
			rateLimitPerMinute: dto.rateLimitPerMinute || 20,
		});
		await this.jobRepo.save(job);

		const items = recipients.map(r =>
			this.itemRepo.create({
				jobId: job.id,
				leadId: r.leadId,
				waId: r.waId,
				displayName: r.displayName,
				status: MetaWaBulkItemStatus.QUEUED,
			}),
		);
		await this.itemRepo.save(items);

		await this.activity.log('bulk.started', userId, {
			jobId: job.id,
			total: recipients.length,
			templateName,
		});

		void this.processQueue();
		return this.getJob(job.id);
	}

	async getJob(jobId: string) {
		const job = await this.jobRepo.findOne({ where: { id: jobId } });
		if (!job) throw new NotFoundException('Bulk job not found');
		const items = await this.itemRepo.find({
			where: { jobId },
			order: { createdAt: 'ASC' },
			take: 500,
		});
		return { ...this.serializeJob(job), items };
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
		await this.itemRepo.update(
			{ jobId, status: MetaWaBulkItemStatus.QUEUED },
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

				job.status = MetaWaBulkJobStatus.RUNNING;
				job.startedAt = job.startedAt || new Date();
				await this.jobRepo.save(job);

				const delayMs = Math.max(1000, Math.floor(60000 / Math.max(job.rateLimitPerMinute, 1)));
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

					item.status = MetaWaBulkItemStatus.SENDING;
					item.attemptCount += 1;
					await this.itemRepo.save(item);

					try {
						const message = await this.messaging.sendTemplate(fresh.createdBy || '', {
							leadId: item.leadId || undefined,
							phone: item.waId,
							templateName: fresh.templateName,
							language: fresh.templateLanguage,
							components: fresh.templateComponents || undefined,
						});
						item.status = MetaWaBulkItemStatus.SENT;
						item.messageId = message.id;
						item.wamid = message.wamid;
						item.errorMessage = null;
						fresh.sentCount += 1;
					} catch (error) {
						const errMsg = error instanceof Error ? error.message : 'Send failed';
						if (item.attemptCount < maxAttempts && this.isRetryable(error)) {
							item.status = MetaWaBulkItemStatus.QUEUED;
							item.errorMessage = `Retry ${item.attemptCount}: ${errMsg}`;
							this.logger.warn(`Bulk item ${item.id} will retry: ${errMsg}`);
							await this.sleep(delayMs * 2);
						} else {
							item.status = MetaWaBulkItemStatus.FAILED;
							item.errorMessage = errMsg;
							fresh.failedCount += 1;
						}
					}

					await this.itemRepo.save(item);
					await this.jobRepo.save(fresh);
					await this.sleep(delayMs);
				}
			}
		} finally {
			this.running = false;
		}
	}

	private isRetryable(error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		return /rate|throttle|timeout|temporar|5\d\d|try again/i.test(msg);
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

	private serializeJob(job: MetaWhatsAppBulkJob) {
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
