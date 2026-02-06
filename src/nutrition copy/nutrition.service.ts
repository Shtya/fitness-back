// import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository, In, Between, Like, DataSource, IsNull } from 'typeorm';
// import { MealPlan, MealPlanDay, MealPlanFood, MealPlanAssignment, User, Meal, MealItem, Supplement, MealLog, MealLogItem, ExtraFood, SupplementLog, FoodSuggestion, NutritionStats as NutritionStatsEntity, DayOfWeek, UserRole, Notification as NotificationEntity, NotificationAudience, NotificationType } from '../../entities/global.entity';
// import { CreateMealPlanDto } from './dto/create-meal-plan.dto';
// import { LogMealDto } from './dto/log-meal.dto';
// import { CreateSuggestionDto } from './dto/suggestion.dto';
// import { NutritionStats as INutritionStats, MealPlanListResponse, ProgressData } from './interfaces/nutrition.interface';
// import { UpdateMealPlanDto } from './dto/update-meal-plan.dto';
// import { GymSettings } from '../../entities/settings.entity';

// /** ---------- i18n helpers ---------- */
// type Lang = 'ar' | 'en';
// const t = (lang: Lang | undefined, key: string) => {
//   const L = lang === 'ar' ? 'ar' : 'en';
//   const M: Record<string, { ar: string; en: string }> = {
//     plan_not_found: {
//       en: 'Meal plan not found',
//       ar: 'لم يتم العثور على خطة الوجبات',
//     },
//     user_not_found: {
//       en: 'User not found',
//       ar: 'المستخدم غير موجود',
//     },
//     forbidden_view: {
//       en: 'You are not allowed to view this meal plan',
//       ar: 'غير مسموح لك بعرض هذه الخطة',
//     },
//     forbidden_edit_global: {
//       en: 'Only super admin can modify or delete global plans',
//       ar: 'فقط السوبر أدمن يمكنه تعديل أو حذف الخطط العامة',
//     },
//     forbidden_edit_others: {
//       en: 'You can only modify or delete your own plans',
//       ar: 'يمكنك تعديل أو حذف خططك فقط',
//     },
//     forbidden_assign: {
//       en: 'You are not allowed to assign this plan',
//       ar: 'غير مسموح لك بإسناد هذه الخطة',
//     },
//     invalid_date: {
//       en: 'Invalid date. Use ISO date or YYYY-MM-DD.',
//       ar: 'تاريخ غير صالح. الرجاء استخدام صيغة ISO أو YYYY-MM-DD.',
//     },
//   };
//   return (M[key] || { ar: key, en: key })[L];
// };

// function isYMD(s: string) {
//   return /^\d{4}-\d{2}-\d{2}$/.test(s);
// }

// function dayBoundsUTC(dateInput: string | Date) {
//   const d = typeof dateInput === 'string' ? (isYMD(dateInput) ? new Date(dateInput + 'T00:00:00Z') : new Date(dateInput)) : new Date(dateInput);
//   if (isNaN(d.getTime())) throw new Error('Invalid date');
//   const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
//   const end = new Date(start);
//   end.setUTCDate(end.getUTCDate() + 1);
//   return { start, end };
// }

// @Injectable()
// export class NutritionService {
//   constructor(
//     @InjectRepository(MealPlan)
//     public mealPlanRepo: Repository<MealPlan>,
//     @InjectRepository(MealPlanDay)
//     private mealPlanDayRepo: Repository<MealPlanDay>,
//     @InjectRepository(MealPlanFood)
//     private mealPlanFoodRepo: Repository<MealPlanFood>,
//     @InjectRepository(MealPlanAssignment)
//     private assignmentRepo: Repository<MealPlanAssignment>,
//     @InjectRepository(User)
//     private userRepo: Repository<User>,
//     @InjectRepository(Meal)
//     private mealRepo: Repository<Meal>,
//     @InjectRepository(MealItem)
//     private mealItemRepo: Repository<MealItem>,
//     @InjectRepository(Supplement)
//     private supplementRepo: Repository<Supplement>,
//     @InjectRepository(MealLog)
//     private mealLogRepo: Repository<MealLog>,
//     @InjectRepository(MealLogItem)
//     private mealLogItemRepo: Repository<MealLogItem>,
//     @InjectRepository(ExtraFood)
//     private extraFoodRepo: Repository<ExtraFood>,
//     @InjectRepository(SupplementLog)
//     private supplementLogRepo: Repository<SupplementLog>,
//     @InjectRepository(FoodSuggestion)
//     private suggestionRepo: Repository<FoodSuggestion>,
//     @InjectRepository(NutritionStatsEntity)
//     private statsRepo: Repository<NutritionStatsEntity>,
//     @InjectRepository(NotificationEntity)
//     private notificationRepo: Repository<NotificationEntity>,
//     private readonly dataSource: DataSource,
//   ) {}

