// src/notifications/expo-push.service.ts
import { Injectable, Logger } from '@nestjs/common';
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { NOTIFICATION_CHANNELS, NotificationChannelId } from './notification-channels';

export type ExpoPushPayload = {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  /** App icon badge. Send the *total* unread count, not a delta. */
  badge?: number;
  /** Android only — decides importance, sound and heads-up behaviour. */
  channelId?: NotificationChannelId;
};

export type ExpoPushSendResult = {
  sent: number;
  invalid: number;
  /** Tokens Expo rejected as DeviceNotRegistered / InvalidCredentials — prune from DB. */
  deadTokens: string[];
};

const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials']);

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  async sendToTokens(tokens: string[], payload: ExpoPushPayload): Promise<ExpoPushSendResult> {
    const { Expo } = await import('expo-server-sdk');

    const expo = new Expo();

    const validTokens = (tokens ?? []).filter((t) => Expo.isExpoPushToken(t));
    if (!validTokens.length) {
      return { sent: 0, invalid: tokens?.length ?? 0, deadTokens: [] };
    }

    const collapseId =
      typeof payload.data?.conversationId === 'string'
        ? `chat_${payload.data.conversationId}`
        : typeof payload.data?.itemId === 'string'
          ? `calendar_${payload.data.itemId}`
          : typeof payload.data?.reminderId === 'string'
            ? `reminder_${payload.data.reminderId}`
            : undefined;

    const messages: ExpoPushMessage[] = validTokens.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      sound: payload.sound ?? 'default',
      badge: payload.badge,
      priority: 'high',
      channelId: payload.channelId ?? NOTIFICATION_CHANNELS.DEFAULT,
      // Lets the notification break through iOS Focus / Do Not Disturb.
      interruptionLevel: 'time-sensitive',
      ...(collapseId ? { collapseId } : {}),
    }));

    let sent = 0;
    const deadTokens: string[] = [];

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        const { accepted, dead } = this.inspectTickets(tickets, chunk.map((m) => String(m.to)));
        sent += accepted;
        deadTokens.push(...dead);
      } catch (err) {
        this.logger.error('[ExpoPush] Failed to send chunk', err);
      }
    }

    return {
      sent,
      invalid: (tokens ?? []).length - validTokens.length,
      deadTokens: [...new Set(deadTokens)],
    };
  }

  /**
   * Expo answers every message with a ticket. A rejected ticket is the only place
   * where "the push silently never arrived" becomes visible, so log it explicitly
   * and surface dead tokens for DB cleanup.
   */
  private inspectTickets(tickets: ExpoPushTicket[], chunkTokens: string[]) {
    let accepted = 0;
    const dead: string[] = [];

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === 'ok') {
        accepted += 1;
        continue;
      }

      const errCode = ticket.details?.error ?? 'unknown';
      this.logger.error(`[ExpoPush] Ticket rejected (${errCode}): ${ticket.message}`);

      if (DEAD_TOKEN_ERRORS.has(String(errCode))) {
        const tok = chunkTokens[i];
        if (tok) dead.push(tok);
      }
    }

    return { accepted, dead };
  }
}
