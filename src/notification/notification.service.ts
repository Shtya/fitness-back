// notification/notification.service.ts (updated)
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Notification, NotificationAudience, NotificationType, User, UserRole } from 'entities/global.entity';
import { NotificationGateway } from './notification.gateway';

export function normalizePagination(pageInput?: number | string, limitInput?: number | string, maxLimit = 100) {
	const pageNum = Number(pageInput);
	const limitNum = Number(limitInput);

	const page = Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1;
	const takeRaw = Number.isFinite(limitNum) && limitNum > 0 ? Math.floor(limitNum) : 20;

	const take = Math.min(takeRaw, maxLimit);
	const skip = (page - 1) * take;

	return { page, take, skip };
}

@Injectable()
export class NotificationService {
	constructor(
		@InjectRepository(Notification)
		private readonly repo: Repository<Notification>,

		@InjectRepository(User)
		private readonly userRepo: Repository<User>,

		private readonly gateway: NotificationGateway,
	) { }

	async registerExpoPushToken(userId: string, token: string) {
		if (!token || typeof token !== 'string') {
			throw new BadRequestException('Invalid Expo push token');
		}

		const user = await this.userRepo.findOne({ where: { id: userId } });
		if (!user) throw new NotFoundException('User not found');

		const existing = user.expoPushTokens ?? [];

		if (!existing.includes(token)) {
			user.expoPushTokens = [...existing, token];
			await this.userRepo.save(user);
		}

		return { ok: true };
	}

	async unregisterExpoPushToken(userId: string, token: string) {
		const user = await this.userRepo.findOne({ where: { id: userId } });
		if (!user) throw new NotFoundException('User not found');

		const existing = user.expoPushTokens ?? [];
		user.expoPushTokens = existing.filter(t => t !== token);

		await this.userRepo.save(user);

		return { ok: true };
	}


	async create(opts: {
		type: NotificationType;
		title: string;
		message?: string | null;
		data?: Record<string, any> | null;
		audience?: NotificationAudience;
		userId?: string | null;
		user?: User;
	}): Promise<Notification> {
		const notification = this.repo.create({
			type: opts.type,
			title: opts.title,
			message: opts.message ?? null,
			data: opts.data ?? null,
			audience: opts.audience ?? NotificationAudience.ADMIN,
			user: opts.userId ? ({ id: opts.userId } as any) : opts.user || null,
		});

		const saved = await this.repo.save(notification);

		// Push realtime event (non-blocking)
		try {
			this.gateway.broadcastNew(saved);
		} catch (e) {
			// Log error but don't fail the request
			console.error('WebSocket notification error:', e);
		}

		return saved;
	}

	private isAr(locale?: string) {
		return String(locale || '').toLowerCase().startsWith('ar');
	}

	async createEvent(opts: {
		event:
			| 'form_submitted'
			| 'weekly_report_submitted'
			| 'weekly_report_updated'
			| 'weekly_report_feedback'
			| 'subscription_expired_login'
			| 'birthday'
			| 'subscription_ended';
		locale?: string;
		payload?: Record<string, any>;
		audience?: NotificationAudience;
		userId?: string | null;
		type?: NotificationType;
	}) {
		const ar = this.isAr(opts.locale);
		const p = opts.payload || {};
		let title = 'Notification';
		let message = '';

		switch (opts.event) {
			case 'form_submitted':
				title = ar ? `إرسال جديد على "${p.formTitle || 'النموذج'}"` : `New submission on "${p.formTitle || 'form'}"`;
				message = ar
					? `البريد: ${p.email || '-'} | الهاتف: ${p.phone || '-'}`
					: `Email: ${p.email || '-'} | Phone: ${p.phone || '-'}`;
				break;
			case 'weekly_report_submitted':
				title = ar ? 'تم إرسال التقرير الأسبوعي' : 'New Weekly Report Submitted';
				message = ar
					? `${p.userName || 'عميل'} قام بإرسال التقرير الأسبوعي للأسبوع ${p.weekOf || ''}`
					: `${p.userName || 'Client'} has submitted the weekly report for ${p.weekOf || ''}`;
				break;
			case 'weekly_report_updated':
				title = ar ? 'تم تحديث التقرير الأسبوعي' : 'Weekly Report Updated';
				message = ar
					? `${p.userName || 'عميل'} قام بتحديث التقرير الأسبوعي للأسبوع ${p.weekOf || ''}`
					: `${p.userName || 'Client'} updated the weekly report for ${p.weekOf || ''}`;
				break;
			case 'weekly_report_feedback':
				title = ar ? 'تم إضافة ملاحظات من الكوتش' : 'Coach Feedback Received';
				message = ar
					? `تمت إضافة ملاحظات على تقريرك الأسبوعي (${p.weekOf || ''})`
					: `Your coach has provided feedback on your weekly report for ${p.weekOf || ''}`;
				break;
			case 'subscription_expired_login':
				title = ar ? 'محاولة دخول باشتراك منتهي' : 'Expired subscription login attempt';
				message = ar
					? `المستخدم ${p.email || ''} حاول تسجيل الدخول لكن الاشتراك منتهي.`
					: `User with email ${p.email || ''} tried to log in but their subscription is expired.`;
				break;
			case 'birthday':
				title = ar ? 'عيد ميلاد سعيد!' : 'Happy Birthday!';
				message = ar
					? `نتمنى لك يومًا رائعًا يا ${p.userName || ''}`
					: `Wishing you an amazing day, ${p.userName || ''}`;
				break;
			case 'subscription_ended':
				title = ar ? 'انتهى اشتراك العميل' : 'Client subscription ended';
				message = ar
					? `انتهى اشتراك ${p.userName || 'عميل'} اليوم.`
					: `${p.userName || 'Client'} subscription ended today.`;
				break;
			default:
				break;
		}

		return this.create({
			type: opts.type ?? NotificationType.FORM_SUBMISSION,
			title,
			message,
			data: { ...(opts.payload || {}), event: opts.event, locale: opts.locale || 'en' },
			audience: opts.audience ?? NotificationAudience.ADMIN,
			userId: opts.userId ?? null,
		});
	}