//   /** ===================== MEAL PLANS (MULTI-VENDOR) ===================== */

//   async createMealPlan(createDto: CreateMealPlanDto, user: any, lang?: Lang): Promise<MealPlan> {
//     const adminId = user.role === UserRole.COACH ? user?.adminId : user.id;

//     const mealPlan = this.mealPlanRepo.create({
//       name: createDto.name,
//       desc: createDto.description,
//       notes: createDto.notes,
//       coachId: null, // optional: لو محتاج تحتفظ بـ coachId = user.id لو هو مدرّب، سيبها
//       customizeDays: createDto.customizeDays || false,
//       adminId,
//     });

//     const savedPlan = await this.mealPlanRepo.save(mealPlan);

//     // Create 7 days
//     const days = Object.values(DayOfWeek).map(day =>
//       this.mealPlanDayRepo.create({
//         mealPlan: savedPlan,
//         day,
//         name: this.capitalizeDay(day),
//       }),
//     );
//     const savedDays = await this.mealPlanDayRepo.save(days);

//     // Populate meals/supplements
//     for (const day of savedDays) {
//       const dayOverride = createDto.dayOverrides?.[day.day as DayOfWeek];
//       const mealsToUse = dayOverride?.meals || createDto.baseMeals;
//       const supplementsToUse = dayOverride?.supplements || [];

//       // meals
//       for (let i = 0; i < mealsToUse.length; i++) {
//         const mealData = mealsToUse[i];
//         const meal = this.mealRepo.create({
//           day,
//           title: mealData.title,
//           time: mealData.time || null,
//           orderIndex: i,
//         });
//         const savedMeal = await this.mealRepo.save(meal);

//         // items
//         const mealItems = (mealData.items || []).map((item, itemIndex) =>
//           this.mealItemRepo.create({
//             meal: savedMeal,
//             name: item.name,
//             quantity: item.quantity ?? null,
//             calories: item.calories,
//             orderIndex: itemIndex,
//           }),
//         );
//         if (mealItems.length) await this.mealItemRepo.save(mealItems);

//         // meal-level supplements (لو كنت شايل timing من الفرونت، الداتا القديمة ممكن يكون فيها)
//         const mealSupps = (mealData.supplements || []).map((supp, si) =>
//           this.supplementRepo.create({
//             meal: savedMeal,
//             name: supp.name,
//             time: supp.time || null,
//             timing: (supp as any).timing ?? null,
//             bestWith: supp.bestWith || null,
//             orderIndex: si,
//           }),
//         );
//         if (mealSupps.length) await this.supplementRepo.save(mealSupps);
//       }

//       // day-level supplements (لو موجودة)
//       const daySupps = (supplementsToUse || []).map((supp, si) =>
//         this.supplementRepo.create({
//           day,
//           name: supp.name,
//           time: supp.time || null,
//           timing: (supp as any).timing ?? null,
//           bestWith: supp.bestWith || null,
//           orderIndex: si,
//         }),
//       );
//       if (daySupps.length) await this.supplementRepo.save(daySupps);
//     }

//     return this.mealPlanRepo.findOne({
//       where: { id: savedPlan.id },
//       relations: ['days', 'days.meals', 'days.meals.items', 'days.meals.supplements', 'days.supplements'],
//     });
//   }

