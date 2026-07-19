import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscription } from '../../entities/alert.entity';

@Injectable()
export class WebPushService {
	private readonly logger = new Logger(WebPushService.name);
	private readonly configured: boolean;

	constructor(
		@InjectRepository(PushSubscription)
		private readonly subscriptions: Repository<PushSubscription>,
	) {
		const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
		const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
		const subject = process.env.PUSH_SUBJECT?.trim() || 'mailto:admin@example.com';
		this.configured = Boolean(publicKey && privateKey);
		if (publicKey && privateKey) {
			webpush.setVapidDetails(subject, publicKey, privateKey);
		} else {
			this.logger.warn('Web Push disabled: VAPID keys are missing');
		}
	}

	async sendToUser(
		userId: string,
		payload: {
			title: string;
			body: string;
			url?: string;
			tag?: string;
			data?: Record<string, unknown>;
		},
	) {
		if (!this.configured || !userId) return [];
		const rows = await this.subscriptions.find({ where: { userId } });
		if (!rows.length) return [];

		return Promise.all(
			rows.map(async subscription => {
				try {
					const response = await webpush.sendNotification(
						{
							endpoint: subscription.endpoint,
							keys: {
								p256dh: subscription.p256dh,
								auth: subscription.auth,
							},
						},
						JSON.stringify({
							title: payload.title,
							body: payload.body,
							icon: '/logo/logo1.png',
							badge: '/logo/logo1.png',
							tag: payload.tag || `user-${userId}`,
							renotify: true,
							requireInteraction: false,
							vibrate: [200, 100, 200],
							data: {
								...(payload.data || {}),
								url: payload.url || '/dashboard/whatsapp',
							},
						}),
						{ TTL: 3600, urgency: 'high' },
					);
					subscription.lastSentAt = new Date();
					subscription.failures = 0;
					await this.subscriptions.save(subscription);
					return { ok: true, status: response.statusCode };
				} catch (error: any) {
					const status = Number(error?.statusCode || 0);
					if ([403, 404, 410].includes(status)) {
						await this.subscriptions.remove(subscription);
					} else {
						subscription.failures = (subscription.failures || 0) + 1;
						await this.subscriptions.save(subscription);
					}
					this.logger.warn(
						`Web Push failed for user ${userId}: ${error?.message || error}`,
					);
					return { ok: false, status };
				}
			}),
		);
	}
}
