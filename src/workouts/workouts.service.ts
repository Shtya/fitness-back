// src/workouts/workouts.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkoutPlan, WorkoutDay, WorkoutExercise, User, PersonalRecord } from 'entities/global.entity';
import { buildPlanFromSeed } from 'entities/global.entity';
import { SeedPlanDto, UpdateExerciseDto, ActivatePlanDto } from './workouts.dto';
import { CoachingService } from 'src/conaching/conaching.service';

@Injectable()
export class WorkoutsService {
  constructor(
    @InjectRepository(WorkoutPlan) private plans: Repository<WorkoutPlan>,
    @InjectRepository(WorkoutDay) private days: Repository<WorkoutDay>,
    @InjectRepository(WorkoutExercise) private exRepo: Repository<WorkoutExercise>,
    @InjectRepository(User) private users: Repository<User>,
    private coaching: CoachingService,
  ) {}

  async getActivePlanForUser(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user?.activePlanId) return null;
    return this.plans.findOne({ where: { id: user.activePlanId }, relations: ['days', 'days.exercises'] });
    // (eager=true في الكيانات هيجيب برضه)
  }

  async getPlanByUserIdForCoach(coachId: string, clientId: string) {
    // يسمح لو coach يشوف/يعدل فقط لو مربوط مع العميل
    const assigned = await this.coaching.coachAssignedToClient(coachId, clientId);
    if (!assigned) throw new ForbiddenException('Not assigned to this client');
    return this.plans.find({
      where: { userId: clientId },
      order: { createdAt: 'DESC' as any },
    });
  }

  async seedPlan(dto: SeedPlanDto, requesterId: string) {
    // إن كان requester مدرب لازم يكون هو نفس coachId أو أدمن
    if (dto.coachId && dto.coachId !== requesterId) {
      throw new ForbiddenException('Coach mismatch');
    }
    const plan = buildPlanFromSeed({
      planName: dto.planName,
      userId: dto.userId,
      coachId: dto.coachId ?? null,
      weekly: dto.weekly,
      active: !!dto.active,
    });
    const saved = await this.plans.save(plan);
    if (dto.active) {
      await this.users.update({ id: dto.userId }, { activePlanId: saved.id });
    }
    return this.plans.findOne({ where: { id: saved.id } });
  }

  async activatePlan(planId: string, dto: ActivatePlanDto, requesterId: string) {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    // لو المدرب بيحاول يفعل خطة لعميل، لازم يكون هو مالكها أو Assigned
    const canEdit = await this.canCoachEditPlan(requesterId, plan.id, plan.userId, plan.coachId);
    if (!canEdit) throw new ForbiddenException();
    await this.plans.update({ id: planId }, { isActive: dto.active });
    if (dto.active) {
      await this.users.update({ id: plan.userId }, { activePlanId: plan.id });
    } else {
      // لا نلغي activePlanId تلقائيًا عشان ممكن يكون عنده خطة تانية فعّالة
    }
    return this.plans.findOne({ where: { id: planId } });
  }

  async updateExercise(exerciseId: string, dto: UpdateExerciseDto, requesterId: string) {
    const ex = await this.exRepo.findOne({ where: { id: exerciseId }, relations: ['day', 'day.plan'] });
    if (!ex) throw new NotFoundException('Exercise not found');
    const plan = ex.day.plan;
    const canEdit = await this.canCoachEditPlan(requesterId, plan.id, plan.userId, plan.coachId);
    if (!canEdit) throw new ForbiddenException();
    await this.exRepo.update({ id: exerciseId }, dto as any);
    return this.exRepo.findOne({ where: { id: exerciseId } });
  }

  private async canCoachEditPlan(requesterId: string, planId: string, clientId: string, coachId: string | null) {
    // Admin?
    const user = await this.users.findOne({ where: { id: requesterId } });
    if (user?.role === 'admin') return true;
    // Coach مالك
    if (coachId && coachId === requesterId) return true;
    // Coach assigned للعميل
    const assigned = await this.coaching.coachAssignedToClient(requesterId, clientId);
    return assigned;
  }
}
