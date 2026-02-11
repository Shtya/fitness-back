import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between, Like, DataSource, IsNull } from 'typeorm';

import {
  MealPlan,
  MealPlanDay,
  MealPlanFood,
  MealPlanAssignment,
  Meal,
  MealItem,
  Supplement,
  MealLog,
  MealLogItem,
  ExtraFood,
  SupplementLog,
  FoodSuggestion,
  NutritionStats as NutritionStatsEntity,
  DayOfWeek,
} from '../../entities/meal_plans.entity';

import {
  User,
  UserRole,
  Notification as NotificationEntity,
  NotificationAudience,
  NotificationType,
} from '../../entities/global.entity';

import { CreateMealPlanDto } from './dto/create-meal-plan.dto';
import { LogMealDto } from './dto/log-meal.dto';
import { CreateSuggestionDto } from './dto/suggestion.dto';
import { UpdateMealPlanDto } from './dto/update-meal-plan.dto';
import { MealPlanListResponse, ProgressData } from './interfaces/nutrition.interface';
import { GymSettings } from '../../entities/settings.entity';

/** ---------- i18n helpers ---------- */
type Lang = 'ar' | 'en';
const t = (lang: Lang | undefined, key: string) => {
  const L = lang === 'ar' ? 'ar' : 'en';
  const M: Record<string, { ar: string; en: string }> = {
    plan_not_found: { en: 'Meal plan not found', ar: 'لم يتم العثور على خطة الوجبات' },
    user_not_found: { en: 'User not found', ar: 'المستخدم غير موجود' },
    forbidden_view: { en: 'You are not allowed to view this meal plan', ar: 'غير مسموح لك بعرض هذه الخطة' },
    forbidden_edit_others: { en: 'You can only modify or delete your own plans', ar: 'يمكنك تعديل أو حذف خططك فقط' },
    invalid_date: { en: 'Invalid date. Use ISO date or YYYY-MM-DD.', ar: 'تاريخ غير صالح. الرجاء استخدام صيغة ISO أو YYYY-MM-DD.' },
  };
  return (M[key] || { ar: key, en: key })[L];
};

