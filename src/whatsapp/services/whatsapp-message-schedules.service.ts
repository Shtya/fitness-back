import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, LessThanOrEqual, Not, Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	CreateWhatsAppMessageScheduleDto,
	UpdateWhatsAppMessageScheduleDto,
} from '../dto/whatsapp-schedule.dto';
import {
	WhatsAppMessage,
	WhatsAppMessageSchedule,
	WhatsAppMessageScheduleDelivery,
	WhatsAppMessageScheduleDeliveryStatus,
	WhatsAppMessageScheduleKind,
	WhatsAppMessageScheduleRecipient,
	WhatsAppMessageScheduleRecipientStatus,
	WhatsAppMessageScheduleRun,
	WhatsAppMessageScheduleRunStatus,
	WhatsAppMessageScheduleStatus,
	WhatsAppMessageStatus,
} from '../entities/whatsapp.entity';
import { computeReplyGap } from '../utils/whatsapp-reply-gap';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import {
	computeInitialNextRunAt,
	computeNextRecurringRunAt,
	everyDayOfWeek,
	normalizeDaysOfWeek,
} from '../utils/whatsapp-schedule-time';
import { sanitizeDisplayFileName } from '../utils/whatsapp-display-file-name';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';
import { WhatsAppSyncService } from './whatsapp-sync.service';

