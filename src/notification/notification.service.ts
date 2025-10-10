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
  const skip = (page - 1) * take; // guaranteed >= 0

  return { page, take, skip };
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    private readonly gateway: NotificationGateway, // <-- add
  ) {}

  async create(opts: { type: NotificationType; title: string; message?: string | null; data?: Record<string, any> | null; audience?: NotificationAudience; userId?: number | null }): Promise<Notification> {
    const notification = this.repo.create({
      type: opts.type,
      title: opts.title,
      message: opts.message ?? null,
      data: opts.data ?? null,
      audience: opts.audience ?? NotificationAudience.ADMIN,
      user: opts.userId ? ({ id: opts.userId } as any) : null,
    });
    const saved = await this.repo.save(notification);

    // push realtime event (non-blocking)
    try {
      this.gateway.broadcastNew(saved);
    } catch (e) {
      // log & ignore
      // console.error('gateway.emit error', e);
    }
    return saved;
  }

  async listAdmin(page: number | string = 1, limit: number | string = 20, isRead?: boolean) {
    // --- normalize pagination (never negative) ---
    const pNumRaw = Number(page);
    const lNumRaw = Number(limit);

    const p = Number.isFinite(pNumRaw) && pNumRaw > 0 ? Math.floor(pNumRaw) : 1;
    const takeUncapped = Number.isFinite(lNumRaw) && lNumRaw > 0 ? Math.floor(lNumRaw) : 20;
    const take = Math.min(takeUncapped, 100);
    const skip = (p - 1) * take;

    // --- filters ---
    const where: FindOptionsWhere<Notification> = {};
    if (typeof isRead === 'boolean') where.isRead = isRead;
    // If you only want admin-broadcast notifications, uncomment:
    // where.audience = NotificationAudience.ADMIN as any;

    const [items, total] = await this.repo.findAndCount({
      where,
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

  async list(page?: number | string, limit?: number | string, isRead?: boolean, userId?: number) {
    const { page: p, take, skip } = normalizePagination(page, limit, 100);

    const where: FindOptionsWhere<Notification> = {};
    if (userId) where.user = { id: userId } as any;
    if (typeof isRead === 'boolean') where.isRead = isRead;

    const [items, total] = await this.repo.findAndCount({
      where,
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

  async markAllRead() {
    await this.repo.createQueryBuilder().update().set({ isRead: true }).execute();
    return { ok: true };
  }

  async unreadCount() {
    const count = await this.repo.count({ where: { isRead: false } });
    return { count };
  }
}
