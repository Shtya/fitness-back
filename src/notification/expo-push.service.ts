// src/notifications/expo-push.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

@Injectable()
export class ExpoPushService {
  private readonly expo = new Expo();
  private readonly logger = new Logger(ExpoPushService.name);

  async sendToTokens(tokens: string[], payload: {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  badge?: number;
}) {
  const validTokens = (tokens ?? []).filter(t => Expo.isExpoPushToken(t));
  if (!validTokens.length) {
    return { sent: 0, invalid: tokens?.length ?? 0 };
  }

  const messages: ExpoPushMessage[] = validTokens.map(to => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: payload.sound ?? 'default',
    badge: payload.badge,
    priority: 'high',
  }));

  let sent = 0;

  const chunks = this.expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] = await this.expo.sendPushNotificationsAsync(chunk);
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