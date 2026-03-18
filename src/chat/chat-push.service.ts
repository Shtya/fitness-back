import { Injectable, Logger } from '@nestjs/common';

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
    },
  ) {
    try {
      const { Expo } = await this.getExpoModule();
      const expo = new Expo();

      const validTokens = (tokens || []).filter(token => Expo.isExpoPushToken(token));

      if (!validTokens.length) return;

      const messages = validTokens.map(token => ({
        to: token,
        sound: payload.sound ?? 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        priority: 'high' as const,
        channelId: 'so7bafit_chat',
      }));

      const chunks = expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          await expo.sendPushNotificationsAsync(chunk);
        } catch (error) {
          this.logger.error('Expo push send error', error);
        }
      }
    } catch (error) {
      this.logger.error('Failed to load expo-server-sdk dynamically', error);
    }
  }
}