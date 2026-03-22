// src/modules/calendar/calendar.service.ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
	CalendarCompletion,
	CalendarEventType,
	CalendarItem,
	CalendarSettings,
	CommitmentTimer,
	CalendarRecurrence,
} from 'entities/calendar.entity';
import {
	CreateCalendarItemDto,
	CreateCalendarTypeDto,
	PauseCommitmentDto,
	StartCommitmentDto,
	ToggleCompletionDto,
	UpdateCalendarItemDto,
	UpdateCalendarSettingsDto,
	UpdateCalendarTypeDto,
} from 'dto/calendar.dto';
import { User, UserRole } from '../../entities/global.entity';
import { isUUID } from 'class-validator';
import { ExpoPushService } from '../notification/expo-push.service';


const DEFAULT_TYPES = [
	{
		id: 'all',
		nameKey: 'types.all',
		color: 'bg-gray-50',
		textColor: 'text-gray-700',
		border: 'border-gray-200',
		ring: 'ring-gray-500',
		icon: 'LayoutGrid',
	},
	{
		id: 'habit',
		nameKey: 'types.habit',
		color: 'bg-emerald-50',
		textColor: 'text-emerald-700',
		border: 'border-emerald-200',
		ring: 'ring-emerald-500',
		icon: 'Target',
	},
	{
		id: 'task',
		nameKey: 'types.task',
		color: 'bg-blue-50',
		textColor: 'text-blue-700',
		border: 'border-blue-200',
		ring: 'ring-blue-500',
		icon: 'CheckSquare',
	},
	{
		id: 'meeting',
		nameKey: 'types.meeting',
		color: 'bg-purple-50',
		textColor: 'text-purple-700',
		border: 'border-purple-200',
		ring: 'ring-purple-500',
		icon: 'Users',
	},
	{
		id: 'reminder',
		nameKey: 'types.reminder',
		color: 'bg-amber-50',
		textColor: 'text-amber-700',
		border: 'border-amber-200',
		ring: 'ring-amber-500',
		icon: 'Bell',
	},
	{
		id: 'billing',
		nameKey: 'types.billing',
		color: 'bg-rose-50',
		textColor: 'text-rose-700',
		border: 'border-rose-200',
		ring: 'ring-rose-500',
		icon: 'DollarSign',
	},
];




@Injectable()
export class CalendarService {
	constructor(
		@InjectRepository(CalendarEventType) private readonly typeRepo: Repository<CalendarEventType>,
		@InjectRepository(CalendarItem) private readonly itemRepo: Repository<CalendarItem>,
		@InjectRepository(CalendarCompletion) private readonly completionRepo: Repository<CalendarCompletion>,
		@InjectRepository(CalendarSettings) private readonly settingsRepo: Repository<CalendarSettings>,
		@InjectRepository(CommitmentTimer) private readonly commitmentRepo: Repository<CommitmentTimer>,
		@InjectRepository(User) private readonly userRepo: Repository<User>,
		private readonly expoPushService: ExpoPushService,
	) { }

