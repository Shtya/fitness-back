import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import * as webpush from 'web-push';
import { HttpService } from '@nestjs/axios';              // ⬅️ أضف ده
import { lastValueFrom } from 'rxjs';

import { Reminder, UserReminderSettings, PushSubscription, NotificationLog, ReminderSchedule, ScheduleMode, ReminderType, Priority, IntervalUnit } from 'entities/alert.entity';
import { TelegramService } from './telegram.service';
import { randomBytes } from 'crypto';

@Injectable()
export class RemindersService {
	private readonly logger = new Logger(RemindersService.name);

	constructor(
		@InjectRepository(Reminder)
		private readonly remindersRepo: Repository<Reminder>,
		@InjectRepository(UserReminderSettings)
		private readonly settingsRepo: Repository<UserReminderSettings>,
		@InjectRepository(PushSubscription)
		private readonly subsRepo: Repository<PushSubscription>,
		@InjectRepository(NotificationLog)
		private readonly logsRepo: Repository<NotificationLog>,
		private readonly telegramService: TelegramService,
		private readonly http: HttpService,
	) {
		const pub = process.env.VAPID_PUBLIC_KEY;
		const priv = process.env.VAPID_PRIVATE_KEY;
		const sub = process.env.PUSH_SUBJECT || 'mailto:admin@example.com';
		if (pub && priv) {
			try {
				webpush.setVapidDetails(sub, pub, priv);
				this.logger.log(`✅ [RemindersService] VAPID keys configured successfully`);
				this.logger.log(`   📌 Public key length: ${pub.length} chars (should be ~87)`);
				this.logger.log(`   📌 Private key length: ${priv.length} chars (should be ~43)`);
				this.logger.log(`   📌 Subject: ${sub}`);
			} catch (vapidError) {
				this.logger.error(`❌ [RemindersService] Failed to set VAPID details:`, vapidError.message);
				this.logger.error(`   📌 Public key: ${pub}`);
				this.logger.error(`   📌 Private key length: ${priv.length}`);
			}
		} else {
			this.logger.warn('❌ VAPID keys missing — push endpoints will fail until provided.');
			this.logger.warn(`   VAPID_PUBLIC_KEY: ${pub ? `present (${pub.length} chars)` : 'MISSING'}`);
			this.logger.warn(`   VAPID_PRIVATE_KEY: ${priv ? 'present' : 'MISSING'}`);
		}
	}

	// ========= TELEGRAM LINK FLOW =========

	async createTelegramLink(userId: string) {
		const settings = await this.getUserSettings(userId);

		const token = randomBytes(16).toString('hex');
		settings.telegramLinkToken = token;
		await this.settingsRepo.save(settings);

		const botUsername = process.env.TELEGRAM_BOT_USERNAME; // حطها في env
		if (!botUsername) {
			this.logger.warn('TELEGRAM_BOT_USERNAME is not set');
		}

		const botUrl = botUsername
			? `https://t.me/${botUsername}?start=${token}`
			: `https://t.me/<YOUR_BOT_USERNAME>?start=${token}`;

		return {
			botUrl,
			token,
		};
	}

	async handleTelegramWebhook(update: any) {
		const message = update.message || update.edited_message;

		if (!message || !message.text) {
			return { ok: true };
		}

		const text: string = message.text;
		if (!text.startsWith('/start')) {
			return { ok: true };
		}

		const parts = text.split(' ');
		const token = parts[1];
		if (!token) {
			return { ok: true };
		}

		const settings = await this.settingsRepo.findOne({
			where: { telegramLinkToken: token },
		});

		if (!settings) {
			this.logger.warn(`No user settings found for telegram token ${token}`);
			return { ok: true };
		}

		settings.telegramChatId = String(message.chat.id);
		settings.telegramEnabled = true;
		settings.telegramLinkToken = null;
		await this.settingsRepo.save(settings);

		await this.telegramService.sendMessage(
			settings.telegramChatId,
			'✅ تم ربط حسابك بنجاح بتذكيرات So7baFit. سيتم إرسال التذكيرات هنا.'
		);

		return { ok: true };
	}


