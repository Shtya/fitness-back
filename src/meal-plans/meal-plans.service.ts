// src/nutrition/nutrition.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MealPlan, MealPlanDay, MealPlanFood, MealPlanAssignment, MealIntakeLog, DayOfWeek, MealType, User } from 'entities/global.entity';

@Injectable()
export class NutritionService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MealPlan) private readonly planRepo: Repository<MealPlan>,
    @InjectRepository(MealPlanDay) private readonly dayRepo: Repository<MealPlanDay>,
    @InjectRepository(MealPlanFood) private readonly planFoodRepo: Repository<MealPlanFood>,
    @InjectRepository(MealPlanAssignment) private readonly assignRepo: Repository<MealPlanAssignment>,
    @InjectRepository(MealIntakeLog) private readonly logRepo: Repository<MealIntakeLog>,
  ) {}

  async listPlans(q: any) {
    const page = Math.max(1, parseInt(q?.page ?? '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(q?.limit ?? '12', 10)));
    const search = (q?.search || '').trim();

    const qb = this.planRepo.createQueryBuilder('mp');
    if (search) qb.andWhere('mp.name ILIKE :s', { s: `%${search}%` });

    qb.orderBy('mp.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return { total_records: total, current_page: page, per_page: limit, records: rows };
  }

  async stats(_q: any) {
    // safer column reference (works with default or snake-case naming strategy)
    const r = await this.planRepo.createQueryBuilder('mp').leftJoin('mp.days', 'd').leftJoin('mp.assignments', 'a').select('COUNT(DISTINCT mp.id)', 'total').addSelect('COUNT(DISTINCT d.id)', 'total_days').addSelect('COUNT(DISTINCT a.id)', 'total_assignments').addSelect('SUM(CASE WHEN mp.isActive = true THEN 1 ELSE 0 END)', 'active_plans').getRawOne();

    return {
      totals: {
        total: Number(r?.total ?? 0),
        activePlans: Number(r?.active_plans ?? 0),
        totalDays: Number(r?.total_days ?? 0),
        totalAssignments: Number(r?.total_assignments ?? 0),
      },
    };
  }

  async getPlanDeep(id: string) {
    const plan = await this.planRepo.findOne({
      where: { id },
      relations: ['days', 'days.foods', 'assignments'],
    });
    if (!plan) throw new NotFoundException('Meal plan not found');
    return plan;
  }

  async createPlan(dto: any) {
    return this.dataSource.transaction(async manager => {
      const plan = await manager.save(
        MealPlan,
        manager.create(MealPlan, {
          name: dto.name,
          desc: dto.desc ?? null,
        }),
      );

      for (const d of dto.days ?? []) {
        const day = await manager.save(
          MealPlanDay,
          manager.create(MealPlanDay, {
            mealPlan: plan,
            day: d.day as DayOfWeek,
            name: d.name,
          }),
        );

        for (const f of d.foods ?? []) {
          await manager.save(
            MealPlanFood,
            manager.create(MealPlanFood, {
              day,
              name: f.name,
              category: f.category ?? null,
              calories: f.calories ?? 0,
              protein: f.protein ?? 0,
              carbs: f.carbs ?? 0,
              fat: f.fat ?? 0,
              unit: f.unit ?? 'g',
              quantity: f.quantity ?? 0,
              mealType: f.mealType ?? MealType.BREAKFAST,
              orderIndex: f.orderIndex ?? 0,
            }),
          );
        }
      }

      // return created plan with tree
      return manager.findOne(MealPlan, {
        where: { id: plan.id },
        relations: ['days', 'days.foods'],
      });
    });
  }

  async updatePlan(id: string, dto: any) {
    return this.dataSource.transaction(async manager => {
      const plan = await manager.findOne(MealPlan, { where: { id } });
      if (!plan) throw new NotFoundException('Meal plan not found');

      if (dto.name !== undefined) plan.name = dto.name;
      if (dto.desc !== undefined) (plan as any).desc = dto.desc;
      if (dto.isActive !== undefined) plan.isActive = dto.isActive;
      await manager.save(MealPlan, plan);

      if (dto.days) {
        const oldDays = await manager.find(MealPlanDay, { where: { mealPlan: { id: plan.id } } });
        if (oldDays.length) await manager.remove(MealPlanDay, oldDays);

        for (const d of dto.days ?? []) {
          const day = await manager.save(
            MealPlanDay,
            manager.create(MealPlanDay, {
              mealPlan: plan,
              day: d.day as DayOfWeek,
              name: d.name,
            }),
          );
          for (const f of d.foods ?? []) {
            await manager.save(
              MealPlanFood,
              manager.create(MealPlanFood, {
                day,
                name: f.name,
                category: f.category ?? null,
                calories: f.calories ?? 0,
                protein: f.protein ?? 0,
                carbs: f.carbs ?? 0,
                fat: f.fat ?? 0,
                unit: f.unit ?? 'g',
                quantity: f.quantity ?? 0,
                mealType: f.mealType ?? MealType.BREAKFAST,
                orderIndex: f.orderIndex ?? 0,
              }),
            );
          }
        }
      }

      return this.getPlanDeep(plan.id);
    });
  }

  async removePlan(id: string) {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Meal plan not found');
    await this.planRepo.remove(plan);
    return { message: 'Meal plan deleted' };
  }

 
  async assignToUser(planId: string, userId: string ) {
    return this.dataSource.transaction(async manager => {
      const plan = await manager.findOne(MealPlan, { where: { id: planId } });
      if (!plan) throw new NotFoundException('Meal plan not found');

      const user = await manager.findOne(User, { where: { id: userId } as any });
      if (!user) throw new NotFoundException('User not found');

      // 1) deactivate previous active assignments for this user
      await manager.createQueryBuilder().update(MealPlanAssignment).set({ isActive: false }).where('athleteId = :userId AND isActive = true', { userId }).execute();

      // 2) upsert this assignment as active
      let assignment = await manager.findOne(MealPlanAssignment, {
        where: { mealPlan: { id: planId }, athlete: { id: userId } },
      });

      if (assignment) {
        assignment.isActive = true;
         assignment = await manager.save(MealPlanAssignment, assignment);
      } else {
        assignment = await manager.save(
          MealPlanAssignment,
          manager.create(MealPlanAssignment, {
            mealPlan: { id: planId } as any,
            athlete: { id: userId } as any,
            isActive: true,
           }),
        );
      }

      // 3) set user's activeMealPlanId
      user.activeMealPlanId = planId;
      await manager.save(User, user);

      return {
        message: 'Meal plan assigned successfully',
        user: { id: user.id, name: user.name, activeMealPlanId: user.activeMealPlanId },
        plan: { id: plan.id, name: plan.name },
        assignment: { id: assignment.id, startDate: assignment.startDate, endDate: assignment.endDate, isActive: assignment.isActive },
      };
    });
  }

  async bulkAssign(planId: string, dto: { athleteIds: string[] }) {
    if (!Array.isArray(dto.athleteIds) || dto.athleteIds.length === 0) {
      throw new BadRequestException('athleteIds[] required');
    }
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Meal plan not found');

    const uniqueIds = [...new Set(dto.athleteIds)];

    await this.dataSource.transaction(async manager => {
      for (const userId of uniqueIds) {
        // reuse single-assign logic per user
        await this.assignToUser(planId, userId);
      }
    });

    return { message: `Meal plan assigned to ${uniqueIds.length} users` };
  }

  async getActivePlan(userId: string) {
    const assignment = await this.assignRepo.findOne({
      where: { athlete: { id: userId }, isActive: true },
      relations: ['mealPlan', 'mealPlan.days', 'mealPlan.days.foods'],
    });
    if (!assignment) return { status: 'none', error: 'No active meal plan' };
    return {
      assignmentId: assignment.id,
      mealPlan: assignment.mealPlan,
    };
  }

  // ---------- MEAL LOGS ----------
  async upsertLog(dto: { userId: string; date: string; day: DayOfWeek; mealType: MealType; itemName: string; quantity?: number; taken?: boolean; notes?: string | null; suggestedAlternative?: string | null; planFoodId?: string | null; assignmentId?: string | null }) {
    if (!dto.itemName?.trim()) throw new BadRequestException('itemName required');

    let mealType = dto.mealType;
    let itemName = dto.itemName;

    if (dto.planFoodId) {
      const pf = await this.planFoodRepo.findOne({ where: { id: dto.planFoodId } });
      if (pf) {
        itemName = pf.name;
        mealType = mealType ?? pf.mealType;
      }
    }

    const existing = await this.logRepo.findOne({
      where: { userId: dto.userId, date: dto.date, mealType, itemName },
    });

    if (existing) {
      existing.quantity = dto.quantity ?? existing.quantity;
      existing.taken = dto.taken ?? existing.taken;
      existing.takenAt = dto.taken ? new Date() : existing.takenAt;
      existing.notes = dto.notes ?? existing.notes;
      existing.suggestedAlternative = dto.suggestedAlternative ?? existing.suggestedAlternative;
      existing.planFoodId = dto.planFoodId ?? existing.planFoodId;
      existing.assignmentId = dto.assignmentId ?? existing.assignmentId;
      existing.day = dto.day ?? existing.day;
      return this.logRepo.save(existing);
    }

    const created = this.logRepo.create({
      userId: dto.userId,
      assignmentId: dto.assignmentId ?? null,
      planFoodId: dto.planFoodId ?? null,
      date: dto.date,
      day: dto.day,
      mealType,
      itemName,
      quantity: dto.quantity ?? 0,
      taken: !!dto.taken,
      takenAt: dto.taken ? new Date() : null,
      notes: dto.notes ?? null,
      suggestedAlternative: dto.suggestedAlternative ?? null,
    });
    return this.logRepo.save(created);
  }

  async summary(userId: string, date: string) {
    const row = await this.logRepo
      .createQueryBuilder('l')
      .leftJoin('l.planFood', 'pf')
      .where('l.userId = :userId AND l.date = :date AND l.taken = true', { userId, date })
      .select([
        // if plan-linked: scale macros using logged quantity vs planned quantity
        'COALESCE(SUM(pf.calories * l.quantity / NULLIF(pf.quantity,0)), 0) AS kcal',
        'COALESCE(SUM(pf.protein  * l.quantity / NULLIF(pf.quantity,0)), 0) AS protein',
        'COALESCE(SUM(pf.carbs    * l.quantity / NULLIF(pf.quantity,0)), 0) AS carbs',
        'COALESCE(SUM(pf.fat      * l.quantity / NULLIF(pf.quantity,0)), 0) AS fat',
      ])
      .getRawOne();

    return {
      date,
      totals: {
        calories: Number(row?.kcal ?? 0),
        protein: Number(row?.protein ?? 0),
        carbs: Number(row?.carbs ?? 0),
        fat: Number(row?.fat ?? 0),
      },
    };
  }

  async listLogs(userId: string, q: { date?: string; from?: string; to?: string }) {
    const qb = this.logRepo.createQueryBuilder('l').where('l.userId = :userId', { userId }).leftJoinAndSelect('l.planFood', 'pf');

    if (q.date) qb.andWhere('l.date = :date', { date: q.date });
    if (q.from && q.to) qb.andWhere('l.date BETWEEN :from AND :to', { from: q.from, to: q.to });

    qb.orderBy('l.date', 'DESC').addOrderBy('l.mealType', 'ASC');
    return qb.getMany();
  }
}
