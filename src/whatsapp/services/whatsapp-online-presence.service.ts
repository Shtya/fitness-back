import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WhatsAppGateway } from '../gateways/whatsapp.gateway';
import {
	desiredOnlinePresence,
	onlinePresenceMode,
} from '../utils/whatsapp-typing-attempts';
import { WhatsAppContactPresenceService } from './whatsapp-contact-presence.service';
import { WhatsAppProviderManagerService } from './whatsapp-provider-manager.service';

const RECONCILE_INTERVAL_MS = 60_000;
/** Re-assert `available` periodically; the server may drop it on its own. */
const ONLINE_REFRESH_MS = 10 * 60_000;
/** Baileys sends its own `unavailable` right after the socket opens. */
const AFTER_CONNECT_DELAY_MS = 4_000;
const WATCHERS_DEBOUNCE_MS = 1_500;

/**
 * Keeps the linked device `available` while CRM users have the inbox open
 * (WHATSAPP_ONLINE_PRESENCE=watching, default), so WhatsApp delivers contacts'
 * typing / recording chatstate. `always` keeps it online; `off` never does
 * (phone push notifications stay untouched, but typing is not delivered).
 */
@Injectable()
export class WhatsAppOnlinePresenceService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(WhatsAppOnlinePresenceService.name);
	private readonly mode = onlinePresenceMode(process.env.WHATSAPP_ONLINE_PRESENCE);
	private readonly connected = new Set<string>();
	private readonly lastOnlineAt = new Map<string, number>();
	private readonly pending = new Map<string, NodeJS.Timeout>();
	private interval: NodeJS.Timeout | null = null;
	private unsubscribers: Array<() => void> = [];

	constructor(
		private readonly providers: WhatsAppProviderManagerService,
		private readonly gateway: WhatsAppGateway,
		private readonly contactPresence: WhatsAppContactPresenceService,
	) {}

	onModuleInit() {
		this.logger.log(`[WHATSAPP PRESENCE] online presence mode=${this.mode}`);
		this.unsubscribers.push(
			this.providers.onProviderEvent((accountId, event) => {
				if (event.type !== 'connection') return;
				if (event.status === 'connected') {
					this.connected.add(accountId);
					this.lastOnlineAt.delete(accountId);
					this.schedule(accountId, AFTER_CONNECT_DELAY_MS);
				} else {
					this.connected.delete(accountId);
					this.lastOnlineAt.delete(accountId);
				}
			}),
			this.gateway.onAccountWatchersChanged((accountId) =>
				this.schedule(accountId, WATCHERS_DEBOUNCE_MS),
			),
		);
		this.interval = setInterval(() => {
			for (const accountId of this.connected) void this.reconcile(accountId);
		}, RECONCILE_INTERVAL_MS);
		this.interval.unref?.();
	}

	onModuleDestroy() {
		for (const off of this.unsubscribers) off();
		this.unsubscribers = [];
		if (this.interval) clearInterval(this.interval);
		for (const timer of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
	}

	private schedule(accountId: string, delayMs: number) {
		const existing = this.pending.get(accountId);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => {
			this.pending.delete(accountId);
			void this.reconcile(accountId);
		}, delayMs);
		timer.unref?.();
		this.pending.set(accountId, timer);
	}

	async reconcile(accountId: string) {
		try {
			const provider = this.providers.getProvider(accountId);
			if (!provider?.setOnlinePresence || !provider.isOnlinePresence) return;
			const watchers = this.gateway.accountWatcherCount(accountId);
			const desired = desiredOnlinePresence(this.mode, watchers);
			const current = provider.isOnlinePresence();
			if (desired) {
				const last = this.lastOnlineAt.get(accountId) || 0;
				if (current && Date.now() - last < ONLINE_REFRESH_MS) return;
				const ok = await provider.setOnlinePresence(true);
				if (!ok) return;
				this.lastOnlineAt.set(accountId, Date.now());
				if (!current) {
					// Subscriptions sent while unavailable may not deliver chatstate; renew them.
					await this.contactPresence
						.subscribeRecentDirectChats(accountId, 200, true)
						.catch(() => undefined);
				}
				return;
			}
			if (current) {
				await provider.setOnlinePresence(false);
				this.lastOnlineAt.delete(accountId);
			}
		} catch (error) {
			this.logger.warn(
				`[WHATSAPP PRESENCE] reconcile failed session=${accountId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}
}