	async sendPushToUser(userId: string, payload: Record<string, any>) {
		const subs = await this.subsRepo.find({
			where: { userId },
		});

		this.logger.log(`📤 [sendPushToUser] Found ${subs.length} subscriptions for user ${userId}`);

		if (!subs.length) {
			this.logger.warn(`⚠️ No push subscriptions found for user ${userId}`);
			return [];
		}

		const results: any[] = [];

		// إرسال مباشر بدون التحقق المسبق (لأن التحقق يبطئ العملية)
		// سنتعامل مع الأخطاء أثناء الإرسال
		for (const sub of subs) {
			try {
				this.logger.log(`📤 [sendPushToUser] Sending to subscription ${sub.endpoint?.substring(0, 50)}...`);
				const result = await this.logAndSend(sub, userId, payload);
				results.push(result);
			} catch (error) {
				this.logger.error(`Error sending to subscription ${sub.endpoint}:`, error);
				results.push({
					endpoint: sub.endpoint,
					ok: false,
					error: String(error),
				});
			}
		}

		const successCount = results.filter(r => r.ok).length;
		this.logger.log(`📤 [sendPushToUser] Complete - Success: ${successCount}/${subs.length}`);
		return results;
	}
	private reminderGateway: any = null;
	setReminderGateway(gateway: any) {
		this.reminderGateway = gateway;
	}
	getReminderRepo() {
		return this.remindersRepo;
	}
	getReminderGateway() {
		return this.reminderGateway;
	}

	/* ------------------------- Telegram helpers ------------------------- */

	async sendTelegramMessage(chatId: string, text: string) {
		const token = process.env.TELEGRAM_BOT_TOKEN;
		if (!token) {
			this.logger.error('❌ TELEGRAM_BOT_TOKEN is not set');
			throw new BadRequestException('Telegram bot token not configured');
		}

		if (!chatId) {
			throw new BadRequestException('chatId is required');
		}

		const url = `https://api.telegram.org/bot${token}/sendMessage`;

		const payload = {
			chat_id: chatId,
			text,
			parse_mode: 'Markdown',
		};

		this.logger.log(`📤 [Telegram] Sending message to chatId=${chatId}`);

		try {
			const res$ = this.http.post(url, payload);
			const res = await lastValueFrom(res$);
			this.logger.log(`✅ [Telegram] Message sent successfully`);
			return res.data;
		} catch (error: any) {
			this.logger.error(`❌ [Telegram] Failed to send message`, {
				message: error?.message,
				response: error?.response?.data,
			});
			throw new BadRequestException('Failed to send telegram message');
		}
	}

	async sendTelegramTestToUser(chatId: string, message?: string) {
		const text = message || '🔔 Test reminder from So7baFit bot';
		return this.sendTelegramMessage(chatId, text);
	}


