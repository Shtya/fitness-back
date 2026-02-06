import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User, ExercisePlan, ExercisePlanDay, ExercisePlanDayExercise,  ChatMessage } from 'entities/global.entity';
import { MealPlan, MealPlanDay, Meal, MealItem, Supplement, MealPlanAssignment, MealLog, MealLogItem, ExtraFood, SupplementLog,} from "entities/meal_plans.entity";
import { BodyMeasurement, ProgressPhoto } from 'entities/profile.entity';
import { WeeklyReport } from 'entities/weekly-report.entity';
import { Between, FindOptionsWhere, MoreThanOrEqual, LessThanOrEqual, Repository } from 'typeorm';

type DateRange = { from?: string; to?: string };

@Injectable()
export class AboutUserService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(BodyMeasurement) private readonly measurements: Repository<BodyMeasurement>,
    @InjectRepository(ProgressPhoto) private readonly photos: Repository<ProgressPhoto>,

    // workouts
    @InjectRepository(ExercisePlan) private readonly plans: Repository<ExercisePlan>,
    @InjectRepository(ExercisePlanDay) private readonly planDays: Repository<ExercisePlanDay>,
    @InjectRepository(ExercisePlanDayExercise) private readonly planDayExercises: Repository<ExercisePlanDayExercise>,

    // nutrition
    @InjectRepository(MealPlan) private readonly mealPlans: Repository<MealPlan>,
    @InjectRepository(MealPlanDay) private readonly mealPlanDays: Repository<MealPlanDay>,
    @InjectRepository(Meal) private readonly mealsRepo: Repository<Meal>,
    @InjectRepository(MealItem) private readonly mealItems: Repository<MealItem>,
    @InjectRepository(Supplement) private readonly supplements: Repository<Supplement>,
    @InjectRepository(MealPlanAssignment) private readonly assignments: Repository<MealPlanAssignment>,

    // logs / reports / activity
    @InjectRepository(MealLog) private readonly mealLogs: Repository<MealLog>,
    @InjectRepository(MealLogItem) private readonly mealLogItems: Repository<MealLogItem>,
    @InjectRepository(ExtraFood) private readonly extraFoods: Repository<ExtraFood>,
    @InjectRepository(SupplementLog) private readonly supplementLogs: Repository<SupplementLog>,
    @InjectRepository(WeeklyReport) private readonly weeklyReports: Repository<WeeklyReport>,
    @InjectRepository(ChatMessage) private readonly chatMessages: Repository<ChatMessage>,
  ) {}

  /* ----------------------------- helpers ----------------------------- */
  private async ensureUser(userId: string): Promise<User> {
    const u = await this.users.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  private buildDateWhere(field: any, range: DateRange): FindOptionsWhere<any> | undefined {
    const { from, to } = range || {};
    if (from && to) return { [field]: Between(from, to) } as any;
    if (from) return { [field]: MoreThanOrEqual(from) } as any;
    if (to) return { [field]: LessThanOrEqual(to) } as any;
    return undefined;
  }

  /* ----------------------------- aggregate ----------------------------- */
  async getPageData(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    const identity = user;

    const recentMeasurements = await this.measurements.find({
      where: { userId },
      order: { date: 'DESC' },
      take: 12,
    });

    let coach: any = [];
    if (user.coachId) {
      const coachId = await this.users.findOne({ where: { id: user.coachId } });
      coach = coachId;
    }

    let workouts: any = [];
    if (user.activeExercisePlanId) {
      const plan = await this.plans.findOne({ where: { id: user.activeExercisePlanId }, relations: ['days', 'days.items', 'days.items.exercise'] });
      workouts = plan;
    }

    let mealPlans: any = [];
    if (user.activeMealPlanId) {
      const plan = await this.mealPlans.findOne({ where: { id: user.activeMealPlanId }, relations: ['days', 'days.meals', 'days.supplements'] });
      if (plan) {
        mealPlans = plan;
      }
    }

    const [reports] = await Promise.all([
      this.weeklyReports.find({
        where: { userId },
        order: { created_at: 'DESC' },
        take: 6,
      }),
    ]);

    const weeklyReport = [...reports.map(r => ({ id: (r as any).id, at: (r as any).created_at, kind: 'checkin', text: `Weekly report submitted (${(r as any).weekOf})` }))].sort((a, b) => +new Date(b.at as any) - +new Date(a.at as any)).slice(0, 8);

    return {
      identity,
      coach,
      measurements: recentMeasurements.reverse(),
      workouts,
      mealPlans,
      weeklyReport,
    };
  }

  /* ----------------------------- measurements ----------------------------- */
  async listMeasurements(userId: string, range: DateRange) {
    await this.ensureUser(userId);
    return this.measurements.find({
      where: { userId, ...(this.buildDateWhere('date', range) ?? {}) },
      order: { date: 'ASC' },
    });
  }

  async upsertMeasurement(userId: string, dto: Partial<BodyMeasurement>) {
    await this.ensureUser(userId);
    const existing = await this.measurements.findOne({ where: { userId, date: dto.date } });
    const record = this.measurements.create({ ...existing, ...dto, userId });
    return this.measurements.save(record);
  }

  /* ----------------------------- progress photos ----------------------------- */
  async listProgressPhotos(userId: string, range: DateRange) {
    await this.ensureUser(userId);
    return this.photos.find({
      where: { userId, ...(this.buildDateWhere('takenAt', range) ?? {}) },
      order: { takenAt: 'DESC' },
      take: 24,
    });
  }

  /* ----------------------------- workouts ----------------------------- */
  async listWorkouts(userId: string) {
    const user = await this.ensureUser(userId);
    if (!user.activeExercisePlanId) return [];
    const plan = await this.plans.findOne({ where: { id: user.activeExercisePlanId } });
    if (!plan) return [];
    const days = await this.planDays.find({ where: { plan: { id: plan.id } }, order: { created_at: 'ASC' } });
    return days.map(d => ({
      id: (d as any).id,
      name: d.name || d.day,
      schedule: d.day,
      status: (plan as any).isActive ? 'Assigned' : 'Inactive',
    }));
  }

  /* ----------------------------- meal plans ----------------------------- */
  async listMealPlans(userId: string) {
    const user = await this.ensureUser(userId);
    if (!user.activeMealPlanId) return [];
    const plan = await this.mealPlans.findOne({ where: { id: user.activeMealPlanId } });
    if (!plan) return [];
    return [
      {
        id: plan.id,
        name: plan.name,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        status: (plan as any).isActive ? 'Active' : 'Inactive',
      },
    ];
  }

  /* ----------------------------- meal logs (daily) ----------------------------- */
  async listMealLogsForDay(userId: string, dayISO?: string) {
    await this.ensureUser(userId);
    const where: FindOptionsWhere<MealLog> = { userId };
    if (dayISO) {
      const start = new Date(`${dayISO}T00:00:00.000Z`);
      const end = new Date(`${dayISO}T23:59:59.999Z`);
      (where as any).eatenAt = Between(start, end);
    }
    const logs = await this.mealLogs.find({
      where,
      order: { eatenAt: 'ASC' },
      relations: ['items', 'extraFoods', 'supplementsTaken'],
    });
    return logs;
  }

  /* ----------------------------- weekly reports (list) ----------------------------- */
  async listWeeklyReports(userId: string, page = 1, limit = 20) {
    await this.ensureUser(userId);
    const [rows, total] = await this.weeklyReports.findAndCount({
      where: { userId },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const records = rows.map(r => ({
      id: (r as any).id,
      title: `Weekly Nutrition Report`,
      description: (r as any).coachFeedback ?? null,
      reportDate: (r as any).created_at,
      periodStart: (r as any).weekOf,
      periodEnd: (r as any).weekOf,
    }));
    return { total, page, limit, records };
  }

  /* ----------------------------- weekly reports (create) ----------------------------- */
  /**
   * Creates a minimal WeeklyReport that satisfies non-null columns in your entity.
   * Accepts: { weekOf?: 'YYYY-MM-DD', coachFeedback?: string }
   */
  async generateWeeklyReport(userId: string, dto: any) {
    await this.ensureUser(userId);

    // Use provided weekOf or default to current week's Monday
    const weekOf = dto?.weekOf || this.startOfWeekISO(new Date());

    const draft = this.weeklyReports.create({
      userId,
      coachId: dto?.coachId ?? null,
      adminId: dto?.adminId ?? null,
      weekOf,

      diet: {
        hungry: 'no',
        mentalComfort: 'yes',
        wantSpecific: '',
        foodTooMuch: 'no',
        dietDeviation: { hasDeviation: 'no', times: null, details: null },
      },

      training: {
        intensityOk: 'yes',
        daysDeviation: { hasDeviation: 'no', count: null, reason: null },
        shapeChange: 'no',
        fitnessChange: 'no',
        sleep: { enough: 'yes', hours: '7' },
        programNotes: '',
        cardioAdherence: 0,
      },

      measurements: null,

      photos: {
        front: null,
        back: null,
        left: null,
        right: null,
        extras: [],
      },

      isRead: false,
      coachFeedback: dto?.coachFeedback ?? null,
      reviewedAt: null,
      reviewedById: null,
    });

    const saved = await this.weeklyReports.save(draft);

    return {
      id: (saved as any).id,
      title: 'Weekly Nutrition Report',
      description: saved.coachFeedback ?? null,
      reportDate: (saved as any).created_at,
      periodStart: saved.weekOf,
      periodEnd: saved.weekOf,
    };
  }

  private startOfWeekISO(date: Date) {
    // ISO week starts Monday
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7; // 1..7
    if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
    return d.toISOString().slice(0, 10);
  }

  async getNutritionTargets(userId: string) {
    const user = await this.ensureUser(userId);

    // Try to infer from an active assignment/plan if you have numbers there.
    let plan: MealPlan | null = null;
    if (user.activeMealPlanId) {
      plan = await this.mealPlans.findOne({ where: { id: user.activeMealPlanId } });
    }

    // You can replace the zeros with sums computed from MealPlanDay/MealPlanFood if you like.
    const target = {
      calories: plan ? 0 : 0,
      protein: plan ? 0 : 0,
      carbs: plan ? 0 : 0,
      fat: plan ? 0 : 0,
      planId: plan?.id ?? null,
      planName: plan?.name ?? null,
      status: plan ? ((plan as any).isActive ? 'Active' : 'Inactive') : 'None',
    };

    return { userId, target };
  }

  /* ----------------------------- COMPAT: weight metrics (last N days) ----------------------------- */
  async getWeightMetrics(userId: string, days = 30) {
    await this.ensureUser(userId);

    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - Math.max(1, days));

    const rows = await this.measurements.find({
      where: {
        userId,
        date: Between(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)),
      },
      order: { date: 'ASC' },
    });

    // Shape compatible with typical /metrics/weights responses
    return {
      userId,
      days,
      points: rows.map(r => ({ date: r.date, weight: (r as any).weight ?? null })),
    };
  }

  /* ----------------------------- COMPAT: recent meal logs (last N days) ----------------------------- */
  async listMealLogsRecent(userId: string, days = 30) {
    await this.ensureUser(userId);

    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - Math.max(1, days));

    const logs = await this.mealLogs.find({
      where: {
        userId,
        eatenAt: Between(start, end),
      } as any,
      order: { eatenAt: 'ASC' },
      relations: ['items', 'extraFoods', 'supplementsTaken'],
    });

    return {
      userId,
      days,
      records: logs,
      total_records: logs.length,
    };
  }
}
