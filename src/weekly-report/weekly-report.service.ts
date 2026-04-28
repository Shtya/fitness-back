// weekly-report/weekly-report.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, In, ILike } from 'typeorm';
import { WeeklyReport } from 'entities/weekly-report.entity';
import { ReportConfig } from 'entities/report-config.entity';
import { User, UserRole, NotificationType, NotificationAudience } from 'entities/global.entity';
import { NotificationService } from '../notification/notification.service';

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

  async findReportById(id: string, currentUser: User) {
    const report = await this.weeklyReportRepo.findOne({
      where: { id },
      relations: ['user', 'reviewedBy'],
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    if (currentUser.role === UserRole.CLIENT && report.userId !== currentUser.id) {
      throw new ForbiddenException('Access denied');
    }

    if (currentUser.role === UserRole.COACH && report.user.coachId !== currentUser.id) {
      throw new ForbiddenException('Access denied');
    }

    return report;
  }

  // ✅ تحديث الملاحظة بدون لعب في isRead (isRead للعميل فقط)
  async updateFeedback(id: string, updateDto: { coachFeedback?: string }, coachId: string, locale?: string) {
    const report = await this.weeklyReportRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const updateData: Partial<WeeklyReport> = {
      reviewedAt: new Date(),
      reviewedById: coachId,
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
    const baseWhere: any =
      role === UserRole.ADMIN
        ? { adminId, role: UserRole.CLIENT }
        : { adminId, role: UserRole.CLIENT };

    if (search?.trim()) {
      baseWhere.name = ILike(`%${search.trim()}%`);
    }

    const [clients, total] = await this.userRepo.findAndCount({
      where: baseWhere,
      select: ['id', 'name', 'email', 'phone'] as any,
      take,
      skip,
    });

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const lateStart = new Date();
    lateStart.setDate(lateStart.getDate() - 14);
    lateStart.setHours(0, 0, 0, 0);

    let rows = await Promise.all(
      clients.map(async client => {
        const latest = await this.weeklyReportRepo.findOne({
          where: { userId: client.id },
          order: { created_at: 'DESC' },
        });

        let status: 'submitted' | 'pending' | 'late';
        const lastReportAt = latest?.created_at ?? null;

        if (!latest) {
          status = 'late';
        } else if (latest.created_at >= weekStart) {
          status = 'submitted';
        } else if (latest.created_at < lateStart) {
          status = 'late';
        } else {
          status = 'pending';
        }

        return {
          id: client.id,
          name: (client as any).name,
          email: (client as any).email,
          phone: (client as any).phone,
          status,
          lastReportAt,
        };
      }),
    );

    // Apply status filter after computing statuses (since status is computed, not stored)
    if (statusFilter && ['submitted', 'pending', 'late'].includes(statusFilter)) {
      rows = rows.filter(r => r.status === statusFilter);
    }

    return {
      items: rows,
      total: statusFilter ? rows.length : total,
      page,
      limit: take,
      hasMore: skip + take < (statusFilter ? rows.length : total),
    };
  }

  /* ─── Send Reminder Notifications ─── */

  async sendReminderToClients(clientIds: string[], locale: string) {
    if (!clientIds?.length) return { sent: 0 };

    const clients = await this.userRepo.findBy({ id: In(clientIds) });

    const ar = String(locale || '').toLowerCase().startsWith('ar');
    const title = ar ? 'تذكير بالتقرير الأسبوعي 🔔' : 'Weekly Report Reminder 🔔';
    const message = ar
      ? 'لم نستلم تقرير المتابعة الأسبوعي منك بعد. يرجى إكماله في أقرب وقت للحفاظ على متابعتك مع مدربك. 🏋️'
      : "Your weekly report has not been submitted yet. Please complete it as soon as possible.";

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
    const pageNum = Number(pageInput);
    const limitNum = Number(limitInput);

    const page = Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1;
    const takeRaw = Number.isFinite(limitNum) && limitNum > 0 ? Math.floor(limitNum) : 10;

    const take = Math.min(takeRaw, maxLimit);
    const skip = (page - 1) * take;

    return { page, take, skip };
  }
}