//   async findAllMealPlans(params: { q?: string; sortBy?: string; sortOrder?: 'ASC' | 'DESC'; limit?: number; page?: number }, user: { id: string; role: UserRole }, _lang?: Lang): Promise<MealPlanListResponse> {
//     const { q, sortBy = 'created_at', sortOrder = 'DESC', limit = 12, page = 1 } = params;
//     const skip = (page - 1) * limit;

//     // multi-tenant: (adminId IS NULL) OR (adminId = current admin)
//     const where = [
//       { adminId: IsNull(), ...(q ? { name: Like(`%${q}%`) } : {}) },
//       { adminId: user.id, ...(q ? { name: Like(`%${q}%`) } : {}) },
//     ];

//     const [records, total] = await this.mealPlanRepo.findAndCount({
//       where,
//       relations: ['days', 'days.meals', 'days.meals.items', 'days.meals.supplements', 'days.supplements'],
//       order: { [sortBy]: sortOrder },
//       skip,
//       take: limit,
//     });

//     return { records, total, page, limit };
//   }

//   /** secure find by id with visibility */
//   async findMealPlanByIdSecure(id: string, user: { id: string; role: UserRole }, lang?: Lang): Promise<MealPlan> {
//     const plan = await this.mealPlanRepo.findOne({
//       where: { id },
//       relations: ['days', 'days.meals', 'days.meals.items', 'days.meals.supplements', 'days.supplements'],
//     });
//     if (!plan) throw new NotFoundException(t(lang, 'plan_not_found'));

//     // const canView = plan.adminId === null || plan.adminId === user.id || user.role === UserRole.SUPER_ADMIN;
//     // if (!canView) throw new ForbiddenException(t(lang, 'forbidden_view'));

//     return plan;
//   }

//   async updateMealPlan(id: string, updateDto: UpdateMealPlanDto, user: any, lang?: Lang): Promise<MealPlan> {
//     const plan = await this.mealPlanRepo.findOne({ where: { id } });
//     if (!plan) throw new NotFoundException(t(lang, 'plan_not_found'));
//     const adminId = user.role === UserRole.COACH ? user?.adminId : user.id;
//     plan.adminId = adminId;

//     if (updateDto.name !== undefined) plan.name = updateDto.name;
//     if (updateDto.description !== undefined) plan.desc = updateDto.description;
//     if (updateDto.notes !== undefined) plan.notes = updateDto.notes;
//     if (updateDto.customizeDays !== undefined) plan.customizeDays = updateDto.customizeDays;

//     await this.mealPlanRepo.save(plan);
//     return this.findMealPlanByIdSecure(id, user, lang);
//   }

//   async deleteMealPlan(id: string, user: { id: string; role: UserRole }, lang?: Lang): Promise<{ success: true }> {
//     const plan = await this.mealPlanRepo.findOne({ where: { id } });
//     if (!plan) throw new NotFoundException(t(lang, 'plan_not_found'));

//     await this.mealPlanRepo.softRemove(plan);
//     return { success: true };
//   }

//   async getPlanAssignmentsSecure(planId: string, user: { id: string; role: UserRole }, lang?: Lang): Promise<MealPlanAssignment[]> {
//     // ensure visibility
//     await this.findMealPlanByIdSecure(planId, user, lang);
//     return this.assignmentRepo.find({
//       where: { mealPlan: { id: planId } },
//       relations: ['athlete'],
//     });
//   }

//   async assignMealPlan(planId: string, userId: string, requester: { id: string; role: UserRole }, lang?: Lang) {
//     const plan = await this.findMealPlanByIdSecure(planId, requester, lang);

//     const user = await this.userRepo.findOne({ where: { id: userId } });
//     if (!user) throw new NotFoundException(t(lang, 'user_not_found'));

//     user.activeMealPlan = plan;
//     await this.userRepo.save(user);
//   }

//   /** ===================== CLIENT MEAL PLAN ===================== */