	async processDueReminders(now: Date = new Date()) {
		// Load reminders with user relations to get phone numbers
		const active = await this.remindersRepo.find({
			where: { isActive: true, isCompleted: false },
			relations: ['user'], // This is important for WhatsApp integration
		});

		const pastWindowMs = 30_000; // 30 seconds in the past
		const futureWindowMs = 60_000; // 1 minute in the future
		let sentCount = 0;
		let whatsappSentCount = 0;
		let pushSentCount = 0;
		let websocketSentCount = 0;

		for (const rem of active) {
			try {
				let next: Date | null = null;
				if (rem.reminderTime && rem.reminderTime.getTime() > now.getTime() - pastWindowMs) {
					next = rem.reminderTime;
				} else {
					next = this.computeNextOccurrence(rem, now);
					// Save reminderTime for next time
					if (next) {
						rem.reminderTime = next;
						await this.remindersRepo.save(rem);
					}
				}

				if (!next) continue;

				const diff = next.getTime() - now.getTime();

				// Check if reminder is within the time window (30 seconds past to 1 minute future)
				if (diff >= -pastWindowMs && diff <= futureWindowMs) {

					const payload = {
						title: rem.title,
						body: rem.description ?? 'Reminder',
						icon: '/icons/bell.svg',
						url: '/dashboard/reminders',
						data: {
							reminderId: rem.id,
							type: rem.type,
						},
						requireInteraction: true,
						reminderId: rem.id,
					};

					// 1. Try WebSocket first (if user is online)
					let sentViaWebSocket = false;
					if (this.reminderGateway?.isUserConnected(rem.userId)) {
						sentViaWebSocket = this.reminderGateway.sendReminderToUser(rem.userId, rem);
						if (sentViaWebSocket) {
							websocketSentCount++;
						} else {
							this.logger.warn(`⚠️ Failed to send reminder ${rem.id} via WebSocket to user ${rem.userId}`);
						}
					} else {
						this.logger.debug(`❌ User ${rem.userId} is not connected via WebSocket, will try push...`);
					}

					// 2. Send push notification (works even when browser is closed)
					try {
						this.logger.log(`💬 [processDueReminders] Attempting push notification for reminder ${rem.id}...`);
						const pushResults = await this.sendPushToUser(rem.userId, payload);
						if (pushResults && pushResults.length > 0) {
							const successCount = pushResults.filter((r: any) => r.ok).length;
							if (successCount > 0) {
								this.logger.log(`✅ [processDueReminders] Push sent successfully (${successCount}/${pushResults.length})`);
								pushSentCount++;
							} else {
								this.logger.warn(`⚠️ Push send failed for reminder ${rem.id}`);
							}
						} else {
							this.logger.warn(`⚠️ No push subscriptions found for user ${rem.userId}`);
						}
					} catch (pushError) {
						this.logger.error(`❌ Failed to send push notification for reminder ${rem.id}:`, pushError);
					}

					try {
						const settings = await this.getUserSettings(rem.userId);
						if (settings.telegramEnabled && settings.telegramChatId) {
							const text = this.telegramService.buildReminderText(rem);
							await this.telegramService.sendMessage(settings.telegramChatId, text);
							this.logger.log(`✅ [processDueReminders] Telegram sent to user ${rem.userId}`);
						} else {
							this.logger.debug(`ℹ️ [processDueReminders] Telegram not enabled for user ${rem.userId}`);
						}
					} catch (tgError) {
						this.logger.error(`❌ Failed to send Telegram reminder for ${rem.id}:`, tgError);
					}


					sentCount++;

					// Update reminderTime for next occurrence (after 1 minute from now)
					const future = this.computeNextOccurrence(rem, new Date(now.getTime() + 60_000));
					rem.reminderTime = future;
					await this.remindersRepo.save(rem);
				}
			} catch (error) {
				this.logger.error(`❌ Failed to process reminder ${rem.id}:`, error);
			}
		}

		// Log summary
		if (sentCount > 0) {
			this.logger.log(`✅ [processDueReminders] Sent ${sentCount} reminder(s) - WebSocket: ${websocketSentCount}, Push: ${pushSentCount}, WhatsApp: ${whatsappSentCount}`);
		}
	}

	private async getReminderOrThrow(userId: string, id: string) {
		const rem = await this.remindersRepo.findOne({ where: { id, userId } });
		if (!rem) throw new NotFoundException('Reminder not found');
		return rem;
	}

	private ensureOwner(rem: Reminder, userId: string) {
		if (rem.userId !== userId) throw new ForbiddenException('Forbidden');
	}

	private combineDateAndTime(dateStr: string, timeStr: string): Date {
		const [hStr, mStr] = (timeStr || '09:00').split(':');
		const h = Number(hStr || 9);
		const m = Number(mStr || 0);
		const d = new Date(dateStr + 'T00:00:00');
		d.setHours(h, m, 0, 0);
		return d;
	}

	private getLocalStartDate(schedule: ReminderSchedule): string | null {
		if (schedule.startDate) return schedule.startDate;
		return null;
	}

