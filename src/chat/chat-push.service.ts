import { Injectable, Logger } from '@nestjs/common';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

@Injectable()
export class ChatPushService {
  private readonly logger = new Logger(ChatPushService.name);
  private expo = new Expo();

  async sendPushNotifications(
    tokens: string[],
    payload: {
      title: string;
      body: string;
      data?: Record<string, any>;
      sound?: 'default' | null;
    },
  ) {
    const validTokens = (tokens || []).filter(token => Expo.isExpoPushToken(token));

    if (!validTokens.length) return;

    const messages: ExpoPushMessage[] = validTokens.map(token => ({
      to: token,
      sound: payload.sound ?? 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      priority: 'high',
      channelId: 'so7bafit_chat',
    }));

    const chunks = this.expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      try {
        await this.expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        this.logger.error('Expo push send error', error);
      }
    }
  }
}