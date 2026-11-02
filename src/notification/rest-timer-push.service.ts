import { BadRequestException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { WebPushService } from './web-push.service';

/** Longest rest a client may schedule; anything longer is a bad timestamp, not a rest. */
const MAX_DELAY_MS = 2 * 60 * 60 * 1000;

function clip(value: unknown, max: number): string {
	return String(value ?? '').trim().slice(0, max);
}

/**
 * The workouts page rest timer, delivered as a Web Push when it ends.
 *
 * A phone freezes the page (and its timers) as soon as the user switches app, so the page
 * cannot raise its own "rest is over" alert; the server sends it at the end time instead.
 * One pending timer per user, in memory: a backend restart drops pending rests, which only
 * means that one notification is missed.
 */
@Injectable()
export class RestTimerPushService implements OnModuleDestroy {
	private readonly timers = new Map<string, NodeJS.Timeout>();

	constructor(private readonly webPush: WebPushService) {}

	schedule(userId: string, input: { endsAt?: string; title?: string; body?: string }) {
		const at = Date.parse(String(input?.endsAt || ''));
		const delay = at - Date.now();
		if (!Number.isFinite(at) || delay < -5_000 || delay > MAX_DELAY_MS) {
			throw new BadRequestException('endsAt must be a time within the next two hours');
		}
		this.cancel(userId);
		const title = clip(input?.title, 80) || 'Rest is over';
		const body = clip(input?.body, 160) || 'Time for your next set';
		const timer = setTimeout(() => {
			this.timers.delete(userId);
			void this.webPush
				.sendToUser(userId, { title, body, url: '/dashboard/my/workouts', tag: 'rest-timer' })
				.catch(() => undefined);
		}, Math.max(0, delay));
		timer.unref?.();
		this.timers.set(userId, timer);
		return { scheduled: true, endsAt: new Date(at).toISOString() };
	}

	cancel(userId: string) {
		const timer = this.timers.get(userId);
		if (timer) clearTimeout(timer);
		this.timers.delete(userId);
		return { cancelled: Boolean(timer) };
	}

	onModuleDestroy() {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
	}
}
