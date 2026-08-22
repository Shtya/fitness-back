import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	CreateWhatsAppMessageScheduleDto,
	UpdateWhatsAppMessageScheduleDto,
} from '../dto/whatsapp-schedule.dto';
import {
	WhatsAppMessageSchedule,
	WhatsAppMessageScheduleDelivery,
	WhatsAppMessageScheduleDeliveryStatus,
	WhatsAppMessageScheduleKind,
	WhatsAppMessageScheduleRecipient,
	WhatsAppMessageScheduleRecipientStatus,
	WhatsAppMessageScheduleRun,
	WhatsAppMessageScheduleRunStatus,
	WhatsAppMessageScheduleStatus,
} from '../entities/whatsapp.entity';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import {
	computeInitialNextRunAt,
	computeNextRecurringRunAt,
	everyDayOfWeek,
	normalizeDaysOfWeek,
} from '../utils/whatsapp-schedule-time';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';
import { WhatsAppSyncService } from './whatsapp-sync.service';

const MAX_RECIPIENTS = 50;
const DELAY_BETWEEN_RECIPIENTS_MS = 2500;
const DUE_BATCH_SIZE = 20;

@Injectable()
export class WhatsAppMessageSchedulesService {
	private readonly logger = new Logger(WhatsAppMessageSchedulesService.name);
	private processing = false;

	constructor(
		@InjectRepository(WhatsAppMessageSchedule)
		private readonly scheduleRepo: Repository<WhatsAppMessageSchedule>,
		@InjectRepository(WhatsAppMessageScheduleRecipient)
		private readonly recipientRepo: Repository<WhatsAppMessageScheduleRecipient>,
		@InjectRepository(WhatsAppMessageScheduleRun)
		private readonly runRepo: Repository<WhatsAppMessageScheduleRun>,
		@InjectRepository(WhatsAppMessageScheduleDelivery)
		private readonly deliveryRepo: Repository<WhatsAppMessageScheduleDelivery>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		private readonly access: WhatsAppAccessService,
		private readonly sync: WhatsAppSyncService,
		private readonly audit: WhatsAppAuditService,
		private readonly gateway: WhatsAppGateway,
	) {}

	async create(user: User, accountId: string, dto: CreateWhatsAppMessageScheduleDto) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send access denied');

		const conversationIds = [...new Set(dto.conversationIds.map(id => String(id)))];
		if (!conversationIds.length || conversationIds.length > MAX_RECIPIENTS) {
			throw new BadRequestException(`Select between 1 and ${MAX_RECIPIENTS} chats`);
		}

		for (const conversationId of conversationIds) {
			const visible = await this.access.assertConversationVisible(user, conversationId);
			if (visible.conversation.accountId !== accountId) {
				throw new BadRequestException('All selected chats must belong to the same account');
			}
		}

		const type = String(dto.type || 'text').toLowerCase();
		const text = String(dto.text || '').trim();
		if (type === 'text' && !text) {
			throw new BadRequestException('Scheduled text message cannot be empty');
		}
		if (type !== 'text' && !dto.fileId) {
			throw new BadRequestException('Scheduled media requires an uploaded file');
		}

		const scheduleKind =
			dto.scheduleKind === 'recurring'
				? WhatsAppMessageScheduleKind.RECURRING
				: WhatsAppMessageScheduleKind.ONCE;
		const timezone = dto.timezone || 'Asia/Qatar';
		const daysOfWeek =
			scheduleKind === WhatsAppMessageScheduleKind.RECURRING
				? normalizeDaysOfWeek(dto.daysOfWeek?.length ? dto.daysOfWeek : everyDayOfWeek())
				: [];

		if (scheduleKind === WhatsAppMessageScheduleKind.ONCE && !dto.scheduledAt) {
			throw new BadRequestException('scheduledAt is required for one-time schedules');
		}
		if (scheduleKind === WhatsAppMessageScheduleKind.RECURRING && !dto.timeOfDay) {
			throw new BadRequestException('timeOfDay is required for recurring schedules');
		}