	private computeNextOccurrence(rem: Reminder, from: Date): Date | null {
		const s = rem.schedule;
		const now = from;
		const startDateStr = this.getLocalStartDate(s);
		const times = (s.times || []).length ? [...s.times] : ['09:00'];

		times.sort();

		const endDateStr = s.endDate || null;
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

		const isAfterEnd = (d: Date) => {
			if (!endDateStr) return false;
			const end = new Date(endDateStr + 'T23:59:59');
			return d.getTime() > end.getTime();
		};

		const clampToStart = (d: Date) => {
			if (!startDateStr) return d;
			const start = new Date(startDateStr + 'T00:00:00');
			if (d.getTime() < start.getTime()) return start;
			return d;
		};

		const mode = s.mode;

		// once
		if (mode === ScheduleMode.ONCE) {
			if (!startDateStr) return null;
			const d = this.combineDateAndTime(startDateStr, times[0]);
			if (d.getTime() < now.getTime()) {
				return null; // once وعدّى – مش هيكرر
			}
			return d;
		}

		// daily
		if (mode === ScheduleMode.DAILY) {
			let base = clampToStart(today);
			for (let i = 0; i < 366; i++) {
				const day = new Date(base);
				day.setDate(base.getDate() + i);
				if (isAfterEnd(day)) return null;
				for (const t of times) {
					const dt = this.combineDateAndTime(day.toISOString().slice(0, 10), t);
					if (dt.getTime() >= now.getTime()) return dt;
				}
			}
			return null;
		}

		// weekly
		if (mode === ScheduleMode.WEEKLY) {
			const daysOfWeek = s.daysOfWeek?.length ? s.daysOfWeek : ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
			const map = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

			let base = clampToStart(today);
			for (let i = 0; i < 7 * 52; i++) {
				const day = new Date(base);
				day.setDate(base.getDate() + i);
				if (isAfterEnd(day)) return null;
				const code = map[day.getDay()];
				if (!daysOfWeek.includes(code as any)) continue;
				for (const t of times) {
					const dt = this.combineDateAndTime(day.toISOString().slice(0, 10), t);
					if (dt.getTime() >= now.getTime()) return dt;
				}
			}
			return null;
		}

		// monthly – على نفس يوم startDate أو نفس اليوم الحالي
		if (mode === ScheduleMode.MONTHLY) {
			const baseDay = startDateStr != null ? new Date(startDateStr + 'T00:00:00').getDate() : today.getDate();
			let year = today.getFullYear();
			let month = today.getMonth();

			for (let i = 0; i < 24; i++) {
				const d = new Date(year, month, baseDay);
				if (d.getTime() < now.getTime()) {
					month++;
					if (month > 11) {
						month = 0;
						year++;
					}
					continue;
				}
				if (isAfterEnd(d)) return null;
				const dt = this.combineDateAndTime(d.toISOString().slice(0, 10), times[0]);
				if (dt.getTime() >= now.getTime()) return dt;

				month++;
				if (month > 11) {
					month = 0;
					year++;
				}
			}
			return null;
		}

		// interval – نبدأ من startDate/times[0] ونكرر حسب interval
		if (mode === ScheduleMode.INTERVAL && s.interval) {
			if (!startDateStr) return null;
			const base = this.combineDateAndTime(startDateStr, times[0]);
			if (base.getTime() > now.getTime()) return base;

			let stepMs = 0;
			const every = s.interval.every || 1;
			switch (s.interval.unit) {
				case IntervalUnit.MINUTE:
					stepMs = every * 60_000;
					break;
				case IntervalUnit.HOUR:
					stepMs = every * 60 * 60_000;
					break;
				case IntervalUnit.DAY:
				default:
					stepMs = every * 24 * 60 * 60_000;
					break;
			}

			const maxLoops = 10000;
			let candidate = base;
			for (let i = 0; i < maxLoops; i++) {
				if (candidate.getTime() >= now.getTime()) {
					if (isAfterEnd(candidate)) return null;
					return candidate;
				}
				candidate = new Date(candidate.getTime() + stepMs);
			}
			return null;
		}

		// PRAYER mode – هنا بنسيب الحساب للـ frontend أو لحقل reminderTime
		if (mode === ScheduleMode.PRAYER && rem.reminderTime) {
			if (rem.reminderTime.getTime() >= now.getTime()) {
				return rem.reminderTime;
			}
			return null;
		}

		// fallback: daily
		if (startDateStr) {
			const d = this.combineDateAndTime(startDateStr, times[0]);
			if (d.getTime() >= now.getTime()) return d;
		}
		return null;
	}