function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function dayBoundsUTC(dateInput: string | Date) {
  const d = typeof dateInput === 'string' ? (isYMD(dateInput) ? new Date(dateInput + 'T00:00:00Z') : new Date(dateInput)) : new Date(dateInput);
  if (isNaN(d.getTime())) throw new Error('Invalid date');
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

@Injectable()
export class NutritionService {
  constructor(
    @InjectRepository(MealPlan) private mealPlanRepo: Repository<MealPlan>,
    @InjectRepository(MealPlanDay) private mealPlanDayRepo: Repository<MealPlanDay>,
    @InjectRepository(MealPlanFood) private mealPlanFoodRepo: Repository<MealPlanFood>,
    @InjectRepository(MealPlanAssignment) private assignmentRepo: Repository<MealPlanAssignment>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Meal) private mealRepo: Repository<Meal>,
    @InjectRepository(MealItem) private mealItemRepo: Repository<MealItem>,
    @InjectRepository(Supplement) private supplementRepo: Repository<Supplement>,
    @InjectRepository(MealLog) private mealLogRepo: Repository<MealLog>,
    @InjectRepository(MealLogItem) private mealLogItemRepo: Repository<MealLogItem>,
    @InjectRepository(ExtraFood) private extraFoodRepo: Repository<ExtraFood>,
    @InjectRepository(SupplementLog) private supplementLogRepo: Repository<SupplementLog>,
    @InjectRepository(FoodSuggestion) private suggestionRepo: Repository<FoodSuggestion>,
    @InjectRepository(NutritionStatsEntity) private statsRepo: Repository<NutritionStatsEntity>,
    @InjectRepository(NotificationEntity) private notificationRepo: Repository<NotificationEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /** ===================== helpers ===================== */
  private capitalizeDay(day: string): string {
    return day.charAt(0).toUpperCase() + day.slice(1);
  }

  private dayOrder(d: DayOfWeek): number {
    const order: DayOfWeek[] = [
      DayOfWeek.SATURDAY,
      DayOfWeek.SUNDAY,
      DayOfWeek.MONDAY,
      DayOfWeek.TUESDAY,
      DayOfWeek.WEDNESDAY,
      DayOfWeek.THURSDAY,
      DayOfWeek.FRIDAY,
    ];
    return order.indexOf(d);
  }

  private normalizeMealsPayload(meals: any[] = []) {
    // sanitize + ensure stable order by array index
    return (meals || []).map((m, mi) => ({
      title: String(m?.title || `Meal ${mi + 1}`).trim(),
      time: m?.time ? String(m.time) : null,
      items: (m?.items || []).map((it, ii) => ({
        name: String(it?.name || '').trim(),
        quantity: it?.quantity === '' || it?.quantity == null ? null : Number(it.quantity),
				unit: it?.unit === 'count' ? 'count' : 'g',
        calories: Number(it?.calories ?? 0),
        orderIndex: ii,
      })),
      supplements: (m?.supplements || []).map((s, si) => ({
        name: String(s?.name || '').trim(),
        time: s?.time ? String(s.time) : null,
        timing: s?.timing ? String(s.timing) : null,
        bestWith: s?.bestWith ? String(s.bestWith) : null,
        orderIndex: si,
      })),
      orderIndex: mi,
    }));
  }

  private getDayMealsFromDto(dto: CreateMealPlanDto | UpdateMealPlanDto, day: DayOfWeek) {
    const override = (dto as any)?.dayOverrides?.[day];
    const mealsToUse = override?.meals?.length ? override.meals : (dto as any).baseMeals;
    const daySupps = override?.supplements || [];
    return { mealsToUse, daySupps };
  }

  private async fetchPlanDetailsOrdered(planId: string) {
    // ✅ ORDERED query (fixes: items order messed up)
    return this.mealPlanRepo
      .createQueryBuilder('plan')
      .leftJoinAndSelect('plan.days', 'day')
      .leftJoinAndSelect('day.meals', 'meal')
      .leftJoinAndSelect('meal.items', 'item')
      .leftJoinAndSelect('meal.supplements', 'mealSupp')
      .leftJoinAndSelect('day.supplements', 'daySupp')
      .where('plan.id = :id', { id: planId })
      .andWhere('plan.deleted_at IS NULL')
      // order
      .orderBy(
        `
        CASE day.day
          WHEN 'saturday' THEN 0
          WHEN 'sunday' THEN 1
          WHEN 'monday' THEN 2
          WHEN 'tuesday' THEN 3
          WHEN 'wednesday' THEN 4
          WHEN 'thursday' THEN 5
          WHEN 'friday' THEN 6
          ELSE 99
        END
      `,
        'ASC',
      )
      .addOrderBy('meal.orderIndex', 'ASC')
      .addOrderBy('item.orderIndex', 'ASC')
      .addOrderBy('mealSupp.orderIndex', 'ASC')
      .addOrderBy('daySupp.orderIndex', 'ASC')
      .getOne();
  }

  /** ===================== MEAL PLANS ===================== */

  async createMealPlan(createDto: CreateMealPlanDto, user: any, lang?: Lang): Promise<MealPlan> {
    const adminId = user.role === UserRole.COACH ? user?.adminId : user.id;

    const plan = this.mealPlanRepo.create({
      name: createDto.name,
      desc: createDto.description || null,
      notes: createDto.notes || null,
      customizeDays: !!createDto.customizeDays,
      adminId,
      coachId: user.role === UserRole.COACH ? user.id : null,
    });

    return this.dataSource.transaction(async (manager) => {
      const planRepo = manager.getRepository(MealPlan);
      const dayRepo = manager.getRepository(MealPlanDay);
      const mealRepo = manager.getRepository(Meal);
      const itemRepo = manager.getRepository(MealItem);
      const suppRepo = manager.getRepository(Supplement);

      const savedPlan = await planRepo.save(plan);

      // create days
      const dayEntities = Object.values(DayOfWeek).map((day) =>
        dayRepo.create({ mealPlan: savedPlan, day, name: this.capitalizeDay(day) }),
      );
      const savedDays = await dayRepo.save(dayEntities);

      // build meals/supps
      for (const d of savedDays) {
        const { mealsToUse, daySupps } = this.getDayMealsFromDto(createDto, d.day);
        const normalizedMeals = this.normalizeMealsPayload(mealsToUse || []);

        for (const m of normalizedMeals) {
          const meal = await mealRepo.save(
            mealRepo.create({
              day: d,
              title: m.title,
              time: m.time,
              orderIndex: m.orderIndex,
            }),
          );

          if (m.items?.length) {
            const items = m.items.map((it) =>
              itemRepo.create({
                meal,
                name: it.name,
                quantity: it.quantity ?? null,
								unit: it.unit === 'count' ? 'count' : 'g',
                calories: it.calories,
                orderIndex: it.orderIndex,
              }),
            );
            await itemRepo.save(items);
          }

          if (m.supplements?.length) {
            const supps = m.supplements.map((s) =>
              suppRepo.create({
                meal,
                day: null,
                name: s.name,
                time: s.time,
                timing: s.timing,
                bestWith: s.bestWith,
                orderIndex: s.orderIndex,
              }),
            );
            await suppRepo.save(supps);
          }
        }

        if (daySupps?.length) {
          const normalizedDaySupps = (daySupps || []).map((s: any, si: number) => ({
            name: String(s?.name || '').trim(),
            time: s?.time ? String(s.time) : null,
            timing: s?.timing ? String(s.timing) : null,
            bestWith: s?.bestWith ? String(s.bestWith) : null,
            orderIndex: si,
          }));

          await suppRepo.save(
            normalizedDaySupps.map((s) =>
              suppRepo.create({
                day: d,
                meal: null,
                name: s.name,
                time: s.time,
                timing: s.timing,
                bestWith: s.bestWith,
                orderIndex: s.orderIndex,
              }),
            ),
          );
        }
      }

      const full = await manager.getRepository(MealPlan).findOne({ where: { id: savedPlan.id } });
      if (!full) throw new NotFoundException(t(lang, 'plan_not_found'));
      return this.fetchPlanDetailsOrdered(savedPlan.id);
    });
  }

  async findAllMealPlans(
    params: { q?: string; sortBy?: string; sortOrder?: 'ASC' | 'DESC'; limit?: number; page?: number },
    user: { id: string; role: UserRole },
    _lang?: Lang,
  ): Promise<MealPlanListResponse> {
    const { q, sortBy = 'created_at', sortOrder = 'DESC', limit = 12, page = 1 } = params;
    const skip = (page - 1) * limit;

    // ✅ FAST LIST: no relations
    const where = [
      { adminId: IsNull(), ...(q ? { name: Like(`%${q}%`) } : {}) },
      { adminId: user.id, ...(q ? { name: Like(`%${q}%`) } : {}) },
    ];

    const [records, total] = await this.mealPlanRepo.findAndCount({
      where,
      select: ['id', 'name', 'desc', 'notes', 'adminId', 'created_at', 'updated_at', 'customizeDays', 'isActive'],
      order: { [sortBy]: sortOrder as any },
      skip,
      take: limit,
    });

    return { records, total, page, limit };
  }

  async findMealPlanByIdSecure(id: string, user: { id: string; role: UserRole }, lang?: Lang): Promise<MealPlan> {
    const plan = await this.fetchPlanDetailsOrdered(id);
    if (!plan) throw new NotFoundException(t(lang, 'plan_not_found'));

    // ✅ (اختياري) رجّع الـ auth check
    // const canView = plan.adminId === null || plan.adminId === user.id || user.role === UserRole.SUPER_ADMIN;
    // if (!canView) throw new ForbiddenException(t(lang, 'forbidden_view'));

    return plan;
  }

  async updateMealPlan(id: string, updateDto: UpdateMealPlanDto, user: any, lang?: Lang): Promise<MealPlan> {
    const adminId = user.role === UserRole.COACH ? user?.adminId : user.id;

    // load minimal plan to check ownership
    const existing = await this.mealPlanRepo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException(t(lang, 'plan_not_found'));

    // ✅ basic ownership rule (غير super admin)
    if (existing.adminId && existing.adminId !== adminId && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(t(lang, 'forbidden_edit_others'));
    }

    return this.dataSource.transaction(async (manager) => {
      const planRepo = manager.getRepository(MealPlan);
      const dayRepo = manager.getRepository(MealPlanDay);
      const mealRepo = manager.getRepository(Meal);
      const itemRepo = manager.getRepository(MealItem);
      const suppRepo = manager.getRepository(Supplement);

      const plan = await planRepo.findOne({ where: { id }, relations: ['days'] });
      if (!plan) throw new NotFoundException(t(lang, 'plan_not_found'));

      // update plan core fields
      if (updateDto.name !== undefined) plan.name = updateDto.name;
      if (updateDto.description !== undefined) plan.desc = updateDto.description || null;
      if (updateDto.notes !== undefined) plan.notes = updateDto.notes || null;
      if (updateDto.customizeDays !== undefined) plan.customizeDays = !!updateDto.customizeDays;

      plan.adminId = adminId;
      await planRepo.save(plan);

      // ✅ if no baseMeals in updateDto => keep structure (only metadata updated)
      if (!updateDto.baseMeals || !Array.isArray(updateDto.baseMeals) || updateDto.baseMeals.length === 0) {
        return this.fetchPlanDetailsOrdered(id);
      }

      // ensure days exist (in case old data missing)
      if (!plan.days || plan.days.length === 0) {
        const newDays = Object.values(DayOfWeek).map((d) => dayRepo.create({ mealPlan: plan, day: d, name: this.capitalizeDay(d) }));
        plan.days = await dayRepo.save(newDays);
      }

      // ✅ rebuild all day structures (delete old then recreate)
      for (const d of plan.days) {
        // delete meals/items/supplements for this day
        const meals = await mealRepo.find({ where: { day: { id: d.id } }, select: ['id'] });
        const mealIds = meals.map((m) => m.id);

        if (mealIds.length) {
          await itemRepo.delete({ meal: { id: In(mealIds) } as any });
          await suppRepo.delete({ meal: { id: In(mealIds) } as any });
          await mealRepo.delete({ id: In(mealIds) } as any);
        }

        // delete day-level supplements
        await suppRepo.delete({ day: { id: d.id } as any });

        const { mealsToUse, daySupps } = this.getDayMealsFromDto(updateDto, d.day);
        const normalizedMeals = this.normalizeMealsPayload(mealsToUse || []);

        for (const m of normalizedMeals) {
          const meal = await mealRepo.save(
            mealRepo.create({
              day: d,
              title: m.title,
              time: m.time,
              orderIndex: m.orderIndex,
            }),
          );

          if (m.items?.length) {
            await itemRepo.save(
              m.items.map((it) =>
                itemRepo.create({
                  meal,
                  name: it.name,
                  quantity: it.quantity ?? null,
									unit: it.unit === 'count' ? 'count' : 'g',
                  calories: it.calories,
                  orderIndex: it.orderIndex,
                }),
              ),
            );
          }

          if (m.supplements?.length) {
            await suppRepo.save(
              m.supplements.map((s) =>
                suppRepo.create({
                  meal,
                  day: null,
                  name: s.name,
                  time: s.time,
                  timing: s.timing,
                  bestWith: s.bestWith,
                  orderIndex: s.orderIndex,
                }),
              ),
            );
          }
        }

        if (daySupps?.length) {
          await suppRepo.save(
            (daySupps || []).map((s: any, si: number) =>
              suppRepo.create({
                day: d,
                meal: null,
                name: String(s?.name || '').trim(),
                time: s?.time ? String(s.time) : null,
                timing: s?.timing ? String(s.timing) : null,
                bestWith: s?.bestWith ? String(s.bestWith) : null,
                orderIndex: si,
              }),
            ),
          );
        }
      }

      return this.fetchPlanDetailsOrdered(id);
    });
  }

  async deleteMealPlan(id: string, user: { id: string; role: UserRole }, lang?: Lang): Promise<{ success: true }> {
    const plan = await this.mealPlanRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(t(lang, 'plan_not_found'));
    await this.mealPlanRepo.softRemove(plan);
    return { success: true };
  }

  async assignMealPlan(planId: string, userId: string, requester: { id: string; role: UserRole }, lang?: Lang) {
    const plan = await this.findMealPlanByIdSecure(planId, requester, lang);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(t(lang, 'user_not_found'));
    user.activeMealPlan = plan as any;
    await this.userRepo.save(user);
  }

  async getClientMealPlan(userId: string): Promise<MealPlan> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['activeMealPlan'] });
    if (!user?.activeMealPlan) throw new NotFoundException('No active meal plan found');
    const plan = await this.fetchPlanDetailsOrdered(user.activeMealPlan.id);
    if (!plan) throw new NotFoundException('No active meal plan found');
    return plan;
  }

  /** ===================== MEAL LOGGING (kept, with date validation fix) ===================== */
  async getMealLogs(userId: string, days: any = 30, date?: string): Promise<MealLog[]> {
    if (date) {
      try {
        const { start, end } = dayBoundsUTC(date);
        return this.mealLogRepo.find({
          where: { user: { id: userId } as any, eatenAt: Between(start, end) },
          order: { eatenAt: 'DESC' },
          relations: ['items', 'extraFoods', 'supplementsTaken'],
        });
      } catch {
        throw new BadRequestException(t(undefined, 'invalid_date'));
      }
    }

    const daysNumber = Number(days);
    const validDays = isNaN(daysNumber) || daysNumber <= 0 ? 30 : daysNumber;
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - validDays);

    return this.mealLogRepo.find({
      where: { user: { id: userId } as any, eatenAt: Between(cutoff, now) },
      order: { eatenAt: 'DESC' },
      relations: ['items', 'extraFoods', 'supplementsTaken'],
    });
  }

  async logMeal(userId: string, logDto: LogMealDto): Promise<MealLog> {
    const eatenAt = new Date(logDto.eatenAt || new Date());
    const startOfDay = new Date(eatenAt);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    return this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const mealLogRepo = manager.getRepository(MealLog);
      const mealLogItemRepo = manager.getRepository(MealLogItem);
      const extraFoodRepo = manager.getRepository(ExtraFood);
      const supplementLogRepo = manager.getRepository(SupplementLog);

      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      let existing = await mealLogRepo.findOne({
        where: {
          user: { id: userId } as any,
          planId: logDto.planId,
          day: logDto.day,
          mealIndex: logDto.mealIndex,
          eatenAt: Between(startOfDay, endOfDay),
        } as any,
        relations: ['items', 'extraFoods', 'supplementsTaken'],
      });

      if (existing) {
        existing.adherence = logDto.adherence ?? existing.adherence;
        existing.eatenAt = eatenAt;
        existing.notes = logDto.notes ?? existing.notes;
        existing.notifyCoach = logDto.notifyCoach ?? existing.notifyCoach;
        existing.mealTitle = logDto.mealTitle ?? existing.mealTitle;
        await mealLogRepo.save(existing);

        // ✅ safer: replace items بالكامل (avoids name collision bugs)
        await mealLogItemRepo.delete({ mealLog: { id: existing.id } as any });
        if (logDto.items?.length) {
          await mealLogItemRepo.save(
            logDto.items.map((i) =>
              mealLogItemRepo.create({
                mealLog: existing,
                name: i.name,
                taken: i.taken,
                quantity: i.qty ?? null,
              }),
            ),
          );
        }

        await extraFoodRepo.delete({ mealLog: { id: existing.id } as any });
        if (logDto.extraFoods?.length) {
          await extraFoodRepo.save(
            logDto.extraFoods.map((e) =>
              extraFoodRepo.create({
                mealLog: existing,
                name: e.name,
                quantity: e.quantity ?? null,
                calories: e.calories ?? null,
                protein: e.protein ?? null,
                carbs: e.carbs ?? null,
                fat: e.fat ?? null,
              }),
            ),
          );
        }

        await supplementLogRepo.delete({ mealLog: { id: existing.id } as any });
        if (logDto.supplementsTaken?.length) {
          await supplementLogRepo.save(
            logDto.supplementsTaken.map((s) =>
              supplementLogRepo.create({
                mealLog: existing,
                name: s.name,
                taken: s.taken,
              }),
            ),
          );
        }

        return mealLogRepo.findOne({
          where: { id: existing.id } as any,
          relations: ['items', 'extraFoods', 'supplementsTaken'],
        }) as any;
      }

      const mealLog = mealLogRepo.create({
        user,
        planId: logDto.planId,
        day: logDto.day,
        dayName: this.capitalizeDay(logDto.day),
        mealIndex: logDto.mealIndex,
        mealTitle: logDto.mealTitle,
        eatenAt,
        adherence: logDto.adherence,
        notes: logDto.notes,
        notifyCoach: logDto.notifyCoach,
      } as any);

      const savedLog:any = await mealLogRepo.save(mealLog);

      if (logDto.items?.length) {
        await mealLogItemRepo.save(
          logDto.items.map((i) =>
            mealLogItemRepo.create({
              mealLog: savedLog,
              name: i.name,
              taken: i.taken,
              quantity: i.qty ?? null,
            }),
          ),
        );
      }

      if (logDto.extraFoods?.length) {
        await extraFoodRepo.save(
          logDto.extraFoods.map((e) =>
            extraFoodRepo.create({
              mealLog: savedLog,
              name: e.name,
              quantity: e.quantity ?? null,
              calories: e.calories ?? null,
              protein: e.protein ?? null,
              carbs: e.carbs ?? null,
              fat: e.fat ?? null,
            }),
          ),
        );
      }

      if (logDto.supplementsTaken?.length) {
        await supplementLogRepo.save(
          logDto.supplementsTaken.map((s) =>
            supplementLogRepo.create({
              mealLog: savedLog  as any,
              name: s.name,
              taken: s.taken,
            }),
          ),
        );
      }

      return mealLogRepo.findOne({
        where: { id: savedLog.id  } as any,
        relations: ['items', 'extraFoods', 'supplementsTaken'],
      }) as any;
    });
  }

  /** ===================== SUGGESTIONS / AI (kept) ===================== */
  async createSuggestion(userId: string, suggestionDto: CreateSuggestionDto): Promise<FoodSuggestion> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const suggestion = this.suggestionRepo.create({
      user,
      day: suggestionDto.day,
      mealIndex: suggestionDto.mealIndex,
      message: suggestionDto.message,
      wantsAlternative: suggestionDto.wantsAlternative,
    } as any);

    const saved = await this.suggestionRepo.save(suggestion as any);
    await this.createAdminNotificationForSuggestion(user, saved);
    return saved;
  }

  private async getAiKeyForAdmin(adminId: string): Promise<string> {
    const repo = this.dataSource.getRepository(GymSettings);
    const settings = await repo.findOne({ where: { adminId } });
    const aiKey = settings?.aiSecretKey || process.env.aiSecretKey;
    if (!aiKey) throw new BadRequestException('AI key is not configured for this account.');
    return aiKey;
  }

  async generateMealPlanWithAI(prompt: string, adminId: any): Promise<any> {
    const aiKey = await this.getAiKeyForAdmin(adminId);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}` },
        body: JSON.stringify({
          model: 'openai/gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await response.json();
      return data.choices?.[0]?.message?.content ?? null;
    } catch {
      throw new BadRequestException('AI generation failed');
    }
  }

  private async createAdminNotificationForSuggestion(user: User, suggestion: FoodSuggestion) {
    const dayLabel = this.capitalizeDay(suggestion.day);
    const mealLabel = `Meal ${Number(suggestion.mealIndex) + 1}`;
    const notif = this.notificationRepo.create({
      type: NotificationType.FORM_SUBMISSION,
      title: `New meal suggestion from ${user.name}`,
      message: `${user.name} submitted a suggestion for ${dayLabel} • ${mealLabel}:\n${suggestion.message}`,
      data: {
        userId: user.id,
        suggestionId: suggestion.id,
        day: suggestion.day,
        mealIndex: suggestion.mealIndex,
        wantsAlternative: suggestion.wantsAlternative,
        createdAt: suggestion.created_at,
      },
      user: null,
      audience: NotificationAudience.ADMIN,
      isRead: false,
    });
    await this.notificationRepo.save(notif);
  }

  async getNutritionStats(user?: { id: string; role: UserRole }) {
    const globalPlansCount = await this.mealPlanRepo.count({ where: { isActive: true, adminId: IsNull() } });
    const myPlansCount = user?.id ? await this.mealPlanRepo.count({ where: { isActive: true, adminId: user.id } }) : 0;
    return { totals: { globalPlansCount, myPlansCount } };
  }

  async getClientProgress(_userId: string, _rangeDays: number = 30): Promise<ProgressData> {
    return {
      weightSeries: [],
      adherence: [],
      macros: [],
      mealCompliance: [],
      extras: [],
      supplements: [],
      target: { calories: 2300, protein: 180, carbs: 220, fat: 70 },
    };
  }
}
