import { Injectable, Logger } from '@nestjs/common';
import { ExpoPushService } from '../notification/expo-push.service';
import { NOTIFICATION_CHANNELS } from '../notification/notification-channels';

@Injectable()
export class ChatPushService {
  private readonly logger = new Logger(ChatPushService.name);

  constructor(private readonly expoPushService: ExpoPushService) {}

  /**
   * @returns dead Expo tokens that should be removed from the user record
   */
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
  ): Promise<string[]> {
    try {
      const result = await this.expoPushService.sendToTokens(tokens || [], {
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        sound: payload.sound ?? 'default',
        badge: payload.badge,
        channelId: NOTIFICATION_CHANNELS.CHAT,
      });
      if (result.deadTokens?.length) {
        this.logger.warn(`[ChatPush] ${result.deadTokens.length} dead token(s) to prune`);
      }
      return result.deadTokens || [];
    } catch (error) {
      this.logger.error('Failed to send chat push', error);
      return [];
    }
  }
}