	async listAdmin(page: number | string = 1, limit: number | string = 20, isRead?: boolean) {
		const { page: p, take, skip } = normalizePagination(page, limit);

		const where: FindOptionsWhere<Notification> = {};
		if (typeof isRead === 'boolean') where.isRead = isRead;

		const [items, total] = await this.repo.findAndCount({
			where,
			relations: ['user'],
			order: { created_at: 'DESC' },
			take,
			skip,
		});

		return {
			items,
			total,
			page: p,
			limit: take,
			hasMore: skip + take < total,
		};
	}

	async list(page?: number | string, limit?: number | string, isRead?: boolean, userId?: string) {
		const { page: p, take, skip } = normalizePagination(page, limit);

		const where: FindOptionsWhere<Notification> = {};
		if (userId) where.user = { id: userId } as any;
		if (typeof isRead === 'boolean') where.isRead = isRead;

		const [items, total] = await this.repo.findAndCount({
			where,
			relations: ['user'],
			order: { created_at: 'DESC' },
			take,
			skip,
		});

		return {
			items,
			total,
			page: p,
			limit: take,
			hasMore: skip + take < total,
		};
	}

	async listForUser(
		user: User,
		page?: number | string,
		limit?: number | string,
		isRead?: boolean,
	) {
		const { page: p, take, skip } = normalizePagination(page, limit);

		const qb = this.repo
			.createQueryBuilder('n')
			.leftJoinAndSelect('n.user', 'user')
			.orderBy('n.created_at', 'DESC')
			.take(take)
			.skip(skip);

		if (typeof isRead === 'boolean') {
			qb.andWhere('n.isRead = :isRead', { isRead });
		}

		if (user.role === UserRole.CLIENT) {
			qb.andWhere('user.id = :userId', { userId: user.id });
		} else {
			qb.andWhere('(n.audience = :adminAudience OR user.id = :userId)', {
				adminAudience: NotificationAudience.ADMIN,
				userId: user.id,
			});
		}

		const [items, total] = await qb.getManyAndCount();

		return {
			items,
			total,
			page: p,
			limit: take,
			hasMore: skip + take < total,
		};
	}

	async markRead(id: number) {
		await this.repo.update(id, { isRead: true });
		return { id, isRead: true };
	}

	async unreadCountForUser(user: User) {
		const qb = this.repo
			.createQueryBuilder('n')
			.leftJoin('n.user', 'user')
			.where('n.isRead = false');

		if (user.role === UserRole.CLIENT) {
			qb.andWhere('user.id = :userId', { userId: user.id });
		} else {
			qb.andWhere('(n.audience = :adminAudience OR user.id = :userId)', {
				adminAudience: NotificationAudience.ADMIN,
				userId: user.id,
			});
		}

		const count = await qb.getCount();
		return { count };
	}

	async markAllRead(userId?: string) {
		if (userId) {
			await this.repo
				.createQueryBuilder()
				.update(Notification)
				.set({ isRead: true })
				.where('user_id = :userId', { userId })
				.execute();
		} else {
			await this.repo
				.createQueryBuilder()
				.update(Notification)
				.set({ isRead: true })
				.execute();
		}

		return { ok: true };
	}

	async unreadCount(userId?: string) {
		const where: FindOptionsWhere<Notification> = { isRead: false };
		if (userId) where.user = { id: userId } as any;

		const count = await this.repo.count({ where });
		return { count };
	}

	// Specialized method for weekly report notifications
	async createWeeklyReportNotification(user: User, weekOf: string, coachId: string) {
		return this.create({
			type: NotificationType.FORM_SUBMISSION,
			title: 'New Weekly Report Submitted',
			message: `${user.name} has submitted their weekly report for ${weekOf}`,
			data: {
				type: 'weekly_report',
				userId: user.id,
				userName: user.name,
				weekOf,
				timestamp: new Date().toISOString(),
			},
			audience: NotificationAudience.USER,
			userId: coachId,
		});
	}

	async createCoachFeedbackNotification(userId: string, weekOf: string, reportId: string) {
		return this.create({
			type: NotificationType.FORM_SUBMISSION,
			title: 'Coach Feedback Received',
			message: `Your coach has provided feedback on your weekly report for ${weekOf}`,
			data: {
				type: 'weekly_report_feedback',
				reportId,
				weekOf,
				timestamp: new Date().toISOString(),
			},
			audience: NotificationAudience.USER,
			userId,
		});
	}
}