	async sendNow(userId: string, dto: any) {
		let title = dto.title ?? 'Reminder';
		let body = dto.body ?? '';
		let icon = dto.icon ?? '/icons/bell.svg';
		let url = dto.url ?? '/';
		let data = dto.data ?? {};
		let requireInteraction = !!dto.requireInteraction;
		let reminderId: string | null = null;

		if (dto.reminderId) {
			const rem = await this.remindersRepo.findOne({
				where: { id: dto.reminderId, userId },
			});
			if (!rem) throw new NotFoundException('Reminder not found');
			reminderId = rem.id;

			title = rem.title ?? title;
			body = rem.description ?? body;
			data = {
				...data,
				reminderId: rem.id,
				type: rem.type ?? ReminderType.CUSTOM,
			};
		}

		const payload = {
			title,
			body,
			icon,
			url,
			data,
			requireInteraction,
			reminderId,
		};

		if (dto.subscriptionId) {
			return this.sendPushToSpecificSubs(userId, [dto.subscriptionId], payload);
		}

		// تحقق من وجود اشتراكات قبل الإرسال
		const subs = await this.subsRepo.find({
			where: { userId },
		});

		if (!subs.length) {
			this.logger.warn(`⚠️ No push subscriptions found for user ${userId} - cannot send push notification`);
			return {
				success: false,
				message: 'No push subscriptions found for this user',
				subscriptionsCount: 0,
			};
		}

		const results = await this.sendPushToUser(userId, payload);

		return {
			success: true,
			subscriptionsCount: subs.length,
			results,
		};
	}

	async list(
		userId: string,
		q: {
			active?: boolean;
			completed?: boolean;
			type?: string;
			fromDate?: string;
			toDate?: string;
		},
	) {
		const where: FindOptionsWhere<Reminder> = { userId };

		if (typeof q.active === 'boolean') (where as any).isActive = q.active;
		if (typeof q.completed === 'boolean') (where as any).isCompleted = q.completed;
		if (q.type) (where as any).type = q.type as any;

		const list = await this.remindersRepo.find({
			where,
			order: { createdAt: 'DESC' },
		});

		if (q.fromDate || q.toDate) {
			const from = q.fromDate ? new Date(q.fromDate) : null;
			const to = q.toDate ? new Date(q.toDate) : null;
			return list.filter(r => {
				const s = r.schedule;
				const start = s.startDate ? new Date(s.startDate + 'T00:00:00') : null;
				const end = s.endDate ? new Date(s.endDate + 'T23:59:59') : null;

				if (from && end && end < from) return false;
				if (to && start && start > to) return false;
				return true;
			});
		}
		return list;
	}

	// داخل class RemindersService
	async getDueRemindersForUser(userId: string, now: Date = new Date()) {
		const pastWindowMs = 30_000;  // نفس النافذة بتاعة processDueReminders
		const futureWindowMs = 60_000;

		// نجيب الـ reminders النشطة وغير المكتملة للمستخدم فقط
		const active = await this.remindersRepo.find({
			where: { userId, isActive: true, isCompleted: false },
		});

		const due: Reminder[] = [];

		for (const rem of active) {
			try {
				let next: Date | null = null;

				// لو عندنا reminderTime، نستخدمه
				if (rem.reminderTime) {
					next = rem.reminderTime;
				} else {
					// احتياطًا: نحسب occurrence لو reminderTime فاضي
					next = this.computeNextOccurrence(rem, now);
				}

				if (!next) continue;

				const diff = next.getTime() - now.getTime();

				// نفس منطق الـ window بتاع processDueReminders
				if (diff >= -pastWindowMs && diff <= futureWindowMs) {
					due.push(rem);
				}
			} catch (err) {
				this.logger.error(`❌ [getDueRemindersForUser] Failed to process reminder ${rem.id}:`, err);
			}
		}

		// هنرجع الـ entities نفسها، والـ frontend يقدر يحولها بـ apiToUiReminder لو حب
		return due.map(rem => ({
			id: rem.id,
			title: rem.title,
			description: rem.description,
			type: rem.type,
			priority: rem.priority,
			schedule: rem.schedule,
			soundSettings: rem.soundSettings,
			isActive: rem.isActive,
			isCompleted: rem.isCompleted,
			reminderTime: rem.reminderTime,
			createdAt: rem.createdAt,
			updatedAt: rem.updatedAt,
			metrics: rem.metrics,
		}));
	}

	async get(userId: string, id: string) {
		return this.getReminderOrThrow(userId, id);
	}

