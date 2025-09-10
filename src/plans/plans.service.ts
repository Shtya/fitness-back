import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';

import { User, Plan, PlanDay, PlanExercise, DayOfWeek } from 'entities/global.entity';
import { CreatePlanDto, ImportPlanDto, AcceptPlanDto } from './plans.dto';

// map 'saturday' -> enum
function normalizeDayEnum(day?: string): DayOfWeek {
  const k = String(day || '')
    .trim()
    .toUpperCase();
  if (k.startsWith('SAT')) return DayOfWeek.SATURDAY;
  if (k.startsWith('SUN')) return DayOfWeek.SUNDAY;
  if (k.startsWith('MON')) return DayOfWeek.MONDAY;
  if (k.startsWith('TUE')) return DayOfWeek.TUESDAY;
  if (k.startsWith('WED')) return DayOfWeek.WEDNESDAY;
  if (k.startsWith('THU')) return DayOfWeek.THURSDAY;
  return DayOfWeek.MONDAY;
}

// map DB → front end shape (weeklyProgram-like)
function planToFrontendShape(plan: Plan, eagerDays: PlanDay[]) {
  const days = (eagerDays || [])
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(d => ({
      id: String(d.day || '').toLowerCase(), // 'saturday'
      dayOfWeek: String(d.day || '').toLowerCase(),
      name: d.name,
      exercises: (d.exercises || [])
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((e, idx) => ({
          id: e.id || `ex${idx + 1}`,
          name: e.name,
          targetSets: 0, // not stored; FE doesn’t require here
          targetReps: e.targetReps, // stored
          img: e.img || null,
          video: e.video || null,
        })),
    }));

  return {
    id: plan.id,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    deleted_at: plan.deleted_at || null,
    name: plan.name,
    userId: plan.athlete?.id,
    coachId: plan.coach?.id || null,
    isActive: plan.isActive,
    metadata: {},
    program: { days },
  };
}

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(PlanDay) private readonly days: Repository<PlanDay>,
    @InjectRepository(PlanExercise) private readonly exs: Repository<PlanExercise>,
    private readonly ds: DataSource,
  ) {}

  /** Accept a plan (activate it for user, deactivate others) */
  async acceptPlan(planId: string, userId: string) {
    if (!planId || !userId) return { ok: false, error: 'planId and userId are required' };

    return this.ds.transaction(async manager => {
      const planRepo = manager.getRepository(Plan);
      const userRepo = manager.getRepository(User);

      const plan = await planRepo.findOne({
        where: { id: planId },
        relations: ['athlete'],
      });
      if (!plan) return { ok: false, error: 'Plan not found' };
      if (!plan.athlete || plan.athlete.id !== userId) {
        return { ok: false, error: 'Plan does not belong to this user' };
      }

      // deactivate all other active plans for this user
      await planRepo.createQueryBuilder().update(Plan).set({ isActive: false }).where('athleteId = :userId', { userId }).execute();

      // activate selected
      plan.isActive = true;
      await planRepo.save(plan);

      // set user's activePlanId
      await userRepo.createQueryBuilder().update(User).set({ activePlanId: plan.id }).where('id = :userId', { userId }).execute();

      return { ok: true, planId: plan.id };
    });
  }

  /** Import your weeklyProgram JSON (or compact) and make it active for the user */
  async importAndActivate(body: ImportPlanDto) {
    const payload: any = body || {};
    const userId = payload.userId || payload?.athlete?.id || payload?.user_id || payload?.user;

    const coachId = payload.coachId || payload?.coach?.id || null;
    const planName = payload.name || 'Program';
    const program = payload.program || payload?.plan?.program || payload?.programAlt;

    if (!userId) return { ok: false, error: 'userId is required' };
    if (!program || !Array.isArray(program.days)) {
      return { ok: false, error: 'program.days array is required' };
    }

    return this.ds.transaction(async manager => {
      const userRepo = manager.getRepository(User);
      const planRepo = manager.getRepository(Plan);
      const dayRepo = manager.getRepository(PlanDay);
      const exRepo = manager.getRepository(PlanExercise);

      const athlete = await userRepo.findOne({ where: { id: userId } });
      if (!athlete) return { ok: false, error: 'Athlete not found' };

      let coach = null;
      if (coachId) coach = await userRepo.findOne({ where: { id: coachId } });

      // deactivate any existing active plan
      await planRepo.createQueryBuilder().update(Plan).set({ isActive: false }).where('athleteId = :userId', { userId }).execute();

      // create plan
      const plan = planRepo.create({
        name: planName,
        isActive: true,
        startDate: null,
        endDate: null,
        athlete,
        coach: coach || null,
      });
      const savedPlan = await planRepo.save(plan);

      // create days + exercises
      for (let i = 0; i < program.days.length; i += 1) {
        const d = program.days[i];
        const dayEntity = dayRepo.create({
          plan: savedPlan,
          name: d.name || d.id || 'Workout',
          day: normalizeDayEnum(d.dayOfWeek || d.id),
          orderIndex: i,
        });
        const savedDay = await dayRepo.save(dayEntity);

        const exercises = Array.isArray(d.exercises) ? d.exercises : [];
        for (let j = 0; j < exercises.length; j += 1) {
          const e = exercises[j];
          const exEntity = exRepo.create({
            day: savedDay,
            name: e.name,
            targetReps: String(e.targetReps || '10'),
            img: e.img || null,
            video: e.video || null,
            orderIndex: j,
          });
          await exRepo.save(exEntity);
        }
      }

      // set user's activePlanId
      athlete.activePlanId = savedPlan.id;
      await userRepo.save(athlete);

      // return full plan in FE shape
      const full = await planRepo.findOne({
        where: { id: savedPlan.id },
        relations: ['athlete', 'coach', 'days', 'days.exercises'],
        order: { days: { orderIndex: 'ASC' } },
      });

      return { ok: true, planId: full!.id, plan: planToFrontendShape(full!, full!.days) };
    });
  }

  /** Return active plan (frontend shape). If none, {status:'none'} */
  async getActivePlan(userId: string) {
    if (!userId) return { status: 'none', error: 'userId is required' };

    const active = await this.plans.findOne({
      where: { athlete: { id: userId }, isActive: true },
      relations: ['athlete', 'coach', 'days', 'days.exercises'],
      order: { days: { orderIndex: 'ASC' } },
    });

    if (!active) return { status: 'none' };

    return {
      status: 'active',
      plan: planToFrontendShape(active, active.days),
    };
  }
}