		const nextRunAt = computeInitialNextRunAt({
			scheduleKind,
			scheduledAt: dto.scheduledAt,
			timeOfDay: dto.timeOfDay,
			daysOfWeek,
			timezone,
			recurrenceStartDate: dto.recurrenceStartDate,
			recurrenceEndDate: dto.recurrenceEndDate,
		});
		if (!nextRunAt) throw new BadRequestException('Could not compute the next run time');
		if (scheduleKind === WhatsAppMessageScheduleKind.ONCE && nextRunAt.getTime() <= Date.now() + 30_000) {
			throw new BadRequestException('Scheduled time must be at least 1 minute in the future');
		}

		const schedule = await this.scheduleRepo.save(
			this.scheduleRepo.create({
				accountId,
				createdByUserId: user.id,
				title: dto.title?.trim() || null,
				type,
				text: text || null,
				caption: dto.caption?.trim() || null,
				fileId: dto.fileId || null,
				quotedProviderMessageId: dto.quotedProviderMessageId || null,
				scheduleKind,
				scheduledAt: scheduleKind === WhatsAppMessageScheduleKind.ONCE ? nextRunAt : null,
				timeOfDay: scheduleKind === WhatsAppMessageScheduleKind.RECURRING ? dto.timeOfDay : null,
				timezone,
				daysOfWeek,
				recurrenceStartDate: dto.recurrenceStartDate || null,
				recurrenceEndDate: dto.recurrenceEndDate || null,
				nextRunAt,
				status: WhatsAppMessageScheduleStatus.ACTIVE,
				clientMessageId: dto.clientMessageId?.trim() || null,
			}),
		);

		await this.recipientRepo.save(
			conversationIds.map(conversationId =>
				this.recipientRepo.create({
					scheduleId: schedule.id,
					conversationId,
					status: WhatsAppMessageScheduleRecipientStatus.ACTIVE,
				}),
			),
		);