const MAX_RECIPIENTS = 50;
const DELAY_BETWEEN_RECIPIENTS_MS = 2500;
const DUE_BATCH_SIZE = 20;
/** A one-time message is tried this many times before it is marked failed for the user to retry. */
const ONCE_MAX_ATTEMPTS = 3;
const ONCE_RETRY_DELAY_MS = 2 * 60 * 1000;
/** A run that sits in "processing" this long was cut off (restart / crash) and is picked up again. */
const STUCK_PROCESSING_MS = 10 * 60 * 1000;
const MIN_LEAD_MS = 30_000;
/** Newest messages looked at to find my last message and their reply. */
const REPLY_GAP_SCAN = 400;
const EDITABLE_STATUSES = [
	WhatsAppMessageScheduleStatus.ACTIVE,
	WhatsAppMessageScheduleStatus.PAUSED,
	WhatsAppMessageScheduleStatus.FAILED,
];

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
		@InjectRepository(WhatsAppMessage)
		private readonly messageRepo: Repository<WhatsAppMessage>,
		private readonly access: WhatsAppAccessService,
		private readonly sync: WhatsAppSyncService,
		private readonly audit: WhatsAppAuditService,
		private readonly gateway: WhatsAppGateway,
	) {}

	async create(user: User, accountId: string, dto: CreateWhatsAppMessageScheduleDto) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send access denied');

		const clientMessageId = dto.clientMessageId?.trim() || null;
		if (clientMessageId) {
			const existing = await this.scheduleRepo.findOne({
				where: { accountId, createdByUserId: user.id, clientMessageId },
			});
			if (existing) return this.mapSchedule(await this.getScheduleEntity(existing.id));
		}

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
		if (scheduleKind === WhatsAppMessageScheduleKind.ONCE && nextRunAt.getTime() <= Date.now() + MIN_LEAD_MS) {
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
				fileName: dto.fileId ? sanitizeDisplayFileName(dto.fileName) : null,
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
				clientMessageId,
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
			// Cancelled / completed runs must not linger in the chat strip (failed ones stay to retry).
			if (
				row.schedule.status === WhatsAppMessageScheduleStatus.CANCELLED ||
				row.schedule.status === WhatsAppMessageScheduleStatus.COMPLETED
			) {
				continue;
			}
			seen.add(row.schedule.id);
			schedules.push(row.schedule);
		}
		return schedules.map(row => this.mapSchedule(row));
	}

	/**
	 * How long the other side took to answer my last message, from the stored message times.
	 * Used by "delayed reply" to send my next message after the same gap.
	 */
	async replyGap(user: User, conversationId: string) {
		await this.access.assertConversationVisible(user, conversationId);
		const rows = await this.messageRepo.find({
			where: [
				{ conversationId, direction: 'inbound' as any, deletedMode: Not('everyone') },
				{
					conversationId,
					direction: 'outbound' as any,
					deletedMode: Not('everyone'),
					status: Not(In([WhatsAppMessageStatus.PENDING, WhatsAppMessageStatus.FAILED])),
				},
			],
			select: ['id', 'direction', 'providerTimestamp'],
			order: { providerTimestamp: 'DESC' },
			take: REPLY_GAP_SCAN,
		});
		return computeReplyGap(rows);
	}

	async getOne(user: User, scheduleId: string) {
		const schedule = await this.getScheduleEntity(scheduleId);
		await this.assertScheduleVisible(user, schedule);
		return this.mapSchedule(schedule);
	}

	async update(user: User, scheduleId: string, dto: UpdateWhatsAppMessageScheduleDto) {
		const schedule = await this.getScheduleEntity(scheduleId);
		await this.assertScheduleManage(user, schedule);
		if (!EDITABLE_STATUSES.includes(schedule.status as WhatsAppMessageScheduleStatus)) {
			throw new BadRequestException('Only scheduled, paused or failed messages can be edited');
		}

		if (typeof dto.title === 'string') schedule.title = dto.title.trim() || null;
		if (typeof dto.text === 'string') schedule.text = dto.text.trim() || null;
		if (typeof dto.timeOfDay === 'string') schedule.timeOfDay = dto.timeOfDay;
		if (Array.isArray(dto.daysOfWeek)) schedule.daysOfWeek = normalizeDaysOfWeek(dto.daysOfWeek);
		if (dto.recurrenceEndDate !== undefined) {
			schedule.recurrenceEndDate = dto.recurrenceEndDate || null;
		}
		if (dto.scheduledAt && schedule.scheduleKind === WhatsAppMessageScheduleKind.ONCE) {
			const at = new Date(dto.scheduledAt);
			if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now() + MIN_LEAD_MS) {
				throw new BadRequestException('Scheduled time must be at least 1 minute in the future');
			}
			schedule.scheduledAt = at;
		}
		if (
			schedule.scheduleKind === WhatsAppMessageScheduleKind.ONCE &&
			schedule.status === WhatsAppMessageScheduleStatus.FAILED
		) {
			// Editing a failed message puts it back in the queue with a fresh set of tries.
			if (!dto.scheduledAt) throw new BadRequestException('Pick a new time to send the failed message');
			schedule.status = WhatsAppMessageScheduleStatus.ACTIVE;
			schedule.lastError = null;
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
		if (schedule.status !== WhatsAppMessageScheduleStatus.ACTIVE) {
			throw new BadRequestException('Only scheduled messages can be paused');
		}
		schedule.status = WhatsAppMessageScheduleStatus.PAUSED;
		await this.scheduleRepo.save(schedule);
		this.emitScheduleEvent(schedule.accountId, 'schedule_updated', schedule);
		return this.mapSchedule(schedule);
	}

	async resume(user: User, scheduleId: string) {
		const schedule = await this.getScheduleEntity(scheduleId);
		await this.assertScheduleManage(user, schedule);
		if (
			schedule.status !== WhatsAppMessageScheduleStatus.PAUSED &&
			schedule.status !== WhatsAppMessageScheduleStatus.FAILED
		) {
			throw new BadRequestException('Only paused or failed messages can be resumed');
		}
		const retrying = schedule.status === WhatsAppMessageScheduleStatus.FAILED;
		schedule.status = WhatsAppMessageScheduleStatus.ACTIVE;
		schedule.lastError = retrying ? null : schedule.lastError;
		// A one-time message whose time passed while paused / failed goes out on the next tick.
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

	/** Sends a waiting one-time message right away instead of at its time. */
	async sendNow(user: User, scheduleId: string) {
		const schedule = await this.getScheduleEntity(scheduleId);
		await this.assertScheduleManage(user, schedule);
		if (schedule.scheduleKind !== WhatsAppMessageScheduleKind.ONCE) {
			throw new BadRequestException('Only one-time messages can be sent now');
		}
		if (!EDITABLE_STATUSES.includes(schedule.status as WhatsAppMessageScheduleStatus)) {
			throw new BadRequestException('This message is already sent or being sent');
		}
		const now = new Date();
		schedule.status = WhatsAppMessageScheduleStatus.ACTIVE;
		schedule.lastError = null;
		schedule.nextRunAt = now;
		await this.scheduleRepo.save(schedule);
		this.emitScheduleEvent(schedule.accountId, 'schedule_updated', schedule);
		// executeSchedule locks ACTIVE → PROCESSING, so the cron tick cannot send it a second time.
		void this.executeSchedule(schedule, now).catch(error => {
			this.logger.warn(
				`Send-now failed for ${schedule.id}: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
		return this.mapSchedule(schedule);
	}

	async cancel(user: User, scheduleId: string) {
		const schedule = await this.getScheduleEntity(scheduleId);
		await this.assertScheduleManage(user, schedule);
		if (schedule.status === WhatsAppMessageScheduleStatus.PROCESSING) {
			throw new BadRequestException('This message is being sent right now');
		}
		if (
			schedule.status === WhatsAppMessageScheduleStatus.COMPLETED ||
			schedule.status === WhatsAppMessageScheduleStatus.CANCELLED
		) {
			return this.mapSchedule(schedule);
		}
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
			await this.recoverStuckRuns(now);
			const ready = await this.scheduleRepo.find({
				where: {
					status: WhatsAppMessageScheduleStatus.ACTIVE,
					nextRunAt: LessThanOrEqual(now),
				},
				order: { nextRunAt: 'ASC' },
				take: DUE_BATCH_SIZE,
			});
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

			const once = fresh.scheduleKind === WhatsAppMessageScheduleKind.ONCE;
			const alreadySent = once ? await this.sentConversationIds(fresh.id) : new Set<string>();
			const recipients = (fresh.recipients || []).filter(
				item =>
					item.status === WhatsAppMessageScheduleRecipientStatus.ACTIVE &&
					!alreadySent.has(item.conversationId),
			);
			const previousRuns = once ? await this.runRepo.count({ where: { scheduleId: fresh.id } }) : 0;
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
			let lastFailure = '';

			for (const recipient of recipients) {
				// One-time: the same id on every try, so a retry after a lost response is not sent twice.
				const clientMessageId = once
					? `schedule:${fresh.id}:${recipient.conversationId}`
					: `${fresh.id}:${run.id}:${recipient.conversationId}`;
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
					lastFailure = detail;
					failedCount += 1;
				}

				await this.deliveryRepo.save(delivery);
				await this.recipientRepo.save(recipient);
				if (recipient !== recipients[recipients.length - 1]) await this.sleep(DELAY_BETWEEN_RECIPIENTS_MS);
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
			fresh.lastError = failedCount ? lastFailure || `${failedCount} recipient(s) failed` : null;

			if (once) {
				const attempts = previousRuns + 1;
				if (failedCount === 0) {
					fresh.status = WhatsAppMessageScheduleStatus.COMPLETED;
					fresh.nextRunAt = null;
				} else if (attempts >= ONCE_MAX_ATTEMPTS) {
					fresh.status = WhatsAppMessageScheduleStatus.FAILED;
					fresh.nextRunAt = null;
					fresh.lastError = lastFailure || fresh.lastError;
				} else {
					fresh.status = WhatsAppMessageScheduleStatus.ACTIVE;
					fresh.nextRunAt = new Date(now.getTime() + ONCE_RETRY_DELAY_MS * attempts);
				}
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
			fileName: schedule.fileName,
			caption: schedule.caption || undefined,
			quotedProviderMessageId: schedule.quotedProviderMessageId || undefined,
			clientMessageId,
		});
	}

	/** Chats a one-time message already reached in an earlier try. */
	private async sentConversationIds(scheduleId: string) {
		const rows = await this.deliveryRepo.find({
			where: { scheduleId, status: WhatsAppMessageScheduleDeliveryStatus.SENT },
			select: ['conversationId'],
		});
		return new Set(rows.map(row => row.conversationId));
	}

	/**
	 * A run cut off by a restart leaves the schedule in "processing" forever. Put it back in the queue;
	 * chats it already reached are skipped by the delivery check, so nothing is sent twice.
	 */
	private async recoverStuckRuns(now: Date) {
		const stuck = await this.scheduleRepo.find({
			where: {
				status: WhatsAppMessageScheduleStatus.PROCESSING,
				updated_at: LessThan(new Date(now.getTime() - STUCK_PROCESSING_MS)),
			},
			select: ['id'],
			take: DUE_BATCH_SIZE,
		});
		if (!stuck.length) return;
		await this.scheduleRepo.update(
			{ id: In(stuck.map(row => row.id)), status: WhatsAppMessageScheduleStatus.PROCESSING },
			{ status: WhatsAppMessageScheduleStatus.ACTIVE, nextRunAt: now },
		);
		this.logger.warn(`Re-queued ${stuck.length} WhatsApp scheduled message(s) left in processing`);
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
			clientMessageId: schedule.clientMessageId ?? null,
			title: schedule.title,
			type: schedule.type,
			text: schedule.text,
			caption: schedule.caption,
			fileId: schedule.fileId,
			fileName: schedule.fileName,
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