//   async getClientMealPlan(userId: string): Promise<MealPlan> {
//     const user = await this.userRepo.findOne({ where: { id: userId }, relations: ['activeMealPlan'] });
//     if (!user?.activeMealPlan) throw new NotFoundException('No active meal plan found');
//     return this.mealPlanRepo.findOne({
//       where: { id: user.activeMealPlan.id },
//       relations: ['days', 'days.meals', 'days.meals.items', 'days.meals.supplements', 'days.supplements'],
//     });
//   }

//   /** ===================== MEAL LOGGING ===================== */

//   async logMeal(userId: string, logDto: LogMealDto): Promise<MealLog> {
//     const eatenAt = new Date(logDto.eatenAt || new Date());
//     const startOfDay = new Date(eatenAt);
//     startOfDay.setHours(0, 0, 0, 0);
//     const endOfDay = new Date(startOfDay);
//     endOfDay.setDate(endOfDay.getDate() + 1);

//     return this.dataSource.transaction(async manager => {
//       const userRepo = manager.getRepository(User);
//       const mealLogRepo = manager.getRepository(MealLog);
//       const mealLogItemRepo = manager.getRepository(MealLogItem);
//       const extraFoodRepo = manager.getRepository(ExtraFood);
//       const supplementLogRepo = manager.getRepository(SupplementLog);

//       const user = await userRepo.findOne({ where: { id: userId } });
//       if (!user) throw new NotFoundException('User not found');

//       let existing = await mealLogRepo.findOne({
//         where: {
//           user: { id: userId },
//           planId: logDto.planId,
//           day: logDto.day,
//           mealIndex: logDto.mealIndex,
//           mealTitle: logDto.mealTitle,
//           eatenAt: Between(startOfDay, endOfDay),
//         },
//         relations: ['items', 'extraFoods', 'supplementsTaken'],
//       });

//       if (existing) {
//         existing.adherence = logDto.adherence ?? existing.adherence;
//         existing.eatenAt = eatenAt;
//         existing.notes = logDto.notes ?? existing.notes;
//         existing.notifyCoach = logDto.notifyCoach ?? existing.notifyCoach;
//         await mealLogRepo.save(existing);

//         const incomingItems = logDto.items || [];
//         for (const i of incomingItems) {
//           const found = existing.items.find(it => it.name === i.name);
//           if (found) {
//             found.taken = i.taken;
//             found.quantity = i.qty ?? found.quantity;
//             await mealLogItemRepo.save(found);
//           } else {
//             const newItem = mealLogItemRepo.create({
//               mealLog: existing,
//               name: i.name,
//               taken: i.taken,
//               quantity: i.qty ?? null,
//             });
//             await mealLogItemRepo.save(newItem);
//           }
//         }

//         await extraFoodRepo.delete({ mealLog: { id: existing.id } });
//         const extras = (logDto.extraFoods || []).map(e =>
//           extraFoodRepo.create({
//             mealLog: existing,
//             name: e.name,
//             quantity: e.quantity ?? null,
//             calories: e.calories ?? null,
//             protein: e.protein ?? null,
//             carbs: e.carbs ?? null,
//             fat: e.fat ?? null,
//           }),
//         );
//         if (extras.length) await extraFoodRepo.save(extras);

//         await supplementLogRepo.delete({ mealLog: { id: existing.id } });
//         const supps = (logDto.supplementsTaken || []).map(s =>
//           supplementLogRepo.create({
//             mealLog: existing,
//             name: s.name,
//             taken: s.taken,
//           }),
//         );
//         if (supps.length) await supplementLogRepo.save(supps);

//         await this.updateNutritionStats(userId);

//         return mealLogRepo.findOne({
//           where: { id: existing.id },
//           relations: ['items', 'extraFoods', 'supplementsTaken'],
//         });
//       }

//       const mealLog = mealLogRepo.create({
//         user,
//         planId: logDto.planId,
//         day: logDto.day,
//         dayName: this.capitalizeDay(logDto.day),
//         mealIndex: logDto.mealIndex,
//         mealTitle: logDto.mealTitle,
//         eatenAt,
//         adherence: logDto.adherence,
//         notes: logDto.notes,
//         notifyCoach: logDto.notifyCoach,
//       });
//       const savedLog = await mealLogRepo.save(mealLog);

