// src/notifications/expo-push.service.ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  async sendToTokens(
    tokens: string[],
    payload: {
      title: string;
      body: string;
      data?: Record<string, any>;
      sound?: 'default' | null;
      badge?: number;
    },
  ) {
    const { Expo } = await import('expo-server-sdk');

    const expo = new Expo();

    const validTokens = (tokens ?? []).filter((t) => Expo.isExpoPushToken(t));
    if (!validTokens.length) {
      return { sent: 0, invalid: tokens?.length ?? 0 };
    }

    const messages = validTokens.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      sound: payload.sound ?? 'default',
      badge: payload.badge,
      priority: 'high' as const,
    }));

    let sent = 0;

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        sent += tickets.length;
        this.logger.log(`[ExpoPush] Sent ${tickets.length} notifications`);
      } catch (err) {
        this.logger.error('[ExpoPush] Failed to send chunk', err);
      }
    }

    return {
      sent,
      invalid: (tokens ?? []).length - validTokens.length,
    };
  }
}