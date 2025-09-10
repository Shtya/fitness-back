// src/planning/planning.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DayOfWeek, Plan, PlanDay, PlanExercise, User } from 'entities/global.entity';

@Injectable()
export class PlanningService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(PlanDay) private readonly planDays: Repository<PlanDay>,
    @InjectRepository(PlanExercise) private readonly planExs: Repository<PlanExercise>,
  ) {}

  private dayId(d: DayOfWeek): string {
    return d.toLowerCase(); // 'monday' etc. — matches your FE tabs
  }

  async getActivePlanForUser(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const plan = await this.plans.findOne({
      where: { athlete: { id: userId }, isActive: true },
      relations: { days: { exercises: true }, coach: true, athlete: true },
      order: { days: { orderIndex: 'ASC' } },
    });

    // Return empty structure if no active plan — your FE will fall back to local seed
    if (!plan) {
      return { program: { days: [] } };
    }

    // Map to FE shape
    const days = (plan.days || []).map((d) => ({
      id: this.dayId(d.day),
      dayOfWeek: d.day,
      name: d.name,
      exercises: (d.exercises || [])
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((ex) => ({
          id: ex.id,
          name: ex.name,
          targetReps: ex.targetReps,
          // your entity has no targetSets/restSeconds; FE will default these
          targetSets: 2,
          restSeconds: null,
          img: ex.img ?? null,
          video: ex.video ?? null,
          gallery: [],
          sort: ex.orderIndex,
        })),
    }));

    return { program: { days } };
  }
}