	private toDateKey(d: Date) {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	private toTimeKey(d: Date) {
		const h = String(d.getHours()).padStart(2, '0');
		const m = String(d.getMinutes()).padStart(2, '0');
		return `${h}:${m}`;
	}

	private isSameOrAfter(a: string, b: string) {
		return a >= b;
	}

	private isCalendarItemDueToday(item: CalendarItem, now: Date) {
		const today = this.toDateKey(now);
		const nowTime = this.toTimeKey(now);

		if (!item.startTime) return false;
		if (item.startTime !== nowTime) return false;
		if (!item.startDate) return false;
		if (!this.isSameOrAfter(today, item.startDate)) return false;

		switch (item.recurrence) {
			case CalendarRecurrence.NONE:
				return item.startDate === today;

			case CalendarRecurrence.DAILY:
				return true;

			case CalendarRecurrence.WEEKLY:
				return new Date(item.startDate).getDay() === now.getDay();

			case CalendarRecurrence.MONTHLY:
				return new Date(item.startDate).getDate() === now.getDate();

			case CalendarRecurrence.CUSTOM: {
				const jsDay = now.getDay(); // 0..6
				const mappedDay = jsDay === 0 ? 6 : jsDay - 1; // لو عندك نظام مختلف عدّله
				return Array.isArray(item.recurrenceDays) && item.recurrenceDays.includes(mappedDay);
			}

			default:
				return false;
		}
	}



	async checkAndSendCalendarNotifications(now: Date = new Date()) {
		const adminItems = await this.itemRepo.find({
			where: {},
		});

		for (const item of adminItems) {
			try {
				if (!item.userId) continue;
				if (!this.isCalendarItemDueToday(item, now)) continue;

				const user = await this.userRepo.findOne({
					where: { id: item.userId },
				});

				if (!user?.expoPushTokens?.length) continue;

				await this.expoPushService.sendToTokens(user.expoPushTokens, {
					title: item.title,
					body: item.typeKey ? `📅 ${item.typeKey}` : '📅 Calendar reminder',
					data: {
						type: 'calendar_item',
						itemId: item.id,
						startDate: item.startDate,
						startTime: item.startTime,
					},
				});
			} catch (error) {
				console.error(`Failed to send calendar notification for item ${item.id}`, error);
			}
		}
	}
	async getState(user: any) {
		const [
			itemsRes,
			typesRes,
			completionsRes,
			settingsRes,
			soundRes,
		] = await Promise.all([
			this.listItems(user),
			this.listTypes(user),
			this.listCompletions(user, undefined, undefined),
			this.getSettings(user),
			this.getSound(user),
		]);

		// ---------- Normalize ----------
		const items = (itemsRes as any)?.items ?? itemsRes ?? [];
		const completions = (completionsRes as any)?.completions ?? completionsRes ?? {};
		const dbSettings = (settingsRes as any)?.settings ?? settingsRes ?? {};
		const soundEnabled =
			typeof (soundRes as any)?.soundEnabled === 'boolean'
				? (soundRes as any).soundEnabled
				: true;


		const dbTypes = (typesRes as any)?.eventTypes ?? typesRes ?? [];

		const eventTypesMap = new Map();

		for (const type of DEFAULT_TYPES) {
			eventTypesMap.set(type.id, type);
		}

		for (const type of dbTypes) {
			eventTypesMap.set(type.id, type);
		}

		const eventTypes = Array.from(eventTypesMap.values());


		// ---------- Default Settings ----------
		const DEFAULT_SETTINGS = {
			showWeekNumbers: false,
			highlightWeekend: true,
			weekendDays: [5, 6],
			startOfWeek: 6,
			confirmBeforeDelete: true,
		};

		const settings = {
			...DEFAULT_SETTINGS,
			...dbSettings,
		};

		return {
			items,
			eventTypes,
			completions,
			settings,
			soundEnabled,
		};
	}


	// ✅ MISSING: GET /calendar/sound
	async getSound(user: any) {
		// simplest: store soundEnabled inside settings
		const settingsRes: any = await this.getSettings(user);
		const settings = settingsRes?.settings ?? settingsRes ?? {};
		return { soundEnabled: typeof settings.soundEnabled === 'boolean' ? settings.soundEnabled : true };
	}

	// ✅ MISSING: PUT /calendar/sound
	async updateSound(user: any, dto: { soundEnabled: boolean }) {
		if (typeof dto?.soundEnabled !== 'boolean') {
			throw new BadRequestException('soundEnabled must be boolean');
		}

		// store it in settings
		const settingsRes: any = await this.getSettings(user);
		const settings = settingsRes?.settings ?? settingsRes ?? {};

		const nextSettings = { ...settings, soundEnabled: dto.soundEnabled };
		await this.updateSettings(user, nextSettings as any);

		return { soundEnabled: dto.soundEnabled };
	}

	// ---------------------------
	// Multi-tenant helper
	// ---------------------------
	private getTenantAdminId(user: User): string | null {
		if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) return user.id;
		return user.adminId ?? null;
	}

	private assertTenant(adminId: string | null) {
		if (!adminId) throw new ForbiddenException('Tenant adminId is missing for this user.');
	}

	// ===========================
	// Types
	// ===========================
	async listTypes(user: User) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const customTypes = await this.typeRepo.find({
			where: { adminId },
			order: { created_at: 'ASC' },
		});