//       const items = (logDto.items || []).map(i =>
//         mealLogItemRepo.create({
//           mealLog: savedLog,
//           name: i.name,
//           taken: i.taken,
//           quantity: i.qty ?? null,
//         }),
//       );
//       if (items.length) await mealLogItemRepo.save(items);

//       const extras = (logDto.extraFoods || []).map(e =>
//         extraFoodRepo.create({
//           mealLog: savedLog,
//           name: e.name,
//           quantity: e.quantity ?? null,
//           calories: e.calories ?? null,
//           protein: e.protein ?? null,
//           carbs: e.carbs ?? null,
//           fat: e.fat ?? null,
//         }),
//       );
//       if (extras.length) await extraFoodRepo.save(extras);

//       const supps = (logDto.supplementsTaken || []).map(s =>
//         supplementLogRepo.create({
//           mealLog: savedLog,
//           name: s.name,
//           taken: s.taken,
//         }),
//       );
//       if (supps.length) await supplementLogRepo.save(supps);

//       await this.updateNutritionStats(userId);

//       return mealLogRepo.findOne({
//         where: { id: savedLog.id },
//         relations: ['items', 'extraFoods', 'supplementsTaken'],
//       });
//     });
//   }

//   async getMealLogs(userId: string, days: any = 30, date?: string): Promise<MealLog[]> {
//     if (date) {
//       let start: Date, end: Date;
//       try {
//         ({ start, end } = dayBoundsUTC(date));
//       } catch {
//         throw new BadRequestException('Invalid date. Use ISO date or YYYY-MM-DD.');
//       }
//       return this.mealLogRepo.find({
//         where: { user: { id: userId }, eatenAt: Between(start, end) },
//         order: { eatenAt: 'DESC' },
//         relations: ['items', 'extraFoods', 'supplementsTaken'],
//       });
//     }

//     const daysNumber = Number(days);
//     const validDays = isNaN(daysNumber) || daysNumber <= 0 ? 30 : daysNumber;

//     const now = new Date();
//     const cutoff = new Date(now);
//     cutoff.setUTCDate(cutoff.getUTCDate() - validDays);

//     return this.mealLogRepo.find({
//       where: { user: { id: userId }, eatenAt: Between(cutoff, now) },
//       order: { eatenAt: 'DESC' },
//       relations: ['items', 'extraFoods', 'supplementsTaken'],
//     });
//   }

//   /** ===================== SUGGESTIONS / STATS / AI ===================== */

//   async createSuggestion(userId: string, suggestionDto: CreateSuggestionDto): Promise<FoodSuggestion> {
//     const user = await this.userRepo.findOne({ where: { id: userId } });
//     if (!user) throw new NotFoundException('User not found');

//     const suggestion = this.suggestionRepo.create({
//       user,
//       day: suggestionDto.day,
//       mealIndex: suggestionDto.mealIndex,
//       message: suggestionDto.message,
//       wantsAlternative: suggestionDto.wantsAlternative,
//     });
//     const saved = await this.suggestionRepo.save(suggestion);
//     await this.createAdminNotificationForSuggestion(user, saved);
//     return saved;
//   }

//   async getUserSuggestions(userId: string, options: { status?: string; page?: number; limit?: number } = {}): Promise<{ suggestions: FoodSuggestion[]; total: number }> {
//     const { status, page = 1, limit = 20 } = options;
//     const skip = ((page || 1) - 1) * (limit || 1);
//     const where: any = { user: { id: userId } };
//     if (status && status !== 'all') where.status = status;
//     const [suggestions, total] = await this.suggestionRepo.findAndCount({
//       where,
//       order: { created_at: 'DESC' },
//       skip,
//       take: limit || 1,
//       relations: ['reviewedBy'],
//     });
//     return { suggestions, total };
//   }

//   async getAllSuggestions(coachId: string, options: { status?: string; clientId?: string; page?: number; limit?: number } = {}): Promise<{ suggestions: FoodSuggestion[]; total: number }> {
//     const { status, clientId, page = 1, limit = 20 } = options;
//     const skip = (page - 1) * limit;

