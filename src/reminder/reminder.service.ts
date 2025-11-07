import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, LessThanOrEqual, DataSource } from 'typeorm';
import * as webpush from 'web-push';

import { Reminder, UserReminderSettings, PushSubscription, NotificationLog } from 'entities/alert.entity';

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectRepository(Reminder) private readonly remindersRepo: Repository<Reminder>,
    @InjectRepository(UserReminderSettings) private readonly settingsRepo: Repository<UserReminderSettings>,
    @InjectRepository(PushSubscription) private readonly subsRepo: Repository<PushSubscription>,
    @InjectRepository(NotificationLog) private readonly logsRepo: Repository<NotificationLog>,
		private readonly db: DataSource,
  ) {
    // web-push config
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const sub = process.env.PUSH_SUBJECT || 'mailto:admin@example.com';
    if (pub && priv) {
      webpush.setVapidDetails(sub, pub, priv);
    } else {
      this.logger.warn('VAPID keys missing — push endpoints will fail until provided.');
    }
  }

  /* ---------------- Helpers ---------------- */

  private async getReminderOrThrow(userId: string, id: string) {
    const rem = await this.remindersRepo.findOne({ where: { id, userId } });
    if (!rem) throw new NotFoundException('Reminder not found');
    return rem;
  }

  private ensureOwner(rem: Reminder, userId: string) {
    if (rem.userId !== userId) throw new ForbiddenException('Forbidden');
  }

  /* ---------------- Reminders CRUD ---------------- */

	 async sendNow(userId: string, dto: any) {
    let title = dto.title ?? 'Test';
    let body = dto.body ?? 'This is a test';
    let icon = dto.icon ?? '/icons/bell.png';
    let url = dto.url ?? '/';
    let data = dto.data ?? {};
    let requireInteraction = !!dto.requireInteraction;
    let reminderId: string | null = null;

    if (dto.reminderId) {
      const rem = await this.remindersRepo.findOne({ where: { id: dto.reminderId, userId } as any });
      if (!rem) throw new NotFoundException('Reminder not found');
      reminderId = rem.id as any;

      // ⬇ Map your fields as you already do in your module (no new logic)
      title = rem.title ?? title;
      body = (rem.description as any) ?? body;
      // If you keep user-facing link per reminder, map it here:
      // url = rem.deepLink || url;
      // Any metadata you store on reminder can also be attached:
      data = { ...data, reminderId: rem.id, type: rem.type ?? 'custom' };
    }

    // target subscriptions (reuse your table)
    const targets = dto.subscriptionId
      ? await this.subsRepo.find({ where: { id: dto.subscriptionId, userId } as any })
      : await this.subsRepo.find({ where: { userId } as any });

    const results: Array<{ subscriptionId: string; ok: boolean; status?: number | null; error?: string }> = [];
    for (const sub of targets) {
      try {
        const payload = JSON.stringify({
          title,
          body,
          icon,
          data: { ...data, url },
          requireInteraction,
        });

        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: (sub as any).p256dh, auth: (sub as any).auth } },
          payload,
        );

        results.push({ subscriptionId: (sub as any).id, ok: true });
      } catch (err: any) {
        const status = err?.statusCode || null;
        results.push({ subscriptionId: (sub as any).id, ok: false, status, error: err?.message || 'unknown' });

        // Clean up dead subs—keeps your current logic
        if (status === 404 || status === 410) {
          await this.subsRepo.delete((sub as any).id);
        }
      }
    }

    // Optional logging using your EXISTING logs table (if present)
    // Adjust table/column names to your schema. Wrapped in try/catch so it
    // won’t break if you don’t have a logs table.
    try {
      await this.db.createQueryRunner().manager.query(
        `
        INSERT INTO reminders_logs (user_id, reminder_id, title, body, payload, results, created_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
        `,
        [
          userId,
          reminderId,
          title,
          body,
          JSON.stringify({ icon, url, data, requireInteraction }),
          JSON.stringify(results),
        ],
      );
    } catch (e) {
      // If you don’t have a logs table, we just skip. No new entity created.
      this.logger.verbose('Skipping log insert (no reminders_logs table or different shape).');
    }

    return { sentTo: results.length, results };
  }


  async list(userId: string, q: { active?: boolean; completed?: boolean; type?: string; fromDate?: string; toDate?: string }) {
    const where: FindOptionsWhere<Reminder> = { userId };

    if (typeof q.active === 'boolean') where.isActive = q.active;
    if (typeof q.completed === 'boolean') where.isCompleted = q.completed;
    if (q.type) (where as any).type = q.type;

    // base fetch
    const list = await this.remindersRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });

    // optional date-window intersect
    if (q.fromDate || q.toDate) {
      const from = q.fromDate ? new Date(q.fromDate) : null;
      const to = q.toDate ? new Date(q.toDate) : null;
      return list.filter(r => {
        const s = r.schedule;
        const start = new Date(s.startDate + 'T00:00:00');
        const end = s.endDate ? new Date(s.endDate + 'T23:59:59') : null;
        if (from && end && end < from) return false;
        if (to && start > to) return false;
        return true;
      });
    }
    return list;
  }

  async get(userId: string, id: string) {
    return this.getReminderOrThrow(userId, id);
  }

  async create(userId: string, dto: any) {
    const rem = this.remindersRepo.create({
      userId,
      ...dto,
      isActive: dto.isActive ?? true,
      isCompleted: dto.isCompleted ?? false,
    });

    return this.remindersRepo.save(rem);
  }

  async update(userId: string, id: string, dto: any) {
    const rem = await this.getReminderOrThrow(userId, id);
    this.ensureOwner(rem, userId);
    Object.assign(rem, dto);
    return this.remindersRepo.save(rem);
  }

  async remove(userId: string, id: string) {
    const rem = await this.getReminderOrThrow(userId, id);
    this.ensureOwner(rem, userId);
    await this.remindersRepo.remove(rem);
    return { ok: true };
  }

  async toggle(userId: string, id: string) {
    const rem = await this.getReminderOrThrow(userId, id);
    this.ensureOwner(rem, userId);
    rem.isActive = !rem.isActive;
    return this.remindersRepo.save(rem);
  }

  async complete(userId: string, id: string) {
    const rem = await this.getReminderOrThrow(userId, id);
    this.ensureOwner(rem, userId);
    rem.isCompleted = true;
    rem.metrics = {
      ...rem.metrics,
      doneCount: (rem.metrics?.doneCount ?? 0) + 1,
      lastAckAt: new Date(),
      streak: (rem.metrics?.streak ?? 0) + 1,
      skipCount: rem.metrics?.skipCount ?? 0,
    };
    return this.remindersRepo.save(rem);
  }

  async snooze(userId: string, id: string, minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) throw new BadRequestException('minutes must be > 0');
    const rem = await this.getReminderOrThrow(userId, id);
    this.ensureOwner(rem, userId);
    rem.metrics = {
      ...rem.metrics,
      skipCount: (rem.metrics?.skipCount ?? 0) + 1,
    };
    return this.remindersRepo.save(rem);
  }

  /* ---------------- User Settings ---------------- */

  async getUserSettings(userId: string) {
    let s = await this.settingsRepo.findOne({ where: { userId } });
    if (!s) {
      s = this.settingsRepo.create({
        userId,
        timezone: 'Africa/Cairo',
        city: 'Cairo',
        country: 'Egypt',
        defaultSnooze: 10,
        quietHours: { start: '10:00 PM', end: '07:00 AM' },
        priorityDefault: 'normal',
        soundDefault: 'chime',
      });
      s = await this.settingsRepo.save(s);
    }
    return s;
  }

  async updateUserSettings(userId: string, patch: any) {
    const s = await this.getUserSettings(userId);
    Object.assign(s, patch || {});
    return this.settingsRepo.save(s);
  }

  /* ---------------- Push (VAPID) ---------------- */

  getVapidPublicKey() {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) throw new BadRequestException('VAPID_PUBLIC_KEY not set');
    return { publicKey: key };
  }

  async subscribePush(userId: string | null, body: { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime?: string | null }, ua?: string, ip?: string) {
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      throw new BadRequestException('Invalid subscription');
    }
    let found = await this.subsRepo.findOne({ where: { endpoint: body.endpoint } });

    if (!found) {
      found = this.subsRepo.create({
        userId: userId || null,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        expirationTime: body.expirationTime ? new Date(body.expirationTime) : null,
        userAgent: ua || null,
        ipAddress: ip || null,
      });
    } else {
      // update ownership if became known
      if (userId && !found.userId) found.userId = userId;
      found.p256dh = body.keys.p256dh;
      found.auth = body.keys.auth;
      found.userAgent = ua || found.userAgent;
      found.ipAddress = ip || found.ipAddress;
    }

    await this.subsRepo.save(found);
    return { ok: true };
  }

  async sendPushToUser(userId: string, payload: Record<string, any>) {
    const subs = await this.subsRepo.find({ where: [{ userId }, { userId: null }] }); // تقدر تغيّر الاستراتيجية
    if (!subs.length) return [];

    const results: any[] = [];
    for (const s of subs) {
      const log = this.logsRepo.create({
        userId,
        reminderId: payload?.reminderId || null,
        status: 'queued',
        payload,
      });
      const savedLog = await this.logsRepo.save(log);

      try {
        const res = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any, JSON.stringify(payload));
        s.lastSentAt = new Date();
        await this.subsRepo.save(s);

        savedLog.status = 'sent';
        savedLog.sentAt = new Date();
        await this.logsRepo.save(savedLog);

        results.push({ endpoint: s.endpoint, ok: true, status: res.statusCode });
      } catch (err: any) {
        this.logger.warn(`Push failed ${s.endpoint}: ${err?.statusCode || ''}`);

        s.failures = (s.failures ?? 0) + 1;
        await this.subsRepo.save(s);

        savedLog.status = 'failed';
        savedLog.error = { code: err?.statusCode, message: String(err?.message || err) };
        await this.logsRepo.save(savedLog);

        // تنظيف الاشتراكات المنتهية
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await this.subsRepo.remove(s);
        }
        results.push({ endpoint: s.endpoint, ok: false, status: err?.statusCode });
      }
    }
    return results;
  }

  async adminBroadcast(payload: Record<string, any>) {
    const subs = await this.subsRepo.find();
    const results: any[] = [];
    for (const s of subs) {
      try {
        const res = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any, JSON.stringify(payload));
        s.lastSentAt = new Date();
        await this.subsRepo.save(s);
        results.push({ endpoint: s.endpoint, ok: true, status: res.statusCode });
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await this.subsRepo.remove(s);
        }
        results.push({ endpoint: s.endpoint, ok: false, status: err?.statusCode });
      }
    }
    return results;
  }
}
