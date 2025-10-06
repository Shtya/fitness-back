import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { MealPlan, MealPlanDay, MealPlanFood, MealPlanAssignment, Food, DayOfWeek, MealType } from 'entities/global.entity';

@Injectable()
export class MealPlansService {
  constructor(
    @InjectRepository(MealPlan) public readonly repo: Repository<MealPlan>,
    @InjectRepository(MealPlanDay) public readonly dayRepo: Repository<MealPlanDay>,
    @InjectRepository(MealPlanFood) public readonly foodRepo: Repository<MealPlanFood>,
    @InjectRepository(MealPlanAssignment) public readonly assignRepo: Repository<MealPlanAssignment>,
    @InjectRepository(Food) public readonly foodBaseRepo: Repository<Food>,
    private readonly dataSource: DataSource,
  ) {}

  async list(q: any) {
    const page = Math.max(1, parseInt(q?.page ?? '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(q?.limit ?? '12', 10)));
    const search = q?.search || '';

    const qb = this.repo.createQueryBuilder('mp');

    if (search) {
      qb.andWhere('mp.name ILIKE :s', { s: `%${search}%` });
    }

    qb.orderBy('mp.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      total_records: total,
      current_page: page,
      per_page: limit,
      records: rows,
    };
  }

  async getOneDeep(id: string) {
    const plan = await this.repo.findOne({
      where: { id },
      relations: ['days', 'days.foods', 'days.foods.food', 'assignments'],
    });
    console.log(id, plan);
    if (!plan) throw new NotFoundException('Meal plan not found');
    return plan;
  }

  async create(dto: any) {
    return this.dataSource.transaction(async manager => {
      const planRepo = manager.getRepository(MealPlan);
      const dayRepo = manager.getRepository(MealPlanDay);
      const foodRepo = manager.getRepository(MealPlanFood);

      const plan = await planRepo.save(
        planRepo.create({
          name: dto.name,
          desc: dto.desc,
        }),
      );

      if (dto.days && Array.isArray(dto.days)) {
        for (const dayData of dto.days) {
          const day = await dayRepo.save(
            dayRepo.create({
              mealPlan: plan,
              day: dayData.day,
              name: dayData.name,
            }),
          );

          // Add foods to day
          if (dayData.foods && Array.isArray(dayData.foods)) {
            for (const foodData of dayData.foods) {
              await foodRepo.save(
                foodRepo.create({
                  day: day,
                  food: { id: foodData.foodId },
                  quantity: foodData.quantity,
                  mealType: foodData.mealType,
                  orderIndex: foodData.orderIndex || 0,
                }),
              );
            }
          }
        }
      }

      return plan
    });
  }

	async stats(q) {
  const totals = await this.repo.createQueryBuilder('mp')
    .leftJoin('mp.days', 'd')
    .leftJoin('mp.assignments', 'a')
    .select([
      'COUNT(DISTINCT mp.id)::int AS total',
      'COUNT(DISTINCT d.id)::int AS total_days',
      'COUNT(DISTINCT a.id)::int AS total_assignments',
      `SUM(CASE WHEN mp.is_active = true THEN 1 ELSE 0 END)::int AS active_plans`
    ])
    .getRawOne();

  return {
    totals: {
      total: totals?.total ?? 0,
      activePlans: totals?.active_plans ?? 0,
      totalDays: totals?.total_days ?? 0,
      totalAssignments: totals?.total_assignments ?? 0
    }
  };
}


  async update(id: string, dto: any) {
    return this.dataSource.transaction(async manager => {
      const plan = await manager.findOne(MealPlan, { where: { id } });
      if (!plan) throw new NotFoundException('Meal plan not found');

      // Update basic info
      if (dto.name !== undefined) plan.name = dto.name;
      if (dto.desc !== undefined) (plan as any).desc = dto.desc;
      if (dto.isActive !== undefined) plan.isActive = dto.isActive;

      await manager.save(MealPlan, plan);

      // Replace content if provided
      if (dto.days) {
        // Remove existing days (cascade removes foods)
        const oldDays = await manager.find(MealPlanDay, { where: { mealPlan: { id: plan.id } } });
        if (oldDays.length) await manager.remove(MealPlanDay, oldDays);

        // Recreate days
        for (const dayData of dto.days) {
          const day = await manager.save(
            MealPlanDay,
            manager.create(MealPlanDay, {
              mealPlan: plan,
              day: dayData.day,
              name: dayData.name,
            }),
          );

          // Add foods
          if (dayData.foods && Array.isArray(dayData.foods)) {
            for (const foodData of dayData.foods) {
              await manager.save(
                MealPlanFood,
                manager.create(MealPlanFood, {
                  day: day,
                  food: { id: foodData.foodId },
                  quantity: foodData.quantity,
                  mealType: foodData.mealType,
                  orderIndex: foodData.orderIndex || 0,
                }),
              );
            }
          }
        }
      }

      return this.getOneDeep(plan.id);
    });
  }

  async remove(id: string) {
    const plan = await this.repo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Meal plan not found');
    await this.repo.remove(plan);
    return { message: 'Meal plan deleted' };
  }

  async assignToUser(planId: string, userId: string) {
    const plan = await this.repo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Meal plan not found');

    const userRepo = this.dataSource.getRepository('User');
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Check if already assigned
    const existing = await this.assignRepo.findOne({
      where: { mealPlan: { id: planId }, athlete: { id: userId } },
    });

    if (existing) {
      existing.isActive = true;
      await this.assignRepo.save(existing);
    } else {
      const assignment = this.assignRepo.create({
        mealPlan: plan,
        athlete: { id: userId } as any,
        isActive: true,
      });
      await this.assignRepo.save(assignment);
    }

    return { message: 'Meal plan assigned successfully' };
  }

  async bulkAssign(planId: string, dto: { athleteIds: string[] }) {
    if (!Array.isArray(dto.athleteIds) || dto.athleteIds.length === 0) {
      throw new BadRequestException('athleteIds[] required');
    }

    const plan = await this.repo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Meal plan not found');

    const uniqueIds = [...new Set(dto.athleteIds)];

    return this.dataSource.transaction(async manager => {
      const assignRepo = manager.getRepository(MealPlanAssignment);

      for (const athleteId of uniqueIds) {
        const existing = await assignRepo.findOne({
          where: { mealPlan: { id: planId }, athlete: { id: athleteId } },
        });

        if (existing) {
          existing.isActive = true;
          await assignRepo.save(existing);
        } else {
          const assignment = assignRepo.create({
            mealPlan: plan,
            athlete: { id: athleteId } as any,
            isActive: true,
          });
          await assignRepo.save(assignment);
        }
      }

      return { message: `Meal plan assigned to ${uniqueIds.length} users` };
    });
  }

  async getActivePlan(userId: string) {
    const assignment = await this.assignRepo.findOne({
      where: { athlete: { id: userId }, isActive: true },
      relations: ['mealPlan', 'mealPlan.days', 'mealPlan.days.foods', 'mealPlan.days.foods.food'],
    });

    if (!assignment) {
      return { status: 'none', error: 'No active meal plan' };
    }

    return assignment.mealPlan;
  }

  async listAssignees(planId: string) {
    return this.assignRepo.find({
      where: { mealPlan: { id: planId } },
      relations: ['athlete'],
    });
  }
}