//     const coachClients = await this.userRepo.find({
//       where: { coach: { id: coachId } },
//       select: ['id'],
//     });
//     const clientIds = coachClients.map(c => c.id);

//     const where: any = { user: { id: In(clientIds) } };
//     if (status && status !== 'all') where.status = status;
//     if (clientId) where.user = { id: clientId };

//     const [suggestions, total] = await this.suggestionRepo.findAndCount({
//       where,
//       order: { created_at: 'DESC' },
//       skip,
//       take: limit,
//       relations: ['user', 'reviewedBy'],
//     });

//     return { suggestions, total };
//   }

//   async getNutritionStats(user?: { id: string; role: UserRole }) {
//     const globalPlansCount = await this.mealPlanRepo.count({
//       where: { isActive: true, adminId: IsNull() },
//     });

//     let myPlansCount = 0;
//     if (user?.id) {
//       myPlansCount = await this.mealPlanRepo.count({
//         where: { isActive: true, adminId: user.id },
//       });
//     }

//     return {
//       totals: {
//         globalPlansCount, // الخطط العامة
//         myPlansCount, // خطط هذا المستخدم فقط
//       },
//     };
//   }

//   async getClientProgress(userId: string, rangeDays: number = 30): Promise<ProgressData> {
//     return this.generateProgressData(userId, rangeDays);
//   }

//   private async getAiKeyForAdmin(adminId: string): Promise<string> {
//     const repo = this.dataSource.getRepository(GymSettings);
//     const settings = await repo.findOne({
//       where: { adminId },
//     });

//     const aiKey = settings?.aiSecretKey || process.env.aiSecretKey;

//     if (!aiKey) {
//       throw new BadRequestException('AI key is not configured for this account.');
//     }

//     return aiKey;
//   }

//   async generateMealPlanWithAI(prompt: string, adminId: any): Promise<any> {
//     const aiKey = await this.getAiKeyForAdmin(adminId);
//     try {
//       const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           Authorization: `Bearer ${aiKey}`,
//         },
//         body: JSON.stringify({
//           model: 'openai/gpt-3.5-turbo',
//           messages: [{ role: 'user', content: prompt }],
//         }),
//       });
//       const data = await response.json();
//       return data.choices?.[0]?.message?.content ?? null;
//     } catch {
//       throw new BadRequestException('AI generation failed');
//     }
//   }

//   /** ===================== PRIVATE HELPERS ===================== */

//   private capitalizeDay(day: string): string {
//     return day.charAt(0).toUpperCase() + day.slice(1);
//   }

//   private async updateNutritionStats(_userId: string): Promise<void> {
//     return;
//   }

//   private async generateProgressData(_userId: string, _rangeDays: number): Promise<ProgressData> {
//     return {
//       weightSeries: [],
//       adherence: [],
//       macros: [],
//       mealCompliance: [],
//       extras: [],
//       supplements: [],
//       target: { calories: 2300, protein: 180, carbs: 220, fat: 70 },
//     };
//   }

//   private async createAdminNotificationForSuggestion(user: User, suggestion: FoodSuggestion) {
//     const dayLabel = this.capitalizeDay(suggestion.day);
//     const mealLabel = `Meal ${Number(suggestion.mealIndex) + 1}`;
//     const notif = this.notificationRepo.create({
//       type: NotificationType.FORM_SUBMISSION,
//       title: `New meal suggestion from ${user.name}`,
//       message: `${user.name} submitted a suggestion for ${dayLabel} • ${mealLabel}:\n${suggestion.message}`,
//       data: {
//         userId: user.id,
//         suggestionId: suggestion.id,
//         day: suggestion.day,
//         mealIndex: suggestion.mealIndex,
//         wantsAlternative: suggestion.wantsAlternative,
//         createdAt: suggestion.created_at,
//       },
//       user: null,
//       audience: NotificationAudience.ADMIN,
//       isRead: false,
//     });
//     await this.notificationRepo.save(notif);
//   }
// }