	async create(userId: string, dto: any) {
		const schedule: ReminderSchedule = {
			mode: dto.schedule.mode ?? ScheduleMode.DAILY,
			times: dto.schedule.times ?? [],
			daysOfWeek: dto.schedule.daysOfWeek ?? [],
			interval: dto.schedule.interval ?? null,
			prayer: dto.schedule.prayer ?? null,
			startDate: dto.schedule.startDate ?? null,
			endDate: dto.schedule.endDate ?? null,
			timezone: dto.schedule.timezone ?? 'Africa/Cairo',
			exdates: dto.schedule.exdates ?? [],
			rrule: dto.schedule.rrule ?? '',
		};

		const rem = this.remindersRepo.create({
			userId,
			type: dto.type ?? ReminderType.CUSTOM,
			title: dto.title,
			description: dto.notes ?? null,
			priority: dto.priority ?? Priority.NORMAL,
			schedule,
			soundSettings: {
				id: dto.sound?.id ?? 'chime',
				volume: typeof dto.sound?.volume === 'number' ? dto.sound.volume : 0.8,
			},
			reminderTime: dto.reminderTime ? new Date(dto.reminderTime) : null,
			isActive: dto.active ?? true,
			isCompleted: dto.completed ?? false,
			metrics: {
				streak: 0,
				doneCount: 0,
				skipCount: 0,
				lastAckAt: null,
			},
		});

		// لو reminderTime مش مبعوت، نحاول نحسب أول occurrence
		if (!rem.reminderTime) {
			const next = this.computeNextOccurrence(rem, new Date());
			rem.reminderTime = next;
		}

		return this.remindersRepo.save(rem);
	}

	async update(userId: string, id: string, dto: any) {
		const rem = await this.getReminderOrThrow(userId, id);
		this.ensureOwner(rem, userId);

		if (dto.title !== undefined) rem.title = dto.title;
		if (dto.notes !== undefined) rem.description = dto.notes;
		if (dto.type !== undefined) rem.type = dto.type;
		if (dto.priority !== undefined) rem.priority = dto.priority;
		if (dto.active !== undefined) rem.isActive = dto.active;
		if (dto.completed !== undefined) rem.isCompleted = dto.completed;

		if (dto.sound) {
			rem.soundSettings = {
				id: dto.sound.id ?? rem.soundSettings.id,
				volume: typeof dto.sound.volume === 'number' ? dto.sound.volume : rem.soundSettings.volume,
			};
		}

		if (dto.schedule) {
			rem.schedule = {
				...rem.schedule,
				mode: dto.schedule.mode ?? rem.schedule.mode,
				times: dto.schedule.times ?? rem.schedule.times,
				daysOfWeek: dto.schedule.daysOfWeek ?? rem.schedule.daysOfWeek,
				interval: dto.schedule.interval !== undefined ? dto.schedule.interval : rem.schedule.interval,
				prayer: dto.schedule.prayer !== undefined ? dto.schedule.prayer : rem.schedule.prayer,
				startDate: dto.schedule.startDate ?? rem.schedule.startDate ?? null,
				endDate: dto.schedule.endDate !== undefined ? dto.schedule.endDate : rem.schedule.endDate,
				timezone: dto.schedule.timezone ?? rem.schedule.timezone ?? 'Africa/Cairo',
				exdates: dto.schedule.exdates ?? rem.schedule.exdates,
				rrule: dto.schedule.rrule ?? rem.schedule.rrule,
			};
		}

		if (dto.reminderTime !== undefined) {
			rem.reminderTime = dto.reminderTime ? new Date(dto.reminderTime) : null;
		} else {
			// إعادة حساب الـ reminderTime لو الجدول اتغيّر
			const next = this.computeNextOccurrence(rem, new Date());
			rem.reminderTime = next;
		}

		return this.remindersRepo.save(rem);
	}

	async remove(userId: string, id: string) {
		const rem = await this.getReminderOrThrow(userId, id);
		this.ensureOwner(rem, userId);
		await this.remindersRepo.remove(rem);
		return { ok: true };
	}

	async toggle(userId: string, id: string) {
		const rem = await this.getReminderOrThrow(userId, id);
		this.ensureOwner(rem, userId);
		rem.isActive = !rem.isActive;
		return this.remindersRepo.save(rem);
	}

	async complete(userId: string, id: string) {
		const rem = await this.getReminderOrThrow(userId, id);
		this.ensureOwner(rem, userId);
		rem.isCompleted = true;
		rem.metrics = {
			...rem.metrics,
			doneCount: (rem.metrics?.doneCount ?? 0) + 1,
			lastAckAt: new Date(),
			streak: (rem.metrics?.streak ?? 0) + 1,
			skipCount: rem.metrics?.skipCount ?? 0,
		};
		return this.remindersRepo.save(rem);
	}

