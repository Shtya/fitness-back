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

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  async sendToTokens(tokens: string[], payload: ExpoPushPayload) {
    const { Expo } = await import('expo-server-sdk');

    const expo = new Expo();

    const validTokens = (tokens ?? []).filter((t) => Expo.isExpoPushToken(t));
    if (!validTokens.length) {
      return { sent: 0, invalid: tokens?.length ?? 0 };
    }

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
    }));

    let sent = 0;

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        sent += this.countAcceptedTickets(tickets);
      } catch (err) {
        this.logger.error('[ExpoPush] Failed to send chunk', err);
      }
    }

    return {
      sent,
      invalid: (tokens ?? []).length - validTokens.length,
    };
  }

  /**
   * Expo answers every message with a ticket. A rejected ticket is the only place
   * where "the push silently never arrived" becomes visible, so log it explicitly.
   */
  private countAcceptedTickets(tickets: ExpoPushTicket[]) {
    let accepted = 0;

    for (const ticket of tickets) {
      if (ticket.status === 'ok') {
        accepted += 1;
        continue;
      }

      this.logger.error(
        `[ExpoPush] Ticket rejected (${ticket.details?.error ?? 'unknown'}): ${ticket.message}`,
      );
    }

    return accepted;
  }
}