		return [
			...DEFAULT_TYPES,
			...customTypes,
		];
	}


	async createType(user: User, dto: CreateCalendarTypeDto) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		if (!(user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN)) {
			throw new ForbiddenException('Only admin can create types.');
		}

		// ✅ ignore dto.id completely
		const { id, ...safe } = (dto as any) || {};

		const t = this.typeRepo.create({
			...safe,
			textColor: safe.textColor ?? 'text-gray-700',
			border: safe.border ?? 'border-gray-200',
			ring: safe.ring ?? 'ring-gray-500',
			icon: safe.icon ?? 'Target',
			isActive: safe.isActive ?? true,
			adminId,
		});

		return this.typeRepo.save(t);
	}


	async updateType(user: User, id: string, dto: UpdateCalendarTypeDto) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const type = await this.typeRepo.findOne({ where: { id, adminId } });
		if (!type) throw new NotFoundException('Type not found');

		if (!(user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN)) {
			throw new ForbiddenException('Only admin can update types.');
		}

		Object.assign(type, dto);
		return this.typeRepo.save(type);
	}

	async deleteType(user: User, id: string) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const type = await this.typeRepo.findOne({ where: { id, adminId } });
		if (!type) throw new NotFoundException('Type not found');

		if (!(user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN)) {
			throw new ForbiddenException('Only admin can delete types.');
		}

		// optional: also null typeId in items
		await this.itemRepo.update({ adminId, typeId: id }, { typeId: null });

		await this.typeRepo.softRemove(type);
		return { ok: true };
	}

	// ===========================
	// Items
	// ===========================
	async listItems(user: User) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const rows = await this.itemRepo.find({
			where: { adminId, userId: user.id },
			order: { created_at: 'DESC' },
		});

		return rows.map((r: any) => ({
			...r,
			type: r.typeKey ?? r.typeId ?? 'task',
		}));

	}


	async createItem(user: User, dto: any) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const rawType = dto.type ?? dto.typeId ?? null;

		const typeId = rawType && isUUID(rawType) ? rawType : null;

		if (typeId) {
			const typeExists = await this.typeRepo.findOne({ where: { id: typeId, adminId } });
			if (!typeExists) {
				throw new BadRequestException('Invalid typeId');
			}
		}


		const typeKey = rawType && !isUUID(rawType) ? rawType : null; // "habit", "task", ...

		const item = this.itemRepo.create({
			title: dto.title,
			typeId,
			typeKey,
			startDate: dto.startDate,
			startTime: dto.startTime ?? null,
			recurrence: dto.recurrence ?? CalendarRecurrence.NONE,
			recurrenceInterval: dto.recurrenceInterval ?? 1,
			recurrenceDays: dto.recurrenceDays ?? [],
			userId: user.id,
			adminId,
		});

		return this.itemRepo.save(item);
	}

	async updateItem(user: User, id: string, dto: any) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const item = await this.itemRepo.findOne({ where: { id, adminId, userId: user.id } });
		if (!item) throw new NotFoundException('Item not found');

		const nextRecurrence = dto.recurrence ?? item.recurrence;
		const nextDays = dto.recurrenceDays ?? item.recurrenceDays;

		if (nextRecurrence === CalendarRecurrence.CUSTOM && (!nextDays || nextDays.length === 0)) {
			throw new BadRequestException('recurrenceDays is required for custom recurrence.');
		}
		const rawType = dto.type ?? dto.typeId ?? undefined;

		const nextTypeId = rawType !== undefined ? (rawType && isUUID(rawType) ? rawType : null) : item.typeId;

		if (nextTypeId) {
			const typeExists = await this.typeRepo.findOne({ where: { id: nextTypeId, adminId } });
			if (!typeExists) {
				throw new BadRequestException('Invalid typeId');
			}
		}

		const nextTypeKey = rawType !== undefined ? (rawType && !isUUID(rawType) ? rawType : null) : item.typeKey;

		Object.assign(item, {
			title: dto.title ?? item.title,
			typeId: nextTypeId,
			typeKey: nextTypeKey,
			startDate: dto.startDate ?? item.startDate,
			startTime: dto.startTime !== undefined ? dto.startTime : item.startTime,
			recurrence: dto.recurrence ?? item.recurrence,
			recurrenceInterval: dto.recurrenceInterval ?? item.recurrenceInterval,
			recurrenceDays: dto.recurrenceDays ?? item.recurrenceDays,
		});

		return this.itemRepo.save(item);
	}

	async deleteItem(user: User, id: string) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const item = await this.itemRepo.findOne({ where: { id, adminId, userId: user.id } });
		if (!item) throw new NotFoundException('Item not found');

		await this.itemRepo.softRemove(item);
		return { ok: true };
	}

	// ===========================
	// Completions
	// ===========================
	async toggleCompletion(user: User, dto: ToggleCompletionDto) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const item = await this.itemRepo.findOne({ where: { id: dto.itemId, adminId, userId: user.id } });
		if (!item) throw new NotFoundException('Item not found');

		let row = await this.completionRepo.findOne({
			where: { itemId: dto.itemId, date: dto.date, userId: user.id, adminId },
		});

		if (!row) {
			row = this.completionRepo.create({
				itemId: dto.itemId,
				date: dto.date,
				userId: user.id,
				adminId,
				completed: dto.completed ?? true,
			});
		} else {
			row.completed = dto.completed ?? !row.completed;
		}

		return this.completionRepo.save(row);
	}

	async listCompletions(user: User, from?: string, to?: string) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const qb = this.completionRepo
			.createQueryBuilder('c')
			.where('c.adminId = :adminId', { adminId })
			.andWhere('c.userId = :userId', { userId: user.id });

		if (from) qb.andWhere('c.date >= :from', { from });
		if (to) qb.andWhere('c.date <= :to', { to });

		const rows = await qb.orderBy('c.date', 'DESC').getMany();

		// ✅ convert to MAP { "itemId_YYYY-MM-DD": true }
		const completions: Record<string, boolean> = {};
		for (const r of rows) {
			const key = `${r.itemId}_${r.date}`;
			if (r.completed) completions[key] = true;
		}

		return { completions };
	}

	async patchCompletion(
		user: User,
		dto: { key?: string; completed: boolean; itemId?: string; date?: string },
	) {
		if (typeof dto?.completed !== 'boolean') {
			throw new BadRequestException('completed must be boolean');
		}

		const key = dto.key ?? (dto.itemId && dto.date ? `${dto.itemId}_${dto.date}` : undefined);
		if (!key) throw new BadRequestException('Provide key OR (itemId and date)');

		const [itemId, date] = dto.itemId && dto.date ? [dto.itemId, dto.date] : key.split('_');
		if (!itemId || !date) throw new BadRequestException('Invalid completion key');

		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const item = await this.itemRepo.findOne({ where: { id: itemId, adminId, userId: user.id } });
		if (!item) throw new NotFoundException('Item not found');

		if (dto.completed === false) {
			await this.completionRepo.delete({ itemId, date, userId: user.id, adminId } as any);
			return { key, completed: false };
		}

		let row = await this.completionRepo.findOne({
			where: { itemId, date, userId: user.id, adminId },
		});

		if (!row) {
			row = this.completionRepo.create({
				itemId,
				date,
				userId: user.id,
				adminId,
				completed: true,
			});
		} else {
			row.completed = true;
		}

		await this.completionRepo.save(row);

		return { key, completed: true };
	}


	// ===========================
	// Settings
	// ===========================
	async getSettings(user: User) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		let settings = await this.settingsRepo.findOne({ where: { adminId, userId: user.id } });

		if (!settings) {
			settings = this.settingsRepo.create({
				userId: user.id,
				adminId,
				showWeekNumbers: false,
				highlightWeekend: true,
				weekendDays: [5, 6],
				startOfWeek: 6,
				confirmBeforeDelete: true,
			});
			settings = await this.settingsRepo.save(settings);
		}

		return settings;
	}

	async updateSettings(user: User, dto: UpdateCalendarSettingsDto) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const settings = await this.getSettings(user);
		Object.assign(settings, dto);
		return this.settingsRepo.save(settings);
	}

	// ===========================
	// Commitment Timer
	// ===========================
	async getCommitment(user: User) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		let timer = await this.commitmentRepo.findOne({ where: { adminId, userId: user.id } });
		if (!timer) {
			timer = this.commitmentRepo.create({ adminId, userId: user.id, startTimeMs: null, isRunning: false });
			timer = await this.commitmentRepo.save(timer);
		}
		return timer;
	}

	async startCommitment(user: User, dto: StartCommitmentDto) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const timer = await this.getCommitment(user);
		const startMs = dto.startTimeMs ?? Date.now();

		timer.startTimeMs = String(startMs);
		timer.isRunning = true;

		return this.commitmentRepo.save(timer);
	}

	async pauseCommitment(user: User, dto: PauseCommitmentDto) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const timer = await this.getCommitment(user);
		timer.isRunning = dto.isRunning ?? false;
		return this.commitmentRepo.save(timer);
	}

	async resetCommitment(user: User) {
		const adminId = this.getTenantAdminId(user);
		this.assertTenant(adminId);

		const timer = await this.getCommitment(user);
		timer.startTimeMs = null;
		timer.isRunning = false;
		return this.commitmentRepo.save(timer);
	}
}