		await this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'whatsapp.schedule.created',
			targetType: 'WhatsAppMessageSchedule',
			targetId: schedule.id,
			metadata: { conversationIds, scheduleKind, nextRunAt: nextRunAt.toISOString() },
		});

		const hydrated = await this.getScheduleEntity(schedule.id);
		this.emitScheduleEvent(accountId, 'schedule_created', hydrated);
		return this.mapSchedule(hydrated);
	}

	async listForAccount(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		const rows = await this.scheduleRepo.find({
			where: { accountId },
			relations: ['recipients', 'recipients.conversation', 'recipients.conversation.contact', 'recipients.conversation.group', 'createdByUser'],
			order: { nextRunAt: 'ASC', created_at: 'DESC' },
			take: 200,
		});
		return rows.map(row => this.mapSchedule(row));
	}

	async listForConversation(user: User, conversationId: string) {
		await this.access.assertConversationVisible(user, conversationId);
		const recipientRows = await this.recipientRepo.find({
			where: {
				conversationId,
				status: WhatsAppMessageScheduleRecipientStatus.ACTIVE,
			},
			relations: [
				'schedule',
				'schedule.recipients',
				'schedule.recipients.conversation',
				'schedule.recipients.conversation.contact',
				'schedule.recipients.conversation.group',
			],
			order: { created_at: 'DESC' },
			take: 100,
		});
		const seen = new Set<string>();
		const schedules: WhatsAppMessageSchedule[] = [];
		for (const row of recipientRows) {
			if (!row.schedule || seen.has(row.schedule.id)) continue;
			seen.add(row.schedule.id);
			schedules.push(row.schedule);
		}
		return schedules.map(row => this.mapSchedule(row));
	}

	async getOne(user: User, scheduleId: string) {
		const schedule = await this.getScheduleEntity(scheduleId);
		await this.assertScheduleVisible(user, schedule);
		return this.mapSchedule(schedule);
	}

	async update(user: User, scheduleId: string, dto: UpdateWhatsAppMessageScheduleDto) {
		const schedule = await this.getScheduleEntity(scheduleId);
		await this.assertScheduleManage(user, schedule);
		if (schedule.status !== WhatsAppMessageScheduleStatus.ACTIVE) {
			throw new BadRequestException('Only active schedules can be edited');
		}

		if (typeof dto.title === 'string') schedule.title = dto.title.trim() || null;
		if (typeof dto.text === 'string') schedule.text = dto.text.trim() || null;
		if (typeof dto.timeOfDay === 'string') schedule.timeOfDay = dto.timeOfDay;
		if (Array.isArray(dto.daysOfWeek)) schedule.daysOfWeek = normalizeDaysOfWeek(dto.daysOfWeek);
		if (dto.recurrenceEndDate !== undefined) {
			schedule.recurrenceEndDate = dto.recurrenceEndDate || null;
		}
		if (dto.scheduledAt && schedule.scheduleKind === WhatsAppMessageScheduleKind.ONCE) {
			schedule.scheduledAt = new Date(dto.scheduledAt);
		}

		schedule.nextRunAt = computeInitialNextRunAt({
			scheduleKind: schedule.scheduleKind,
			scheduledAt: schedule.scheduledAt,
			timeOfDay: schedule.timeOfDay,
			daysOfWeek: schedule.daysOfWeek,
			timezone: schedule.timezone,
			recurrenceStartDate: schedule.recurrenceStartDate,
			recurrenceEndDate: schedule.recurrenceEndDate,
		});
		if (!schedule.nextRunAt) throw new BadRequestException('Could not compute the next run time');

		await this.scheduleRepo.save(schedule);
		const hydrated = await this.getScheduleEntity(schedule.id);
		this.emitScheduleEvent(schedule.accountId, 'schedule_updated', hydrated);
		return this.mapSchedule(hydrated);
	}

	async pause(user: User, scheduleId: string) {
		const schedule = await this.getScheduleEntity(scheduleId);
		await this.assertScheduleManage(user, schedule);
		schedule.status = WhatsAppMessageScheduleStatus.PAUSED;
		await this.scheduleRepo.save(schedule);
		this.emitScheduleEvent(schedule.accountId, 'schedule_updated', schedule);
		return this.mapSchedule(schedule);
	}

	async resume(user: User, scheduleId: string) {
		const schedule = await this.getScheduleEntity(scheduleId);
		await this.assertScheduleManage(user, schedule);
		schedule.status = WhatsAppMessageScheduleStatus.ACTIVE;
		schedule.nextRunAt =
			computeInitialNextRunAt({
				scheduleKind: schedule.scheduleKind,
				scheduledAt: schedule.scheduledAt,
				timeOfDay: schedule.timeOfDay,
				daysOfWeek: schedule.daysOfWeek,
				timezone: schedule.timezone,
				recurrenceStartDate: schedule.recurrenceStartDate,
				recurrenceEndDate: schedule.recurrenceEndDate,
			}) || schedule.nextRunAt;
		await this.scheduleRepo.save(schedule);
		this.emitScheduleEvent(schedule.accountId, 'schedule_updated', schedule);
		return this.mapSchedule(schedule);
	}

	async cancel(user: User, scheduleId: string) {
		const schedule = await this.getScheduleEntity(scheduleId);
		await this.assertScheduleManage(user, schedule);
		schedule.status = WhatsAppMessageScheduleStatus.CANCELLED;
		schedule.nextRunAt = null;
		await this.scheduleRepo.save(schedule);
		this.emitScheduleEvent(schedule.accountId, 'schedule_cancelled', schedule);
		return this.mapSchedule(schedule);
	}

	async processDue(now: Date = new Date()) {
		if (this.processing) return { processed: 0, skipped: true };
		this.processing = true;
		try {
			const due = await this.scheduleRepo.find({
				where: {
					status: WhatsAppMessageScheduleStatus.ACTIVE,
				},
				order: { nextRunAt: 'ASC' },
				take: DUE_BATCH_SIZE,
			});
			const ready = due.filter(row => row.nextRunAt && row.nextRunAt.getTime() <= now.getTime());
			for (const schedule of ready) {
				await this.executeSchedule(schedule, now).catch(error => {
					this.logger.warn(
						`Scheduled WhatsApp run failed for ${schedule.id}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				});
			}
			return { processed: ready.length, skipped: false };
		} finally {
			this.processing = false;
		}
	}

	private async executeSchedule(schedule: WhatsAppMessageSchedule, now: Date) {
		const locked = await this.scheduleRepo.update(
			{
				id: schedule.id,
				status: WhatsAppMessageScheduleStatus.ACTIVE,
			},
			{
				status: WhatsAppMessageScheduleStatus.PROCESSING,
			},
		);
		if (!locked.affected) return;

		try {
			const fresh = await this.getScheduleEntity(schedule.id);
			const actor = await this.userRepo.findOne({ where: { id: fresh.createdByUserId } });
			if (!actor) {
				await this.scheduleRepo.update(fresh.id, {
					status: WhatsAppMessageScheduleStatus.CANCELLED,
					lastError: 'Creator user no longer exists',
					nextRunAt: null,
				});
				return;
			}

			const recipients = (fresh.recipients || []).filter(
				item => item.status === WhatsAppMessageScheduleRecipientStatus.ACTIVE,
			);
			const run = await this.runRepo.save(
				this.runRepo.create({
					scheduleId: fresh.id,
					runAt: now,
					status: WhatsAppMessageScheduleRunStatus.RUNNING,
					totalRecipients: recipients.length,
				}),
			);

			let sentCount = 0;
			let failedCount = 0;

			for (const recipient of recipients) {
				const clientMessageId = `${fresh.id}:${run.id}:${recipient.conversationId}`;
				const delivery = await this.deliveryRepo.save(
					this.deliveryRepo.create({
						runId: run.id,
						scheduleId: fresh.id,
						recipientId: recipient.id,
						conversationId: recipient.conversationId,
						clientMessageId,
						status: WhatsAppMessageScheduleDeliveryStatus.PENDING,
					}),
				);

				try {
					const result = await this.dispatchMessage(
						actor,
						fresh,
						recipient.conversationId,
						clientMessageId,
					);
					delivery.status = WhatsAppMessageScheduleDeliveryStatus.SENT;
					delivery.sentMessageId = result?.message?.id || null;
					delivery.attemptCount = 1;
					recipient.lastSentAt = now;
					recipient.lastError = null;
					sentCount += 1;
				} catch (error: any) {
					const detail = String(error?.message || error || 'Send failed');
					delivery.status = WhatsAppMessageScheduleDeliveryStatus.FAILED;
					delivery.attemptCount = 1;
					delivery.lastError = detail;
					recipient.lastError = detail;
					failedCount += 1;
				}

				await this.deliveryRepo.save(delivery);
				await this.recipientRepo.save(recipient);
				await this.sleep(DELAY_BETWEEN_RECIPIENTS_MS);
			}

			run.sentCount = sentCount;
			run.failedCount = failedCount;
			run.status =
				failedCount === 0
					? WhatsAppMessageScheduleRunStatus.COMPLETED
					: sentCount === 0
						? WhatsAppMessageScheduleRunStatus.FAILED
						: WhatsAppMessageScheduleRunStatus.PARTIAL;
			await this.runRepo.save(run);

			fresh.lastRunAt = now;
			fresh.lastError = failedCount ? `${failedCount} recipient(s) failed` : null;

			if (fresh.scheduleKind === WhatsAppMessageScheduleKind.ONCE) {
				fresh.status =
					sentCount > 0
						? WhatsAppMessageScheduleStatus.COMPLETED
						: WhatsAppMessageScheduleStatus.ACTIVE;
				fresh.nextRunAt =
					sentCount > 0 ? null : new Date(now.getTime() + 5 * 60 * 1000);
			} else {
				const nextRunAt = computeNextRecurringRunAt({
					after: new Date(now.getTime() + 60_000),
					timeOfDay: fresh.timeOfDay || '09:00',
					daysOfWeek: fresh.daysOfWeek,
					timezone: fresh.timezone,
					recurrenceStartDate: fresh.recurrenceStartDate,
					recurrenceEndDate: fresh.recurrenceEndDate,
				});
				fresh.nextRunAt = nextRunAt;
				fresh.status = nextRunAt
					? WhatsAppMessageScheduleStatus.ACTIVE
					: WhatsAppMessageScheduleStatus.COMPLETED;
			}

			await this.scheduleRepo.save(fresh);
			this.emitScheduleEvent(fresh.accountId, 'schedule_run_completed', fresh);
		} catch (error) {
			await this.scheduleRepo.update(schedule.id, {
				status: WhatsAppMessageScheduleStatus.ACTIVE,
				lastError: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	private async dispatchMessage(
		user: User,
		schedule: WhatsAppMessageSchedule,
		conversationId: string,
		clientMessageId: string,
	) {
		if (schedule.type === 'text') {
			return this.sync.sendText(
				user,
				conversationId,
				String(schedule.text || ''),
				schedule.quotedProviderMessageId || undefined,
				clientMessageId,
			);
		}
		if (!schedule.fileId) throw new BadRequestException('Scheduled media file is missing');
		return this.sync.sendMedia(user, conversationId, {
			type: schedule.type,
			fileId: schedule.fileId,
			caption: schedule.caption || undefined,
			quotedProviderMessageId: schedule.quotedProviderMessageId || undefined,
			clientMessageId,
		});
	}

	private async getScheduleEntity(scheduleId: string) {
		const schedule = await this.scheduleRepo.findOne({
			where: { id: scheduleId },
			relations: [
				'recipients',
				'recipients.conversation',
				'recipients.conversation.contact',
				'recipients.conversation.group',
				'createdByUser',
			],
		});
		if (!schedule) throw new NotFoundException('Scheduled message not found');
		return schedule;
	}

	private async assertScheduleVisible(user: User, schedule: WhatsAppMessageSchedule) {
		await this.access.assertAccountPermission(user, schedule.accountId, 'canView');
	}

	private async assertScheduleManage(user: User, schedule: WhatsAppMessageSchedule) {
		const accountAccess = await this.access.getAccountAccess(user, schedule.accountId);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send access denied');
		if (schedule.createdByUserId !== user.id && !accountAccess.canManage) {
			throw new ForbiddenException('You can only manage your own schedules');
		}
	}

	private mapSchedule(schedule: WhatsAppMessageSchedule) {
		return {
			id: schedule.id,
			accountId: schedule.accountId,
			createdByUserId: schedule.createdByUserId,
			title: schedule.title,
			type: schedule.type,
			text: schedule.text,
			caption: schedule.caption,
			fileId: schedule.fileId,
			scheduleKind: schedule.scheduleKind,
			scheduledAt: schedule.scheduledAt,
			timeOfDay: schedule.timeOfDay,
			timezone: schedule.timezone,
			daysOfWeek: schedule.daysOfWeek || [],
			recurrenceStartDate: schedule.recurrenceStartDate,
			recurrenceEndDate: schedule.recurrenceEndDate,
			nextRunAt: schedule.nextRunAt,
			lastRunAt: schedule.lastRunAt,
			status: schedule.status,
			lastError: schedule.lastError,
			createdAt: schedule.created_at,
			recipients: (schedule.recipients || []).map(recipient => ({
				id: recipient.id,
				conversationId: recipient.conversationId,
				status: recipient.status,
				lastSentAt: recipient.lastSentAt,
				lastError: recipient.lastError,
				conversation: recipient.conversation
					? {
							id: recipient.conversation.id,
							type: recipient.conversation.type,
							title:
								recipient.conversation.contact?.name ||
								recipient.conversation.group?.subject ||
								recipient.conversation.providerChatId,
						}
					: null,
			})),
		};
	}

	private emitScheduleEvent(accountId: string, event: string, schedule: WhatsAppMessageSchedule) {
		this.gateway.emitAccountEvent(accountId, event, this.mapSchedule(schedule));
	}

	private sleep(ms: number) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
