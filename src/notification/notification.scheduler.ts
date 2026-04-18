import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from './notification.service';
import { NotificationAudience, User } from 'entities/global.entity';

@Injectable()
export class NotificationScheduler {
	constructor(
		@InjectRepository(User) private readonly userRepo: Repository<User>,
		private readonly notificationService: NotificationService,
	) {}

	@Cron('0 8 * * *')
	async runDailyUserNotifications() {
		const today = new Date();
		const mm = String(today.getMonth() + 1).padStart(2, '0');
		const dd = String(today.getDate()).padStart(2, '0');
		const todayDate = `${today.getFullYear()}-${mm}-${dd}`;

		const users = await this.userRepo.find({
			select: ['id', 'name', 'birthDate', 'subscriptionEnd', 'adminId', 'coachId'],
		});

		for (const u of users) {
			const locale = 'en';

			if (u.birthDate) {
				const b = new Date(u.birthDate);
				const bmm = String(b.getMonth() + 1).padStart(2, '0');
				const bdd = String(b.getDate()).padStart(2, '0');
				if (bmm === mm && bdd === dd) {
					await this.notificationService.createEvent({
						event: 'birthday',
						locale,
						payload: { userName: u.name, userId: u.id, dayKey: todayDate },
						audience: NotificationAudience.USER,
						userId: u.id,
					});
				}
			}

			if (u.subscriptionEnd === todayDate) {
				if (u.adminId) {
					await this.notificationService.createEvent({
						event: 'subscription_ended',
						locale,
						payload: { userName: u.name, userId: u.id, dayKey: todayDate },
						audience: NotificationAudience.USER,
						userId: u.adminId,
					});
				}
				if (u.coachId) {
					await this.notificationService.createEvent({
						event: 'subscription_ended',
						locale,
						payload: { userName: u.name, userId: u.id, dayKey: todayDate },
						audience: NotificationAudience.USER,
						userId: u.coachId,
					});
				}
			}
		}
	}
}
