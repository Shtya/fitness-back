import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMessage, ChatParticipant, Notification } from 'entities/global.entity';

/**
 * Single source of truth for the app-icon badge number.
 *
 * The mobile client computes `chatUnread + inboxUnread` locally, but that only
 * runs while JS is alive. When the app is backgrounded or killed, the badge can
 * only come from the `badge` field of the push payload — so the server has to
 * compute the exact same number.
 */
@Injectable()
export class BadgeService {
  private readonly logger = new Logger(BadgeService.name);

  constructor(
    @InjectRepository(Notification) private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(ChatMessage) private readonly messageRepo: Repository<ChatMessage>,
  ) {}

  async getTotalBadge(userId: string): Promise<number> {
    if (!userId) return 0;

    const [chat, inbox] = await Promise.all([
      this.getChatUnread(userId),
      this.getInboxUnread(userId),
    ]);

    return chat + inbox;
  }

  async getChatUnread(userId: string): Promise<number> {
    try {
      const row = await this.messageRepo
        .createQueryBuilder('m')
        .select('COUNT(m.id)', 'unread')
        .innerJoin('m.conversation', 'c')
        .innerJoin(
          ChatParticipant,
          'p',
          'p.conversationId = c.id AND p.userId = :userId AND p.isActive = true',
          { userId },
        )
        .where('m.isDeleted = false')
        .andWhere('m.senderId != :userId', { userId })
        .andWhere('(p.lastReadAt IS NULL OR m.created_at > p.lastReadAt)')
        .getRawOne<{ unread: string }>();

      return Number(row?.unread ?? 0) || 0;
    } catch (err) {
      this.logger.error('[Badge] chat unread query failed', err);
      return 0;
    }
  }

  async getInboxUnread(userId: string): Promise<number> {
    try {
      return await this.notificationRepo.count({
        where: { isRead: false, user: { id: userId } as any },
      });
    } catch (err) {
      this.logger.error('[Badge] inbox unread query failed', err);
      return 0;
    }
  }
}
