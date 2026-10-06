// weekly-report/weekly-report.service.ts
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, In } from 'typeorm';
import { WeeklyReport } from 'entities/weekly-report.entity';
import { ReportConfig } from 'entities/report-config.entity';
import { User, UserRole, NotificationType, NotificationAudience } from 'entities/global.entity';
import { NotificationService } from '../notification/notification.service';
import { parsePagination } from 'common/pagination';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_REPORT_STATUSES = ['submitted', 'pending', 'late'] as const;
type ClientReportStatus = (typeof CLIENT_REPORT_STATUSES)[number];

@Injectable()
export class WeeklyReportService {
  constructor(
    @InjectRepository(WeeklyReport)
    public readonly weeklyReportRepo: Repository<WeeklyReport>,
    @InjectRepository(User)
    public readonly userRepo: Repository<User>,
    @InjectRepository(ReportConfig)
    public readonly reportConfigRepo: Repository<ReportConfig>,
    public readonly notificationService: NotificationService,
  ) {}

  async createReport(userId: string, createDto: any, locale?: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['coach'],
      select: ['id', 'name', 'coachId', 'adminId', 'email', 'phone', 'status', 'role', 'created_at', 'updated_at'] as any,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const stamped = {
      ...createDto,
      userId,
      adminId: user.adminId ?? null,
      coachId: user.coachId ?? null,
    };

    let existing = await this.weeklyReportRepo.findOne({
      where: { userId, weekOf: createDto.weekOf },
    });

    if (!existing) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);