	async snooze(userId: string, id: string, minutes: number) {
		if (!Number.isFinite(minutes) || minutes <= 0) {
			throw new BadRequestException('minutes must be > 0');
		}
		const rem = await this.getReminderOrThrow(userId, id);
		this.ensureOwner(rem, userId);

		const base = new Date();
		const next = new Date(base.getTime() + minutes * 60_000);
		rem.reminderTime = next;
		rem.metrics = {
			...rem.metrics,
			skipCount: (rem.metrics?.skipCount ?? 0) + 1,
		};
		return this.remindersRepo.save(rem);
	}

	async getUserSettings(userId: string) {
		let s = await this.settingsRepo.findOne({ where: { userId } });
		if (!s) {
			s = this.settingsRepo.create({
				userId,
				timezone: 'Africa/Cairo',
				city: 'Cairo',
				country: 'Egypt',
				defaultSnooze: 10,
				quietHours: { start: '10:00 PM', end: '07:00 AM' },
				priorityDefault: 'normal',
				soundDefault: 'chime',
			});
			s = await this.settingsRepo.save(s);
		}
		return s;
	}

	async updateUserSettings(userId: string, patch: any) {
		const s = await this.getUserSettings(userId);
		Object.assign(s, patch || {});
		return this.settingsRepo.save(s);
	}

	getVapidPublicKey() {
		const key = process.env.VAPID_PUBLIC_KEY;
		if (!key) {
			throw new BadRequestException('VAPID_PUBLIC_KEY not set');
		}

		const cleaned = key.trim();
		if (cleaned.length < 80 || cleaned.length > 90) {
			this.logger.warn(`VAPID_PUBLIC_KEY length is ${cleaned.length}, expected ~87 characters`);
		}

		return { publicKey: cleaned };
	}

	async subscribePush(
		userId: string | null,
		body: {
			endpoint: string;
			keys: { p256dh: string; auth: string };
			expirationTime?: string | null;
		},
		ua?: string,
		ip?: string,
	) {
		this.logger.log(`📝 [subscribePush] Received subscription from userId: ${userId}`);
		this.logger.log(`📝 [subscribePush] User-Agent: ${ua?.substring(0, 50) || 'unknown'}...`);

		if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
			this.logger.error('❌ [subscribePush] Invalid subscription data received', { body });
			throw new BadRequestException('Invalid subscription');
		}

		this.logger.log(`📝 [subscribePush] Endpoint: ${body.endpoint.substring(0, 50)}...`);
		this.logger.log(`📝 [subscribePush] P256DH: ${body.keys.p256dh.substring(0, 20)}... (length: ${body.keys.p256dh.length})`);
		this.logger.log(`📝 [subscribePush] Auth: ${body.keys.auth.substring(0, 20)}... (length: ${body.keys.auth.length})`);

		let found = await this.subsRepo.findOne({
			where: { endpoint: body.endpoint },
		});

		if (!found) {
			this.logger.log(`📝 [subscribePush] Creating NEW subscription for user ${userId}`);
			found = this.subsRepo.create({
				userId: userId || null,
				endpoint: body.endpoint,
				p256dh: body.keys.p256dh,
				auth: body.keys.auth,
				expirationTime: body.expirationTime ? new Date(body.expirationTime) : null,
				userAgent: ua || null,
				ipAddress: ip || null,
				failures: 0,
			});
		} else {
			// دائماً نحدث userId إذا كان موجوداً (حتى لو كان مختلفاً)
			if (userId) {
				if (found.userId !== userId) {
					this.logger.log(`📝 [subscribePush] Updating subscription from user ${found.userId} to ${userId}`);
					found.userId = userId;
				} else {
					this.logger.log(`✅ [subscribePush] Subscription already linked to user ${userId}`);
				}
			}

			this.logger.log(`📝 [subscribePush] Updating EXISTING subscription`);
			found.p256dh = body.keys.p256dh;
			found.auth = body.keys.auth;
			found.userAgent = ua || found.userAgent;
			found.ipAddress = ip || found.ipAddress;
			found.failures = 0; // Reset failures when subscription is updated
		}

