// weekly-report/weekly-report.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { WeeklyReport } from 'entities/weekly-report.entity';
import { User, UserRole, NotificationType, NotificationAudience } from 'entities/global.entity';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class WeeklyReportService {
  constructor(
    @InjectRepository(WeeklyReport)
    private readonly weeklyReportRepo: Repository<WeeklyReport>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationService: NotificationService,
  ) {}

  async createReport(userId: string, createDto: any) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['coach'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const report = this.weeklyReportRepo.create({
      ...createDto,
      user,
      userId,
    });

    const savedReport:any = await this.weeklyReportRepo.save(report);

    // Send notification to coach
    if (createDto.notifyCoach && user.coachId) {
      await this.notificationService.create({
        type: NotificationType.FORM_SUBMISSION,
        title: 'New Weekly Report Submitted',
        message: `${user.name} has submitted their weekly report for ${createDto.weekOf}`,
        data: {
          reportId: savedReport.id,
          userId: user.id,
          userName: user.name,
          weekOf: createDto.weekOf,
          type: 'weekly_report'
        },
        audience: NotificationAudience.USER,
        userId: user.coachId,
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
      // Check if coach has access to this user's reports
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
      // Coach can see all their athletes' reports
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

    // Authorization check
    if (currentUser.role === UserRole.CLIENT && report.userId !== currentUser.id) {
      throw new ForbiddenException('Access denied');
    }

    if (currentUser.role === UserRole.COACH && report.user.coachId !== currentUser.id) {
      throw new ForbiddenException('Access denied');
    }

    return report;
  }

  async updateFeedback(id: string, updateDto: { coachFeedback?: string; isRead?: boolean }, coachId: string) {
    const report = await this.weeklyReportRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const updateData: any = {
      ...updateDto,
      reviewedAt: new Date(),
      reviewedById: coachId,
    };

    const updatedReport = await this.weeklyReportRepo.save({
      ...report,
      ...updateData,
    });

    // Notify user about coach feedback
    if (updateDto.coachFeedback) {
      await this.notificationService.create({
        type: NotificationType.FORM_SUBMISSION,
        title: 'Coach Feedback on Your Weekly Report',
        message: `Your coach has provided feedback on your weekly report for ${report.weekOf}`,
        data: {
          reportId: report.id,
          weekOf: report.weekOf,
          type: 'weekly_report_feedback'
        },
        audience: NotificationAudience.USER,
        userId: report.userId,
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