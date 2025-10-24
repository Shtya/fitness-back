// --- File: nutrition/nutrition.service.ts ---
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between, Like, DataSource } from 'typeorm';
import { MealPlan, MealPlanDay, MealPlanFood, MealPlanAssignment, User, Meal, MealItem, Supplement, MealLog, MealLogItem, ExtraFood, SupplementLog, FoodSuggestion, NutritionStats, DayOfWeek, UserRole, Notification as NotificationEntity, NotificationAudience, NotificationType } from '../../entities/global.entity';
import { CreateMealPlanDto } from './dto/create-meal-plan.dto';
import { LogMealDto } from './dto/log-meal.dto';
import { CreateSuggestionDto } from './dto/suggestion.dto';
import { NutritionStats as INutritionStats, MealPlanListResponse, ProgressData } from './interfaces/nutrition.interface';
import { UpdateMealPlanDto } from './dto/update-meal-plan.dto';
function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function dayBoundsUTC(dateInput: string | Date) {
  // If "YYYY-MM-DD", treat as midnight UTC that day
  const d = typeof dateInput === 'string'
    ? (isYMD(dateInput) ? new Date(dateInput + 'T00:00:00Z') : new Date(dateInput))
    : new Date(dateInput);

  if (isNaN(d.getTime())) throw new Error('Invalid date');

  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
@Injectable()
export class NutritionService {
  constructor(
    @InjectRepository(MealPlan)
    public mealPlanRepo: Repository<MealPlan>,
    @InjectRepository(MealPlanDay)
    private mealPlanDayRepo: Repository<MealPlanDay>,
    @InjectRepository(MealPlanFood)
    private mealPlanFoodRepo: Repository<MealPlanFood>,
    @InjectRepository(MealPlanAssignment)
    private assignmentRepo: Repository<MealPlanAssignment>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Meal)
    private mealRepo: Repository<Meal>,
    @InjectRepository(MealItem)
    private mealItemRepo: Repository<MealItem>,
    @InjectRepository(Supplement)
    private supplementRepo: Repository<Supplement>,
    @InjectRepository(MealLog)
    private mealLogRepo: Repository<MealLog>,
    @InjectRepository(MealLogItem)
    private mealLogItemRepo: Repository<MealLogItem>,
    @InjectRepository(ExtraFood)
    private extraFoodRepo: Repository<ExtraFood>,
    @InjectRepository(SupplementLog)
    private supplementLogRepo: Repository<SupplementLog>,
    @InjectRepository(FoodSuggestion)
    private suggestionRepo: Repository<FoodSuggestion>,
    @InjectRepository(NutritionStats)
    private statsRepo: Repository<NutritionStats>,
    @InjectRepository(NotificationEntity)
    private notificationRepo: Repository<NotificationEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // ========== MEAL PLANS MANAGEMENT ==========

  async createMealPlan(createDto: CreateMealPlanDto, coachId?: string): Promise<MealPlan> {
    const mealPlan = this.mealPlanRepo.create({
      name: createDto.name,
      desc: createDto.description,
      notes: createDto.notes,
      coachId: coachId,
      customizeDays: createDto.customizeDays || false,
    });

    const savedPlan = await this.mealPlanRepo.save(mealPlan);

    // Create days
    const days = Object.values(DayOfWeek).map(day =>
      this.mealPlanDayRepo.create({
        mealPlan: savedPlan,
        day,
        name: this.capitalizeDay(day),
      }),
    );

    const savedDays = await this.mealPlanDayRepo.save(days);

    // Create meals and supplements for each day
    for (const day of savedDays) {
      const dayOverride = createDto.dayOverrides?.[day.day as DayOfWeek];
      const mealsToUse = dayOverride?.meals || createDto.baseMeals;
      const supplementsToUse = dayOverride?.supplements || [];

      // meals
      for (let i = 0; i < mealsToUse.length; i++) {
        const mealData = mealsToUse[i];
        const meal = this.mealRepo.create({
          day,
          title: mealData.title,
          time: mealData.time || null,
          orderIndex: i,
        });
        const savedMeal = await this.mealRepo.save(meal);

        // items
        const mealItems = (mealData.items || []).map((item, itemIndex) =>
          this.mealItemRepo.create({
            meal: savedMeal,
            name: item.name,
            quantity: item.quantity ?? null,
            calories: item.calories,
            orderIndex: itemIndex,
          }),
        );
        if (mealItems.length) await this.mealItemRepo.save(mealItems);

        // meal-level supplements
        const mealSupps = (mealData.supplements || []).map((supp, si) =>
          this.supplementRepo.create({
            meal: savedMeal,
            name: supp.name,
            time: supp.time || null,
            timing: supp.timing || null,
            bestWith: supp.bestWith || null,
            orderIndex: si,
          }),
        );
        if (mealSupps.length) await this.supplementRepo.save(mealSupps);
      }

      // day-level supplements
      const daySupps = (supplementsToUse || []).map((supp, si) =>
        this.supplementRepo.create({
          day,
          name: supp.name,
          time: supp.time || null,
          timing: supp.timing || null,
          bestWith: supp.bestWith || null,
          orderIndex: si,
        }),
      );
      if (daySupps.length) await this.supplementRepo.save(daySupps);
    }

    return this.mealPlanRepo.findOne({
      where: { id: savedPlan.id },
      relations: ['days', 'days.meals', 'days.meals.items', 'days.meals.supplements', 'days.supplements'],
    });
  }

  async findAllMealPlans(params: { q?: string; sortBy?: string; sortOrder?: 'ASC' | 'DESC'; limit?: number; page?: number }): Promise<MealPlanListResponse> {
    const { q, sortBy = 'created_at', sortOrder = 'DESC', limit = 12, page = 1 } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (q) where.name = Like(`%${q}%`);

    const [records, total] = await this.mealPlanRepo.findAndCount({
      where,
      order: { [sortBy]: sortOrder },
      skip,
      take: limit,
      relations: ['assignments', 'assignments.athlete'],
    });

    return { records, total, page, limit };
  }

  async findMealPlanById(id: string): Promise<MealPlan> {
    const plan = await this.mealPlanRepo.findOne({
      where: { id },
      relations: ['days', 'days.meals', 'days.meals.items', 'days.meals.supplements', 'days.supplements', 'assignments', 'assignments.athlete'],
    });

    if (!plan) throw new NotFoundException('Meal plan not found');
    return plan;
  }

  async updateMealPlan(id: string, updateDto: UpdateMealPlanDto): Promise<MealPlan> {
    const plan = await this.findMealPlanById(id);

    if (updateDto.name !== undefined) plan.name = updateDto.name;
    if (updateDto.description !== undefined) plan.desc = updateDto.description;
    if (updateDto.notes !== undefined) plan.notes = updateDto.notes;
    if (updateDto.customizeDays !== undefined) plan.customizeDays = updateDto.customizeDays;

    await this.mealPlanRepo.save(plan);
    return this.findMealPlanById(id);
  }

  async deleteMealPlan(id: string): Promise<void> {
    const plan = await this.findMealPlanById(id);
    await this.mealPlanRepo.softRemove(plan);
  }

  async assignMealPlan(planId: string, userId: string): Promise<MealPlanAssignment> {
    const plan = await this.findMealPlanById(planId);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // deactivate old
    await this.assignmentRepo.update({ athlete: { id: userId }, isActive: true }, { isActive: false });

    const assignment = this.assignmentRepo.create({
      mealPlan: plan,
      athlete: user,
      isActive: true,
      startDate: new Date().toISOString().split('T')[0],
    });

    user.activeMealPlan = plan;
    await this.userRepo.save(user);

    return this.assignmentRepo.save(assignment);
  }

  async getPlanAssignments(planId: string): Promise<MealPlanAssignment[]> {
    return this.assignmentRepo.find({ where: { mealPlan: { id: planId } }, relations: ['athlete'] });
  }

  // ========== CLIENT MEAL PLAN ==========

  async getClientMealPlan(userId: string): Promise<MealPlan> {
    const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['activeMealPlan'] });
    if (!user?.activeMealPlan) throw new NotFoundException('No active meal plan found');
    return this.findMealPlanById(user.activeMealPlan.id);
  }

  // ========== MEAL LOGGING ==========

 async logMeal(userId: string, logDto: LogMealDto): Promise<MealLog> {
  const eatenAt = new Date(logDto.eatenAt || new Date());
  const startOfDay = new Date(eatenAt);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  return this.dataSource.transaction(async manager => {
    const userRepo = manager.getRepository(User);
    const mealLogRepo = manager.getRepository(MealLog);
    const mealLogItemRepo = manager.getRepository(MealLogItem);
    const extraFoodRepo = manager.getRepository(ExtraFood);
    const supplementLogRepo = manager.getRepository(SupplementLog);

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // 🔸 Find existing log for same user/day/mealIndex/mealTitle within same day
    let existing = await mealLogRepo.findOne({
      where: {
        user: { id: userId },
        planId: logDto.planId,
        day: logDto.day,
        mealIndex: logDto.mealIndex,
        mealTitle: logDto.mealTitle,
        eatenAt: Between(startOfDay, endOfDay),
      },
      relations: ['items', 'extraFoods', 'supplementsTaken'],
    });

    // 🔸 If found → update its items, not toggle them
    if (existing) {
      // Update header metadata
      existing.adherence = logDto.adherence ?? existing.adherence;
      existing.eatenAt = eatenAt;
      existing.notes = logDto.notes ?? existing.notes;
      existing.notifyCoach = logDto.notifyCoach ?? existing.notifyCoach;
      await mealLogRepo.save(existing);

      // Update or add items
      const incomingItems = logDto.items || [];
      for (const i of incomingItems) {
        const found = existing.items.find(it => it.name === i.name);
        if (found) {
          found.taken = i.taken; // ✅ keep what client sent
          found.quantity = i.qty ?? found.quantity;
          await mealLogItemRepo.save(found);
        } else {
          const newItem = mealLogItemRepo.create({
            mealLog: existing,
            name: i.name,
            taken: i.taken,
            quantity: i.qty ?? null,
          });
          await mealLogItemRepo.save(newItem);
        }
      }

      // Replace extras (simpler to delete + recreate)
      await extraFoodRepo.delete({ mealLog: { id: existing.id } });
      const extras = (logDto.extraFoods || []).map(e =>
        extraFoodRepo.create({
          mealLog: existing,
          name: e.name,
          quantity: e.quantity ?? null,
          calories: e.calories ?? null,
          protein: e.protein ?? null,
          carbs: e.carbs ?? null,
          fat: e.fat ?? null,
        }),
      );
      if (extras.length) await extraFoodRepo.save(extras);

      // Replace supplements
      await supplementLogRepo.delete({ mealLog: { id: existing.id } });
      const supps = (logDto.supplementsTaken || []).map(s =>
        supplementLogRepo.create({
          mealLog: existing,
          name: s.name,
          taken: s.taken,
        }),
      );
      if (supps.length) await supplementLogRepo.save(supps);

      await this.updateNutritionStats(userId);

      return mealLogRepo.findOne({
        where: { id: existing.id },
        relations: ['items', 'extraFoods', 'supplementsTaken'],
      });
    }

    // 🔹 If no existing log, create new
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
    });
    const savedLog = await mealLogRepo.save(mealLog);

    // Items
    const items = (logDto.items || []).map(i =>
      mealLogItemRepo.create({
        mealLog: savedLog,
        name: i.name,
        taken: i.taken,
        quantity: i.qty ?? null,
      }),
    );
    if (items.length) await mealLogItemRepo.save(items);

    // Extras
    const extras = (logDto.extraFoods || []).map(e =>
      extraFoodRepo.create({
        mealLog: savedLog,
        name: e.name,
        quantity: e.quantity ?? null,
        calories: e.calories ?? null,
        protein: e.protein ?? null,
        carbs: e.carbs ?? null,
        fat: e.fat ?? null,
      }),
    );
    if (extras.length) await extraFoodRepo.save(extras);

    // Supplements
    const supps = (logDto.supplementsTaken || []).map(s =>
      supplementLogRepo.create({
        mealLog: savedLog,
        name: s.name,
        taken: s.taken,
      }),
    );
    if (supps.length) await supplementLogRepo.save(supps);

    await this.updateNutritionStats(userId);

    return mealLogRepo.findOne({
      where: { id: savedLog.id },
      relations: ['items', 'extraFoods', 'supplementsTaken'],
    });
  });
}


  async getMealLogs(userId: string, days: any = 30, date?: string): Promise<MealLog[]> {
    // If a specific day is requested → return all logs within that day (by eatenAt)
    if (date) {
      let start: Date, end: Date;
      try {
        ({ start, end } = dayBoundsUTC(date));
      } catch {
        throw new BadRequestException('Invalid date. Use ISO date or YYYY-MM-DD.');
      }

      return this.mealLogRepo.find({
        where: {
          user: { id: userId },
          eatenAt: Between(start, end),
        },
        order: { eatenAt: 'DESC' },
        relations: ['items', 'extraFoods', 'supplementsTaken'],
      });
    }

    // Fallback: last N days window
    const daysNumber = Number(days);
    const validDays = isNaN(daysNumber) || daysNumber <= 0 ? 30 : daysNumber;

    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - validDays);

    return this.mealLogRepo.find({
      where: {
        user: { id: userId },
        eatenAt: Between(cutoff, now),
      },
      order: { eatenAt: 'DESC' },
      relations: ['items', 'extraFoods', 'supplementsTaken'],
    });
  }

  // ========== SUGGESTIONS ==========

  async createSuggestion(userId: string, suggestionDto: CreateSuggestionDto): Promise<FoodSuggestion> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const suggestion = this.suggestionRepo.create({
      user,
      day: suggestionDto.day,
      mealIndex: suggestionDto.mealIndex,
      message: suggestionDto.message,
      wantsAlternative: suggestionDto.wantsAlternative,
    });
    const saved = await this.suggestionRepo.save(suggestion);

    // >>> Send ADMIN notification so admins see the client's suggestion
    await this.createAdminNotificationForSuggestion(user, saved);

    return saved;
  }

  async getUserSuggestions(userId: string, options: { status?: string; page?: number; limit?: number } = {}): Promise<{ suggestions: FoodSuggestion[]; total: number }> {
    const { status, page = 1, limit = 20 } = options;
    const skip = ((page || 1) - 1) * (limit || 1);

    const where: any = { user: { id: userId } };
    if (status && status !== 'all') where.status = status;

    const [suggestions, total] = await this.suggestionRepo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip,
      take: limit || 1,
      relations: ['reviewedBy'],
    });

    return { suggestions, total };
  }

  // Coaches can see suggestions of their clients
  async getAllSuggestions(coachId: string, options: { status?: string; clientId?: string; page?: number; limit?: number } = {}): Promise<{ suggestions: FoodSuggestion[]; total: number }> {
    const { status, clientId, page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    // all clients of this coach
    const coachClients = await this.userRepo.find({
      where: { coach: { id: coachId } },
      select: ['id'],
    });
    const clientIds = coachClients.map(c => c.id);

    const where: any = { user: { id: In(clientIds) } };
    if (status && status !== 'all') where.status = status;
    if (clientId) where.user = { id: clientId };

    const [suggestions, total] = await this.suggestionRepo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip,
      take: limit,
      relations: ['user', 'reviewedBy'],
    });

    return { suggestions, total };
  }

  // ========== STATISTICS ==========

  async getNutritionStats(): Promise<INutritionStats> {
    const totalPlans = await this.mealPlanRepo.count({ where: { isActive: true } });
    const activeAssignments = await this.assignmentRepo.count({ where: { isActive: true } });
    const totalDays = await this.mealPlanDayRepo.count();

    return {
      totals: {
        total: totalPlans,
        activePlans: totalPlans,
        totalDays,
        totalAssignments: activeAssignments,
      },
    };
  }

  async getClientProgress(userId: string, rangeDays: number = 30): Promise<ProgressData> {
    return this.generateProgressData(userId, rangeDays);
  }

  // ========== AI INTEGRATION ==========

  async generateMealPlanWithAI(prompt: string): Promise<any> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
        }),
      });

 
      const data = await response.json();
      return data.choices?.[0]?.message?.content ?? null;
    } catch (error) {
      throw new BadRequestException('AI generation failed');
    }
  }

  // ========== PRIVATE HELPERS ==========

  private capitalizeDay(day: string): string {
    return day.charAt(0).toUpperCase() + day.slice(1);
  }

  private async updateNutritionStats(userId: string): Promise<void> {
    // TODO: implement your stats calculations
    return;
  }

  private async generateProgressData(userId: string, rangeDays: number): Promise<ProgressData> {
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

  private async createAdminNotificationForSuggestion(user: User, suggestion: FoodSuggestion) {
    // Build a readable label for the day/meal
    const dayLabel = this.capitalizeDay(suggestion.day);
    const mealLabel = `Meal ${Number(suggestion.mealIndex) + 1}`;

    const notif = this.notificationRepo.create({
      type: NotificationType.FORM_SUBMISSION, // fits your enum
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
}