      existing = await this.weeklyReportRepo.createQueryBuilder('wr').where('wr.userId = :userId', { userId }).andWhere('wr.created_at BETWEEN :start AND :end', { start, end }).getOne();
    }

    if (existing) {
      const merged = this.weeklyReportRepo.merge(existing, stamped);
      const updated = await this.weeklyReportRepo.save(merged);

      if (createDto.notifyCoach && user.coachId) {
        await this.notificationService.createEvent({
          event: 'weekly_report_updated',
          locale,
          payload: {
            reportId: updated.id,
            userId: user.id,
            userName: user.name,
            weekOf: updated.weekOf,
            type: 'weekly_report',
          },
          audience: NotificationAudience.USER,
          userId: user.coachId,
          type: NotificationType.FORM_SUBMISSION,
        });
      }

      return updated;
    }

    const report = this.weeklyReportRepo.create({
      ...stamped,
      user,
    });

    const savedReport: any = await this.weeklyReportRepo.save(report);

    if (createDto.notifyCoach && user.coachId) {
      await this.notificationService.createEvent({
        event: 'weekly_report_submitted',
        locale,
        payload: {
          reportId: savedReport.id,
          userId: user.id,
          userName: user.name,
          weekOf: createDto.weekOf,
          type: 'weekly_report',
        },
        audience: NotificationAudience.USER,
        userId: user.coachId,
        type: NotificationType.FORM_SUBMISSION,
      });
    }

    return savedReport;
  }

  async findUserReports(userId: string, page: number = 1, limit: number = 10) {
    const { take, skip } = this.normalizePagination(page, limit);

    const [reports, total] = await this.weeklyReportRepo.findAndCount({
      where: { userId },
      relations: ['reviewedBy'],
      order: { created_at: 'DESC' },
      take,
      skip,
    });

    return {
      items: reports,
      total,
      page,
      limit: take,
      hasMore: skip + take < total,
    };
  }

  async findAllReports(currentUser: User, userId?: string, page: number = 1, limit: number = 10) {
    const { take, skip } = this.normalizePagination(page, limit);

    let whereCondition: any = {};

    if (userId) {
      if (currentUser.role === UserRole.COACH && currentUser.id !== userId) {
        const athlete = await this.userRepo.findOne({
          where: { id: userId, coachId: currentUser.id },
        });
        if (!athlete) {
          throw new ForbiddenException('You can only view reports from your athletes');
        }
      }
      whereCondition.userId = userId;
    } else if (currentUser.role === UserRole.COACH) {
      whereCondition.user = { coachId: currentUser.id };
    }

    const [reports, total] = await this.weeklyReportRepo.findAndCount({
      where: whereCondition,
      relations: ['user', 'reviewedBy'],
      order: { created_at: 'DESC' },
      take,
      skip,
    });

    return {
      items: reports,
      total,
      page,
      limit: take,
      hasMore: skip + take < total,
    };
  }

  async listStaffReports(currentUser: User, query: any) {
    const { page, take, skip } = this.normalizePagination(query?.page, query?.limit);
    const filters = query?.filters && typeof query.filters === 'object' ? query.filters : {};
    const sortBy = ['created_at', 'updated_at', 'weekOf'].includes(query?.sortBy) ? query.sortBy : 'created_at';
    const sortOrder = String(query?.sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const userId = typeof filters.userId === 'string' ? filters.userId.trim() : '';
    if (userId && !UUID_RE.test(userId)) throw new BadRequestException('Invalid userId filter');

    const scoped = () => {
      const qb = this.weeklyReportRepo.createQueryBuilder('wr').leftJoin('wr.user', 'u');
      if (currentUser.role === UserRole.ADMIN) qb.andWhere('(wr.adminId = :scopeId OR u.adminId = :scopeId)', { scopeId: currentUser.id });
      else if (currentUser.role === UserRole.COACH) qb.andWhere('(wr.coachId = :scopeId OR u.coachId = :scopeId)', { scopeId: currentUser.id });
      else if (typeof filters.adminId === 'string' && UUID_RE.test(filters.adminId)) qb.andWhere('wr.adminId = :adminId', { adminId: filters.adminId });
      return qb;
    };

    const list = scoped().addSelect(['u.id', 'u.name', 'u.email']);
    const search = String(query?.search ?? '').trim();
    if (search) list.andWhere('(u.name ILIKE :s OR u.email ILIKE :s OR CAST(wr.weekOf AS text) ILIKE :s)', { s: `%${search}%` });
    if (userId) list.andWhere('wr.userId = :userId', { userId });
    if (String(filters.reviewed) === 'true') list.andWhere('wr.reviewedAt IS NOT NULL');
    else if (String(filters.reviewed) === 'false') list.andWhere('wr.reviewedAt IS NULL');

    const [[records, total], scopeTotal, reviewed] = await Promise.all([
      list.orderBy(`wr.${sortBy}`, sortOrder).addOrderBy('wr.id', 'DESC').skip(skip).take(take).getManyAndCount(),
      scoped().getCount(),
      scoped().andWhere('wr.reviewedAt IS NOT NULL').getCount(),
    ]);

    return {
      total_records: total,
      current_page: page,
      per_page: take,
      records,
      stats: { total: scopeTotal, reviewed, unreviewed: scopeTotal - reviewed },
    };
  }

  private assertStaffAccess(report: WeeklyReport, currentUser: User) {
    const owner: any = report.user || {};
    if (currentUser.role === UserRole.CLIENT && report.userId !== currentUser.id) throw new ForbiddenException('Access denied');
    if (currentUser.role === UserRole.COACH && report.coachId !== currentUser.id && owner.coachId !== currentUser.id) throw new ForbiddenException('Access denied');
    if (currentUser.role === UserRole.ADMIN && report.adminId !== currentUser.id && owner.adminId !== currentUser.id) throw new ForbiddenException('Access denied');
  }

  async findReportById(id: string, currentUser: User) {
    const report = await this.weeklyReportRepo.findOne({
      where: { id },
      relations: ['user', 'reviewedBy'],
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    this.assertStaffAccess(report, currentUser);
    return report;
  }

  // ✅ تحديث الملاحظة بدون لعب في isRead (isRead للعميل فقط)
  async updateFeedback(id: string, updateDto: { coachFeedback?: string }, currentUser: User, locale?: string) {
    const report = await this.weeklyReportRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    this.assertStaffAccess(report, currentUser);

    const updateData: Partial<WeeklyReport> = {
      reviewedAt: new Date(),
      reviewedById: currentUser.id,
    };

    if (typeof updateDto.coachFeedback === 'string') {
      updateData.coachFeedback = updateDto.coachFeedback;
      // كل ما الكوتش يكتب/يعدّل ملاحظة => تعتبر جديدة على العميل
      updateData.isRead = false;
    }

    const updatedReport = await this.weeklyReportRepo.save({
      ...report,
      ...updateData,
    });

    if (updateDto.coachFeedback) {
      await this.notificationService.createEvent({
        event: 'weekly_report_feedback',
        locale,
        payload: {
          reportId: report.id,
          weekOf: report.weekOf,
          type: 'weekly_report_feedback',
        },
        audience: NotificationAudience.USER,
        userId: report.userId,
        type: NotificationType.FORM_SUBMISSION,
      });
    }

    return updatedReport;
  }

  async deleteReport(id: string) {
    const report = await this.weeklyReportRepo.findOne({ where: { id } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    await this.weeklyReportRepo.remove(report);
    return { message: 'Report deleted successfully' };
  }

  async getUserReportStats(userId: string) {
    const totalReports = await this.weeklyReportRepo.count({
      where: { userId },
    });

    const recentReport = await this.weeklyReportRepo.findOne({
      where: { userId },
      order: { created_at: 'DESC' },
    });

    const reportsWithFeedback = await this.weeklyReportRepo.count({
      where: { userId, coachFeedback: Not(IsNull()) },
    });

    return {
      totalReports,
      lastReportDate: recentReport?.created_at,
      reportsWithFeedback,
      feedbackRate: totalReports > 0 ? (reportsWithFeedback / totalReports) * 100 : 0,
    };
  }

  async markAsRead(id: string, userId: string) {
    const report = await this.weeklyReportRepo.findOne({
      where: { id, userId },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    report.isRead = true;
    await this.weeklyReportRepo.save(report);

    return report;
  }

  // ✅ عدد التقارير غير المُراجَعة للأدمن (reviewedAt is null)
  async countUnreviewedReportsForAdmin(adminId: string) {
    const count = await this.weeklyReportRepo.count({
      where: {
        adminId,
        reviewedAt: IsNull(),
      },
    });

    return { count };
  }

  // ✅ عدد الملاحظات (feedback) غير المقروءة للعميل
  async countUnreadFeedbackForUser(userId: string) {
    const count = await this.weeklyReportRepo.count({
      where: {
        userId,
        coachFeedback: Not(IsNull()),
        isRead: false,
      },
    });

    return { count };
  }

  /* ─── Report Config (per coach/admin) ─── */

  async getReportConfig(coachId: string) {
    const row = await this.reportConfigRepo.findOne({ where: { coachId } });
    return row?.config ?? null;
  }

  async saveReportConfig(coachId: string, config: any) {
    let row = await this.reportConfigRepo.findOne({ where: { coachId } });
    if (row) {
      row.config = config;
      return (await this.reportConfigRepo.save(row)).config;
    }
    const created = await this.reportConfigRepo.save(
      this.reportConfigRepo.create({ coachId, config }),
    );
    return created.config;
  }

  /* ─── Clients Report Status (paginated) ─── */

  async getClientsReportStatus(
    adminId: string,
    role: UserRole,
    page = 1,
    limit = 20,
    search = '',
    statusFilter = '',
  ) {
    const { take, skip } = this.normalizePagination(page, limit);

    // Config is always scoped to adminId — coaches share the admin's config
    const clients = await this.userRepo.find({
      where: { adminId, role: UserRole.CLIENT } as any,
      select: ['id', 'name', 'email', 'phone'] as any,
      order: { name: 'ASC' } as any,
    });

    const latestRows = await this.weeklyReportRepo
      .createQueryBuilder('wr')
      .innerJoin('wr.user', 'u')
      .select('wr.userId', 'userId')
      .addSelect('MAX(wr.created_at)', 'lastReportAt')
      .where('u.adminId = :adminId AND u.role = :role', { adminId, role: UserRole.CLIENT })
      .groupBy('wr.userId')
      .getRawMany<{ userId: string; lastReportAt: string | Date }>();
    const latestByUser = new Map(latestRows.map(r => [r.userId, new Date(r.lastReportAt)]));

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const lateStart = new Date();
    lateStart.setDate(lateStart.getDate() - 14);
    lateStart.setHours(0, 0, 0, 0);

    const statusOf = (last?: Date): ClientReportStatus => {
      if (!last || last < lateStart) return 'late';
      return last >= weekStart ? 'submitted' : 'pending';
    };

    const allRows = clients.map(client => {
      const lastReportAt = latestByUser.get(client.id) ?? null;
      return {
        id: client.id,
        name: (client as any).name,
        email: (client as any).email,
        phone: (client as any).phone,
        status: statusOf(lastReportAt ?? undefined),
        lastReportAt,
      };
    });

    const stats = { total: allRows.length, submitted: 0, pending: 0, late: 0 };
    for (const r of allRows) stats[r.status]++;

    const q = search?.trim().toLowerCase();
    const wanted = CLIENT_REPORT_STATUSES.includes(statusFilter as ClientReportStatus) ? statusFilter : '';
    const filtered = allRows.filter(r => (!wanted || r.status === wanted) && (!q || String(r.name || '').toLowerCase().includes(q) || String(r.email || '').toLowerCase().includes(q)));

    return {
      items: filtered.slice(skip, skip + take),
      total: filtered.length,
      page,
      limit: take,
      hasMore: skip + take < filtered.length,
      stats,
    };
  }

  /* ─── Send Reminder Notifications ─── */

  async sendReminderToClients(ownerId: string, clientIds: string[], locale: string) {
    const ids = (Array.isArray(clientIds) ? clientIds : []).filter(id => typeof id === 'string' && UUID_RE.test(id));
    if (!ids.length) return { sent: 0 };

    const clients = await this.userRepo.findBy({ id: In(ids), adminId: ownerId, role: UserRole.CLIENT } as any);

    const ar = String(locale || '').toLowerCase().startsWith('ar');
    const title = ar ? 'تذكير بالتقرير الأسبوعي 🔔' : 'Weekly Report Reminder 🔔';
    const config: any = clients.length ? await this.getReportConfig(ownerId) : null;
    const customMessage = String(config?.notifications?.reminderMessage ?? '').trim();
    const message =
      customMessage ||
      (ar
        ? 'لم نستلم تقرير المتابعة الأسبوعي منك بعد. يرجى إكماله في أقرب وقت للحفاظ على متابعتك مع مدربك. 🏋️'
        : 'Your weekly report has not been submitted yet. Please complete it as soon as possible.');

    await Promise.all(
      clients.map(client =>
        this.notificationService.create({
          type: NotificationType.FORM_SUBMISSION,
          title,
          message,
          audience: NotificationAudience.USER,
          userId: client.id,
        }),
      ),
    );

    return { sent: clients.length };
  }

  private normalizePagination(pageInput?: number | string, limitInput?: number | string, maxLimit = 100) {
    const { page, take, skip } = parsePagination(pageInput, limitInput, { defaultLimit: 10, maxLimit });
    return { page, take, skip };
  }
}
