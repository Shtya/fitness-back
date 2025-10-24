// notification/notification.service.ts (updated)
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Notification, NotificationAudience, NotificationType, User } from 'entities/global.entity';
import { NotificationGateway } from './notification.gateway';

export function normalizePagination(pageInput?: number | string, limitInput?: number | string, maxLimit = 100) {
  const pageNum = Number(pageInput);
  const limitNum = Number(limitInput);

  const page = Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1;
  const takeRaw = Number.isFinite(limitNum) && limitNum > 0 ? Math.floor(limitNum) : 20;

  const take = Math.min(takeRaw, maxLimit);
  const skip = (page - 1) * take;

  return { page, take, skip };
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    private readonly gateway: NotificationGateway,
  ) {}

  async create(opts: { 
    type: NotificationType; 
    title: string; 
    message?: string | null; 
    data?: Record<string, any> | null; 
    audience?: NotificationAudience; 
    userId?: string | null;
    user?: User;
  }): Promise<Notification> {
    const notification = this.repo.create({
      type: opts.type,
      title: opts.title,
      message: opts.message ?? null,
      data: opts.data ?? null,
      audience: opts.audience ?? NotificationAudience.ADMIN,
      user: opts.userId ? ({ id: opts.userId } as any) : opts.user || null,
    });
    
    const saved = await this.repo.save(notification);

    // Push realtime event (non-blocking)
    try {
      this.gateway.broadcastNew(saved);
    } catch (e) {
      // Log error but don't fail the request
      console.error('WebSocket notification error:', e);
    }
    
    return saved;
  }

  async listAdmin(page: number | string = 1, limit: number | string = 20, isRead?: boolean) {
    const { page: p, take, skip } = normalizePagination(page, limit);

    const where: FindOptionsWhere<Notification> = {};
    if (typeof isRead === 'boolean') where.isRead = isRead;

    const [items, total] = await this.repo.findAndCount({
      where,
      relations: ['user'],
      order: { created_at: 'DESC' },
      take,
      skip,
    });

    return {
      items,
      total,
      page: p,
      limit: take,
      hasMore: skip + take < total,
    };
  }

  async list(page?: number | string, limit?: number | string, isRead?: boolean, userId?: string) {
    const { page: p, take, skip } = normalizePagination(page, limit);

    const where: FindOptionsWhere<Notification> = {};
    if (userId) where.user = { id: userId } as any;
    if (typeof isRead === 'boolean') where.isRead = isRead;

    const [items, total] = await this.repo.findAndCount({
      where,
      relations: ['user'],
      order: { created_at: 'DESC' },
      take,
      skip,
    });

    return {
      items,
      total,
      page: p,
      limit: take,
      hasMore: skip + take < total,
    };
  }

  async markRead(id: number) {
    await this.repo.update(id, { isRead: true });
    return { id, isRead: true };
  }

  async markAllRead(userId?: string) {
    if (userId) {
      await this.repo.createQueryBuilder()
        .update()
        .set({ isRead: true })
        .where('user.id = :userId', { userId })
        .execute();
    } else {
      await this.repo.createQueryBuilder()
        .update()
        .set({ isRead: true })
        .execute();
    }
    
    return { ok: true };
  }

  async unreadCount(userId?: string) {
    const where: FindOptionsWhere<Notification> = { isRead: false };
    if (userId) where.user = { id: userId } as any;

    const count = await this.repo.count({ where });
    return { count };
  }

  // Specialized method for weekly report notifications
  async createWeeklyReportNotification(user: User, weekOf: string, coachId: string) {
    return this.create({
      type: NotificationType.FORM_SUBMISSION,
      title: 'New Weekly Report Submitted',
      message: `${user.name} has submitted their weekly report for ${weekOf}`,
      data: {
        type: 'weekly_report',
        userId: user.id,
        userName: user.name,
        weekOf,
        timestamp: new Date().toISOString(),
      },
      audience: NotificationAudience.USER,
      userId: coachId,
    });
  }

  async createCoachFeedbackNotification(userId: string, weekOf: string, reportId: string) {
    return this.create({
      type: NotificationType.FORM_SUBMISSION,
      title: 'Coach Feedback Received',
      message: `Your coach has provided feedback on your weekly report for ${weekOf}`,
      data: {
        type: 'weekly_report_feedback',
        reportId,
        weekOf,
        timestamp: new Date().toISOString(),
      },
      audience: NotificationAudience.USER,
      userId,
    });
  }
}