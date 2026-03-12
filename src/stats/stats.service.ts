// src/stats/stats.service.ts
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual, In, IsNull, Not } from 'typeorm';
import {
  User,
  ExerciseRecord,
  ExercisePlan,
  Notification,
  UserRole,
  UserStatus,
  Form,
  FormSubmission,
  ExerciseVideo,
  ChatConversation,
  ChatMessage,
} from 'entities/global.entity';
import { MealLog, MealPlan, FoodSuggestion } from 'entities/meal_plans.entity';
import { WeeklyReport } from 'entities/weekly-report.entity';
import { BodyMeasurement, ProgressPhoto } from 'entities/profile.entity';
import { Asset } from '../../entities/assets.entity';
import type {
  AdminStatsQueryDto,
  AdminStatsResponse,
  AdminStatsKpis,
  AdminStatsSeries,
  AdminStatsBreakdowns,
  AdminStatsReviewsQueue,
  LabelValue,
} from './admin-stats.dto';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ExerciseRecord)
    private readonly exerciseRecordRepo: Repository<ExerciseRecord>,
    @InjectRepository(MealLog)
    private readonly mealLogRepo: Repository<MealLog>,
    @InjectRepository(ProgressPhoto)
    private readonly progressPhotoRepo: Repository<ProgressPhoto>,
    @InjectRepository(BodyMeasurement)
    private readonly bodyMeasurementRepo: Repository<BodyMeasurement>,
    @InjectRepository(ExercisePlan)
    private readonly exercisePlanRepo: Repository<ExercisePlan>,
    @InjectRepository(MealPlan)
    private readonly mealPlanRepo: Repository<MealPlan>,
    @InjectRepository(WeeklyReport)
    private readonly weeklyReportRepo: Repository<WeeklyReport>,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(FoodSuggestion)
    private readonly foodSuggestionRepo: Repository<FoodSuggestion>,
    @InjectRepository(Form)
    private readonly formRepo: Repository<Form>,
    @InjectRepository(FormSubmission)
    private readonly formSubmissionRepo: Repository<FormSubmission>,
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(ExerciseVideo)
    private readonly exerciseVideoRepo: Repository<ExerciseVideo>,
    @InjectRepository(ChatConversation)
    private readonly chatConversationRepo: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepo: Repository<ChatMessage>,
  ) {}

  /* ==================== SYSTEM OVERVIEW STATS ==================== */
  async getSystemOverview() {
    const [userStats, plansStats, nutritionStats, activityStats, revenueStats] = await Promise.all([this.getUserStats(), this.getPlansStats(), this.getNutritionStats(), this.getSystemActivityStats(), this.getRevenueStats()]);

    return {
      summary: {
        totalUsers: userStats.total,
        activeUsers: userStats.active,
        newUsersThisMonth: userStats.newThisMonth,
        suspendedUsers: userStats.suspended,
        userGrowth: userStats.growth,
      },
      plans: plansStats,
      nutrition: nutritionStats,
      activity: activityStats,
      revenue: revenueStats,
      timestamp: new Date(),
    };
  }

  async getSystemDetailedStats(timeframe: string) {
    const dateRange = this.getDateRange(timeframe);

    const [userStats, workoutStats, nutritionStats, engagementStats, topExercises, topFoods, userRetention] = await Promise.all([this.getDetailedUserStats(dateRange), this.getWorkoutStats(dateRange), this.getDetailedNutritionStats(dateRange), this.getEngagementStats(dateRange), this.getTopExercises(dateRange), this.getTopFoods(dateRange), this.getUserRetentionStats(dateRange)]);

    return {
      timeframe,
      dateRange,
      users: userStats,
      workouts: workoutStats,
      nutrition: nutritionStats,
      engagement: engagementStats,
      analytics: {
        topExercises,
        topFoods,
        userRetention,
      },
    };
  }

  async getSystemActivityTrends(days: number) {
    const trends = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const [workouts, meals, newUsers, activeUsers] = await Promise.all([this.exerciseRecordRepo.count({ where: { date: dateStr } }), this.mealLogRepo.count({ where: { eatenAt: Between(new Date(dateStr + 'T00:00:00.000Z'), new Date(dateStr + 'T23:59:59.999Z')) } }), this.userRepo.count({ where: { created_at: Between(new Date(dateStr + 'T00:00:00.000Z'), new Date(dateStr + 'T23:59:59.999Z')) } }), this.userRepo.count({ where: { lastLogin: Between(new Date(dateStr + 'T00:00:00.000Z'), new Date(dateStr + 'T23:59:59.999Z')) } })]);

      trends.push({
        date: dateStr,
        workouts,
        meals,
        newUsers,
        activeUsers,
      });
    }

    return {
      period: `${days} days`,
      trends,
    };
  }

  /* ==================== ADMIN DASHBOARD STATS ==================== */
  /**
   * Returns dashboard payload for admin stats page.
   * SUPER_ADMIN: can pass adminId to scope to one admin, or omit for platform-wide.
   * ADMIN: scoped to their own clients (adminId ignored or must match self).
   */
  async getAdminDashboardStats(
    query: AdminStatsQueryDto,
    actor: { id: string; role: UserRole },
  ): Promise<AdminStatsResponse> {
    const effectiveAdminId = this.resolveAdminScope(query.adminId, actor);
    const from = query.from
      ? new Date(query.from + 'T00:00:00.000Z')
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = query.to
      ? new Date(query.to + 'T23:59:59.999Z')
      : new Date();

    const [
      kpis,
      usersCreatedDaily,
      exerciseVolumeDaily,
      mealLogsDaily,
      membershipCounts,
      userStatusCounts,
      messagesPerConversationTop5,
      reviewsQueue,
    ] = await Promise.all([
      this.getAdminKpis(from, to, effectiveAdminId),
      this.getAdminUsersCreatedDaily(from, to, effectiveAdminId),
      this.getAdminExerciseVolumeDaily(from, to, effectiveAdminId),
      this.getAdminMealLogsDaily(from, to, effectiveAdminId),
      this.getAdminMembershipCounts(effectiveAdminId),
      this.getAdminUserStatusCounts(effectiveAdminId),
      this.getAdminTopConversations(5),
      this.getAdminReviewsQueue(effectiveAdminId),
    ]);

    return {
      kpis,
      series: {
        usersCreatedDaily,
        exerciseVolumeDaily,
        mealLogsDaily,
      },
      breakdowns: {
        membershipCounts,
        userStatusCounts,
        messagesPerConversationTop5,
      },
      reviewsQueue,
    };
  }

  private resolveAdminScope(adminId: string | undefined, actor: { id: string; role: UserRole }): string | null {
    if (actor.role === UserRole.SUPER_ADMIN) {
      return adminId ?? null; // null = platform-wide
    }
    if (actor.role === UserRole.ADMIN) {
      if (adminId && adminId !== actor.id) {
        throw new ForbiddenException('You can only view your own scope');
      }
      return actor.id;
    }
    return actor.id;
  }

  private async getAdminKpis(
    from: Date,
    to: Date,
    adminId: string | null,
  ): Promise<AdminStatsKpis> {
    const clientWhere: any = { role: UserRole.CLIENT };
    if (adminId) clientWhere.adminId = adminId;

    const [totalClients, activeClients, newClients, churnedThisRange, formsSubmissions, unreadNotifications, assetsUploaded, pendingExerciseVideos] =
      await Promise.all([
        this.userRepo.count({ where: clientWhere }),
        this.userRepo.count({ where: { ...clientWhere, status: UserStatus.ACTIVE } }),
        this.userRepo.count({
          where: {
            ...clientWhere,
            created_at: Between(from, to),
          },
        }),
        this.userRepo.count({
          where: {
            ...clientWhere,
            status: UserStatus.SUSPENDED,
            updated_at: Between(from, to),
          },
        }),
        this.getAdminFormSubmissionsCount(from, to, adminId),
        this.notificationRepo.count({ where: { isRead: false } }),
        this.getAdminAssetsUploadedCount(from, to, adminId),
        this.getAdminPendingVideosCount(adminId),
      ]);

    return {
      totalClients,
      activeClients,
      newClients,
      churnedThisRange,
      formsSubmissions,
      unreadNotifications,
      assetsUploaded,
      pendingExerciseVideos,
    };
  }

  private async getAdminFormSubmissionsCount(from: Date, to: Date, adminId: string | null): Promise<number> {
    if (adminId) {
      const qb = this.formSubmissionRepo
        .createQueryBuilder('s')
        .innerJoin('s.form', 'f')
        .where('s.created_at BETWEEN :from AND :to', { from, to })
        .andWhere('f.adminId = :adminId', { adminId });
      return qb.getCount();
    }
    return this.formSubmissionRepo.count({
      where: { created_at: Between(from, to) },
    });
  }

  private async getAdminAssetsUploadedCount(from: Date, to: Date, adminId: string | null): Promise<number> {
    if (adminId) {
      return this.assetRepo
        .createQueryBuilder('a')
        .innerJoin('a.user', 'u')
        .where('u.role = :role', { role: UserRole.CLIENT })
        .andWhere('u.adminId = :adminId', { adminId })
        .andWhere('a.created_at BETWEEN :from AND :to', { from, to })
        .getCount();
    }
    return this.assetRepo.count({
      where: { created_at: Between(from, to) },
    });
  }

  private async getAdminPendingVideosCount(adminId: string | null): Promise<number> {
    const qb = this.exerciseVideoRepo
      .createQueryBuilder('v')
      .where('v.status = :status', { status: 'pending' });
    if (adminId) {
      qb.innerJoin('v.user', 'u').andWhere('u.adminId = :adminId', { adminId }).andWhere('u.role = :role', { role: UserRole.CLIENT });
    }
    return qb.getCount();
  }

  private async getAdminUsersCreatedDaily(
    from: Date,
    to: Date,
    adminId: string | null,
  ): Promise<{ date: string; value: number }[]> {
    const where: any = { role: UserRole.CLIENT };
    if (adminId) where.adminId = adminId;
    const qb = this.userRepo
      .createQueryBuilder('u')
      .select("(u.created_at::date)::text", "date")
      .addSelect('COUNT(*)', 'value')
      .where('u.role = :role', { role: UserRole.CLIENT })
      .andWhere('u.created_at BETWEEN :from AND :to', { from, to })
      .groupBy('u.created_at::date');
    if (adminId) {
      qb.andWhere('u.adminId = :adminId', { adminId });
    }
    const rows = await qb.getRawMany();
    return this.fillDailySeries(rows, from, to, 'value');
  }

  private async getAdminExerciseVolumeDaily(
    from: Date,
    to: Date,
    _adminId: string | null,
  ): Promise<{ date: string; value: number }[]> {
    const qb = this.exerciseRecordRepo
      .createQueryBuilder('r')
      .select('r.date', 'date')
      .addSelect('COALESCE(SUM(r.totalVolume), 0)', 'value')
      .where('r.date BETWEEN :from AND :to', {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      })
      .groupBy('r.date');
    const rows = await qb.getRawMany();
    return this.fillDailySeries(
      rows.map((r) => ({ date: r.date, value: Number(r.value) })),
      from,
      to,
      'value',
    );
  }

  private async getAdminMealLogsDaily(
    from: Date,
    to: Date,
    _adminId: string | null,
  ): Promise<{ date: string; value: number }[]> {
    const qb = this.mealLogRepo
      .createQueryBuilder('m')
      .select('(m."eatenAt"::date)::text', 'date')
      .addSelect('COUNT(*)', 'value')
      .where('m."eatenAt" BETWEEN :from AND :to', { from, to })
      .groupBy('m."eatenAt"::date');
    const rows = await qb.getRawMany();
    const mapped = rows.map((r) => ({ date: r.date ? String(r.date).slice(0, 10) : '', value: Number(r.value) }));
    return this.fillDailySeries(mapped, from, to, 'value');
  }

  private fillDailySeries(
    rows: { date: string; value: number }[],
    from: Date,
    to: Date,
    valueKey: string,
  ): { date: string; value: number }[] {
    const map = new Map<string, number>();
    for (const r of rows) {
      const d = String(r.date).slice(0, 10);
      map.set(d, r.value ?? (r as any)[valueKey] ?? 0);
    }
    const out: { date: string; value: number }[] = [];
    const start = new Date(from);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setUTCHours(23, 59, 59, 999);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      out.push({ date: dateStr, value: map.get(dateStr) ?? 0 });
    }
    return out;
  }

  private async getAdminMembershipCounts(adminId: string | null): Promise<LabelValue[]> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .select('u.membership', 'label')
      .addSelect('COUNT(*)', 'value')
      .where('u.role = :role', { role: UserRole.CLIENT })
      .groupBy('u.membership');
    if (adminId) {
      qb.andWhere('u.adminId = :adminId', { adminId });
    }
    const rows = await qb.getRawMany();
    return rows.map((r) => ({
      labelKey: r.label ? `membership.${String(r.label).toLowerCase()}` : undefined,
      label: r.label ?? '-',
      value: Number(r.value),
    }));
  }

  private async getAdminUserStatusCounts(adminId: string | null): Promise<LabelValue[]> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .select('u.status', 'status')
      .addSelect('COUNT(*)', 'value')
      .where('u.role = :role', { role: UserRole.CLIENT })
      .groupBy('u.status');
    if (adminId) {
      qb.andWhere('u.adminId = :adminId', { adminId });
    }
    const rows = await qb.getRawMany();
    return rows.map((r) => ({
      labelKey: `status.${r.status}`,
      value: Number(r.value),
    }));
  }

  private async getAdminTopConversations(limit: number): Promise<{ conversationId: string; nameKey?: string; name?: string; messages: number }[]> {
    const rows = await this.chatMessageRepo
      .createQueryBuilder('m')
      .select('m.conversationId', 'conversationId')
      .addSelect('COUNT(*)', 'messages')
      .where('m.isDeleted = :isDeleted', { isDeleted: false })
      .groupBy('m.conversationId')
      .orderBy('messages', 'DESC')
      .limit(limit)
      .getRawMany();
    const convIds = rows.map((r) => r.conversationId).filter(Boolean);
    const convs = convIds.length
      ? await this.chatConversationRepo.find({ where: { id: In(convIds) }, select: ['id', 'name'] })
      : [];
    const nameMap = new Map(convs.map((c) => [c.id, c.name]));
    return rows.map((r, i) => ({
      conversationId: r.conversationId,
      nameKey: `conv.conversation${i + 1}`,
      name: nameMap.get(r.conversationId) ?? null,
      messages: Number(r.messages),
    }));
  }

  private async getAdminReviewsQueue(adminId: string | null): Promise<AdminStatsReviewsQueue> {
    const wrQb = this.weeklyReportRepo
      .createQueryBuilder('w')
      .where('w.reviewedAt IS NULL');
    if (adminId) {
      wrQb.andWhere('w.adminId = :adminId', { adminId });
    }
    const videosQb = this.exerciseVideoRepo
      .createQueryBuilder('v')
      .where('v.status = :status', { status: 'pending' });
    if (adminId) {
      videosQb.innerJoin('v.user', 'u').andWhere('u.adminId = :adminId', { adminId });
    }
    const fsQb = this.foodSuggestionRepo
      .createQueryBuilder('f')
      .where('f.status = :status', { status: 'pending' });
    if (adminId) {
      const clientIds = await this.userRepo.find({
        where: { role: UserRole.CLIENT, adminId },
        select: ['id'],
      });
      const ids = clientIds.map((u) => u.id);
      if (ids.length) fsQb.andWhere('f.userId IN (:...ids)', { ids });
      else return { weeklyReportsPending: await wrQb.getCount(), videosPending: await videosQb.getCount(), foodSuggestionsPending: 0 };
    }
    const [weeklyReportsPending, videosPending, foodSuggestionsPending] = await Promise.all([
      wrQb.getCount(),
      videosQb.getCount(),
      fsQb.getCount(),
    ]);
    return {
      weeklyReportsPending,
      videosPending,
      foodSuggestionsPending,
    };
  }

  /* ==================== COACH DASHBOARD STATS ==================== */
  async getCoachOverview(coachId: string) {
    const clients = await this.userRepo.find({
      where: { coachId, role: UserRole.CLIENT },
      relations: ['activeExercisePlan', 'activeMealPlan'],
    });

    const clientIds = clients.map(client => client.id);
    const dateRange = this.getDateRange('30d');

    const [clientStats, recentActivity, pendingActions, complianceStats] = await Promise.all([this.getClientsBasicStats(clientIds), this.getRecentClientActivity(clientIds, dateRange), this.getPendingCoachActions(coachId), this.getClientsComplianceStats(clientIds, dateRange)]);

    return {
      coach: {
        totalClients: clients.length,
        activeClients: clients.filter(c => c.status === UserStatus.ACTIVE).length,
      },
      clients: clientStats,
      recentActivity,
      pendingActions,
      compliance: complianceStats,
      timestamp: new Date(),
    };
  }

  async getClientsProgress(coachId: string, timeframe: string) {
    const clients = await this.userRepo.find({
      where: { coachId, role: UserRole.CLIENT },
    });

    const clientIds = clients.map(client => client.id);
    const dateRange = this.getDateRange(timeframe);

    const progressData = await Promise.all(clientIds.map(clientId => this.getIndividualClientProgress(clientId, dateRange)));

    return {
      timeframe,
      totalClients: clients.length,
      progress: progressData.filter((data: any) => data.hasData),
      summary: {
        improving: progressData.filter((data: any) => data.trend === 'improving').length,
        declining: progressData.filter((data: any) => data.trend === 'declining').length,
        stable: progressData.filter((data: any) => data.trend === 'stable').length,
        noData: progressData.filter((data: any) => !data.hasData).length,
      },
    };
  }

  /* ==================== CLIENT DASHBOARD STATS ==================== */
  async getClientOverview(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['coach', 'activeExercisePlan', 'activeMealPlan'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const dateRange = this.getDateRange('30d');

    const [workoutStats, nutritionStats, measurementStats, progressStats, weeklySummary] = await Promise.all([this.getClientWorkoutStats(userId, dateRange), this.getClientNutritionStats(userId, dateRange), this.getClientMeasurementStats(userId), this.getClientProgressStats(userId, dateRange), this.getWeeklySummary(userId)]);

    return {
      user: {
        id: user.id,
        name: user.name,
        coach: user.coach ? { id: user.coach.id, name: user.coach.name } : null,
        activeExercisePlan: user.activeExercisePlan,
        activeMealPlan: user.activeMealPlan,
        membership: user.membership,
        points: user.points,
      },
      overview: {
        workout: workoutStats,
        nutrition: nutritionStats,
        measurements: measurementStats,
        progress: progressStats,
      },
      weeklySummary,
      timestamp: new Date(),
    };
  }

  async getClientDetailedStats(userId: string, timeframe: string) {
    const dateRange = this.getDateRange(timeframe);

    const [workoutTrends, nutritionTrends, prProgress, compliance, goalsProgress, recommendations] = await Promise.all([this.getWorkoutTrends(userId, dateRange), this.getNutritionTrends(userId, dateRange), this.getPRProgress(userId, dateRange), this.getComplianceDetails(userId, dateRange), this.getGoalsProgress(userId), this.getPersonalizedRecommendations(userId)]);

    return {
      userId,
      timeframe,
      workout: workoutTrends,
      nutrition: nutritionTrends,
      progress: {
        personalRecords: prProgress,
        goals: goalsProgress,
      },
      compliance,
      recommendations,
    };
  }

  async getClientProgressTimeline(userId: string, months: number) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const [measurements, photos, workouts, nutrition] = await Promise.all([
      this.bodyMeasurementRepo.find({
        where: { userId, date: Between(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]) },
        order: { date: 'ASC' },
      }),
      this.progressPhotoRepo.find({
        where: { userId, takenAt: Between(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]) },
        order: { takenAt: 'ASC' },
      }),
      this.exerciseRecordRepo.find({
        where: { userId, date: Between(startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]) },
        order: { date: 'ASC' },
      }),
      this.mealLogRepo.find({
        where: { userId, eatenAt: Between(startDate, endDate) },
        order: { eatenAt: 'ASC' },
      }),
    ]);

    return {
      period: `${months} months`,
      measurements: this.formatTimelineData(measurements, 'date'),
      photos: this.formatTimelineData(photos, 'takenAt'),
      workouts: this.formatTimelineData(workouts, 'date'),
      nutrition: this.formatTimelineData(nutrition, 'eatenAt'),
    };
  }

  async getClientComplianceStats(userId: string, timeframe: string) {
    const dateRange = this.getDateRange(timeframe);

    const [workoutCompliance, nutritionCompliance, planAdherence, streakInfo] = await Promise.all([this.getWorkoutCompliance(userId, dateRange), this.getNutritionCompliance(userId, dateRange), this.getPlanAdherence(userId), this.getStreakInfo(userId)]);

    return {
      timeframe,
      workout: workoutCompliance,
      nutrition: nutritionCompliance,
      plans: planAdherence,
      streaks: streakInfo,
      overallScore: this.calculateOverallCompliance(workoutCompliance, nutritionCompliance),
    };
  }

  /* ==================== PRIVATE HELPER METHODS ==================== */
  private getDateRange(timeframe: string): { start: Date; end: Date } {
    const end = new Date();
    const start = new Date();

    switch (timeframe) {
      case '7d':
        start.setDate(start.getDate() - 7);
        break;
      case '30d':
        start.setDate(start.getDate() - 30);
        break;
      case '90d':
        start.setDate(start.getDate() - 90);
        break;
      case '1y':
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        start.setDate(start.getDate() - 30);
    }

    return { start, end };
  }

  private async getUserStats() {
    const [total, active, suspended, newThisMonth] = await Promise.all([
      this.userRepo.count(),
      this.userRepo.count({ where: { status: UserStatus.ACTIVE } }),
      this.userRepo.count({ where: { status: UserStatus.SUSPENDED } }),
      this.userRepo.count({
        where: {
          created_at: Between(new Date(new Date().getFullYear(), new Date().getMonth(), 1), new Date()),
        },
      }),
    ]);

    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const previousMonthCount = await this.userRepo.count({
      where: {
        created_at: Between(new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1), new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0)),
      },
    });

    const growth = previousMonthCount > 0 ? ((newThisMonth - previousMonthCount) / previousMonthCount) * 100 : 0;

    return {
      total,
      active,
      suspended,
      newThisMonth,
      growth: Math.round(growth * 100) / 100,
    };
  }

  private async getPlansStats() {
    const [exercisePlans, mealPlans, assignedPlans] = await Promise.all([this.exercisePlanRepo.count({ where: { isActive: true } }), this.mealPlanRepo.count({ where: { isActive: true } }), this.userRepo.count({ where: { activeExercisePlanId: Not(IsNull()) } })]);

    return {
      exercisePlans,
      mealPlans,
      assignedPlans,
      utilizationRate: Math.round((assignedPlans / (await this.userRepo.count({ where: { role: UserRole.CLIENT } }))) * 100) || 0,
    };
  }

  private async getNutritionStats() {
    const [totalLogs, uniqueUsers, avgAdherence] = await Promise.all([this.mealLogRepo.count(), this.mealLogRepo.createQueryBuilder('log').select('COUNT(DISTINCT log.userId)', 'count').getRawOne(), this.mealLogRepo.createQueryBuilder('log').select('AVG(log.adherence)', 'avg').getRawOne()]);

    return {
      totalLogs,
      activeUsers: parseInt(uniqueUsers.count) || 0,
      avgAdherence: Math.round(parseFloat(avgAdherence.avg) * 100) / 100 || 0,
    };
  }

  private async getSystemActivityStats() {
    const today = new Date().toISOString().split('T')[0];
    const [todayWorkouts, todayMeals, activeToday] = await Promise.all([
      this.exerciseRecordRepo.count({ where: { date: today } }),
      this.mealLogRepo.count({
        where: {
          eatenAt: Between(new Date(today + 'T00:00:00.000Z'), new Date(today + 'T23:59:59.999Z')),
        },
      }),
      this.userRepo.count({
        where: {
          lastLogin: Between(new Date(today + 'T00:00:00.000Z'), new Date(today + 'T23:59:59.999Z')),
        },
      }),
    ]);

    return {
      today: {
        workouts: todayWorkouts,
        meals: todayMeals,
        activeUsers: activeToday,
      },
    };
  }

  private async getRevenueStats() {
    // Placeholder for revenue statistics
    // You can integrate with your payment system here
    return {
      monthlyRevenue: 0,
      activeSubscriptions: 0,
      churnRate: 0,
      arpu: 0,
    };
  }

  private formatTimelineData(data: any[], dateField: string) {
    return data.map(item => ({
      date: item[dateField],
      data: item,
    }));
  }

  private calculateOverallCompliance(workout: any, nutrition: any): number {
    const workoutScore = workout.complianceRate || 0;
    const nutritionScore = nutrition.avgAdherence * 20 || 0; // Convert 1-5 scale to percentage
    return Math.round((workoutScore + nutritionScore) / 2);
  }

  // Additional helper methods for specific stats calculations
  private async getClientWorkoutStats(userId: string, dateRange: { start: Date; end: Date }) {
    const workouts = await this.exerciseRecordRepo.find({
      where: {
        userId,
        date: Between(dateRange.start.toISOString().split('T')[0], dateRange.end.toISOString().split('T')[0]),
      },
    });

    const totalVolume = workouts.reduce((sum, w) => sum + (w.totalVolume || 0), 0);
    const sessions = [...new Set(workouts.map(w => w.date))].length;
    const daysInRange = Math.ceil((dateRange.end.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24));
    const complianceRate = Math.round((sessions / daysInRange) * 100);

    return {
      totalSessions: sessions,
      totalVolume,
      avgVolumePerSession: sessions > 0 ? Math.round(totalVolume / sessions) : 0,
      complianceRate,
      personalRecords: workouts.filter(w => w.isPersonalRecord).length,
    };
  }

  private async getClientNutritionStats(userId: string, dateRange: { start: Date; end: Date }) {
    const meals = await this.mealLogRepo.find({
      where: {
        userId,
        eatenAt: Between(dateRange.start, dateRange.end),
      },
    });

    const totalMeals = meals.length;
    const avgAdherence = totalMeals > 0 ? meals.reduce((sum, m) => sum + m.adherence, 0) / totalMeals : 0;

    return {
      totalMeals,
      avgAdherence: Math.round(avgAdherence * 100) / 100,
      perfectDays: [...new Set(meals.filter(m => m.adherence >= 4).map(m => m.eatenAt.toISOString().split('T')[0]))].length,
    };
  }

  private async getClientMeasurementStats(userId: string) {
    const measurements = await this.bodyMeasurementRepo.find({
      where: { userId },
      order: { date: 'DESC' },
      take: 2,
    });

    if (measurements.length < 2) {
      return { hasEnoughData: false, changes: {} };
    }

    const latest = measurements[0];
    const previous = measurements[1];

    return {
      hasEnoughData: true,
      latest: latest,
      changes: {
        weight: latest.weight && previous.weight ? latest.weight - previous.weight : null,
        waist: latest.waist && previous.waist ? latest.waist - previous.waist : null,
        chest: latest.chest && previous.chest ? latest.chest - previous.chest : null,
      },
    };
  }

  private async getClientProgressStats(userId: string, dateRange: { start: Date; end: Date }) {
    // Implementation for progress statistics
    return {
      strengthProgress: 0,
      enduranceProgress: 0,
      consistencyScore: 0,
    };
  }

  private async getWeeklySummary(userId: string) {
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const [workoutsThisWeek, mealsThisWeek, weeklyReport] = await Promise.all([
      this.exerciseRecordRepo.count({
        where: {
          userId,
          date: Between(startOfWeek.toISOString().split('T')[0], new Date().toISOString().split('T')[0]),
        },
      }),
      this.mealLogRepo.count({
        where: {
          userId,
          eatenAt: Between(startOfWeek, new Date()),
        },
      }),
      this.weeklyReportRepo.findOne({
        where: { userId },
        order: { created_at: 'DESC' },
      }),
    ]);

    return {
      workouts: workoutsThisWeek,
      meals: mealsThisWeek,
      weeklyReportSubmitted: !!weeklyReport,
    };
  }

  // Placeholder methods for additional functionality
  private async getWorkoutTrends(userId: string, dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getNutritionTrends(userId: string, dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getPRProgress(userId: string, dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getComplianceDetails(userId: string, dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getGoalsProgress(userId: string) {
    return {};
  }

  private async getPersonalizedRecommendations(userId: string) {
    return [];
  }

  private async getWorkoutCompliance(userId: string, dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getNutritionCompliance(userId: string, dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getPlanAdherence(userId: string) {
    return {};
  }

  private async getStreakInfo(userId: string) {
    return {};
  }

  private async getDetailedUserStats(dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getWorkoutStats(dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getDetailedNutritionStats(dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getEngagementStats(dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getTopExercises(dateRange: { start: Date; end: Date }) {
    return [];
  }

  private async getTopFoods(dateRange: { start: Date; end: Date }) {
    return [];
  }

  private async getUserRetentionStats(dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getClientsBasicStats(clientIds: string[]) {
    return {};
  }

  private async getRecentClientActivity(clientIds: string[], dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getPendingCoachActions(coachId: string) {
    return {};
  }

  private async getClientsComplianceStats(clientIds: string[], dateRange: { start: Date; end: Date }) {
    return {};
  }

  private async getIndividualClientProgress(clientId: string, dateRange: { start: Date; end: Date }) {
    return {};
  }
}