		try {
			const saved = await this.subsRepo.save(found);
			this.logger.log(`✅ [subscribePush] Subscription saved successfully, ID: ${saved.id}`);
			return { ok: true, subscriptionId: saved.id };
		} catch (saveError) {
			this.logger.error(`❌ [subscribePush] Failed to save subscription:`, saveError.message);
			throw new BadRequestException(`Failed to save subscription: ${saveError.message}`);
		}
	}

	private async logAndSend(sub: PushSubscription, userId: string | null, payload: Record<string, any>) {
		let log: any = this.logsRepo.create({
			userId,
			reminderId: payload?.reminderId || null,
			status: 'queued',
			payload,
			error: null,
			sentAt: null,
		});
		log = await this.logsRepo.save(log);

		try {
			this.logger.log(`🔔 [logAndSend] Starting push send for subscription: ${sub.endpoint?.substring(0, 50)}...`);
			this.logger.log(`🔔 [logAndSend] P256DH exists: ${!!sub.p256dh}, Auth exists: ${!!sub.auth}`);

			// حسب dev.to article: يجب أن يكون payload في تنسيق { notification: { ... } }
			// لكن web-push library يقبل أيضاً التنسيق المباشر
			// سنستخدم التنسيق المباشر لأنه أبسط وأكثر توافقاً
			const notificationPayload = {
				title: payload.title || 'Reminder',
				body: payload.body || payload.description || '',
				icon: payload.icon || '/icons/bell.svg',
				badge: '/icons/badge.svg',
				data: {
					...(payload.data || {}),
					reminderId: payload.reminderId || null,
					url: payload.url || '/dashboard/reminders',
				},
				requireInteraction: payload.requireInteraction !== false,
				vibrate: [200, 100, 200],
				tag: `reminder-${payload.reminderId || Date.now()}`,
			};

			this.logger.log(`🔔 [logAndSend] Notification payload stringified: ${JSON.stringify(notificationPayload).substring(0, 100)}...`);
			this.logger.log(`🔔 [logAndSend] Calling webpush.sendNotification...`);

			const res = await webpush.sendNotification(
				{
					endpoint: sub.endpoint,
					keys: {
						p256dh: sub.p256dh,
						auth: sub.auth,
					},
				} as any,
				JSON.stringify(notificationPayload),
				{
					TTL: 86400, // 24 hours - ensures notification is delivered even if device is offline
					urgency: 'high',
				},
			);

			this.logger.log(`✅ [logAndSend] Push sent successfully! Status code: ${res.statusCode}`);

			sub.lastSentAt = new Date();
			sub.failures = 0; // Reset failures on success
			await this.subsRepo.save(sub);

			log.status = 'sent';
			log.sentAt = new Date();
			await this.logsRepo.save(log);

			return { endpoint: sub.endpoint, ok: true, status: res.statusCode };
		} catch (err: any) {
			this.logger.error(`❌ [logAndSend] Push FAILED for ${sub.endpoint?.substring(0, 50)}...`, {
				statusCode: err?.statusCode,
				message: err?.message,
				endpoint: err?.endpoint,
				fullError: String(err),
			});

			sub.failures = (sub.failures ?? 0) + 1;
			await this.subsRepo.save(sub);

			log.status = 'failed';
			log.error = {
				code: err?.statusCode,
				message: String(err?.message || err),
				endpoint: err?.endpoint as any,
			};
			await this.logsRepo.save(log);

			// حذف الاشتراكات المنتهية أو غير الصالحة
			if (err?.statusCode === 404 || err?.statusCode === 410 || err?.statusCode === 403) {
				this.logger.warn(`Removing invalid subscription: ${sub.endpoint} (status: ${err?.statusCode})`);
				await this.subsRepo.remove(sub);
			}

			return {
				endpoint: sub.endpoint,
				ok: false,
				status: err?.statusCode,
				error: err?.message,
			};
		}
	}

	async sendPushToSpecificSubs(userId: string, subscriptionIds: string[], payload: Record<string, any>) {
		const subs = await this.subsRepo.findByIds(subscriptionIds);
		if (!subs.length) return [];

		const results: any[] = [];
		for (const s of subs) {
			results.push(await this.logAndSend(s, userId, payload));
		}
		return results;
	}
}
