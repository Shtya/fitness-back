import { Injectable, Logger } from '@nestjs/common';
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { NOTIFICATION_CHANNELS } from '../notification/notification-channels';

@Injectable()
export class ChatPushService {
  private readonly logger = new Logger(ChatPushService.name);

  private async getExpoModule() {
    return await import('expo-server-sdk');
  }

  async sendPushNotifications(
    tokens: string[],
    payload: {
      title: string;
      body: string;
      data?: Record<string, any>;
      sound?: 'default' | null;
      /** Total unread count for the receiver — drives the app icon badge. */
      badge?: number;
    },
  ) {
    try {
      const { Expo } = await this.getExpoModule();
      const expo = new Expo();

      const validTokens = (tokens || []).filter(token => Expo.isExpoPushToken(token));

      if (!validTokens.length) return;

      const messages: ExpoPushMessage[] = validTokens.map(token => ({
        to: token,
        sound: payload.sound ?? 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        badge: payload.badge,
        priority: 'high',
        channelId: NOTIFICATION_CHANNELS.CHAT,
        interruptionLevel: 'time-sensitive',
      }));

      const chunks = expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          const tickets = await expo.sendPushNotificationsAsync(chunk);
          this.logRejectedTickets(tickets);
        } catch (error) {
          this.logger.error('Expo push send error', error);
        }
      }
    } catch (error) {
      this.logger.error('Failed to load expo-server-sdk dynamically', error);
    }
  }

  /** A rejected ticket is the only trace of a push that never reached the device. */
  private logRejectedTickets(tickets: ExpoPushTicket[]) {
    for (const ticket of tickets) {
      if (ticket.status === 'ok') continue;

      this.logger.error(
        `[ChatPush] Ticket rejected (${ticket.details?.error ?? 'unknown'}): ${ticket.message}`,
      );
    }
  }
}
