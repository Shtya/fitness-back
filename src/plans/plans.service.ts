// src/plans/plans.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { WorkoutPlan, DayOfWeek, WeeklyProgram, buildProgramFromSeed, ProgramDay } from 'entities/global.entity';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(WorkoutPlan) private readonly planRepo: Repository<WorkoutPlan>,
    private readonly ds: DataSource,
  ) {}

  async createFromSeed(opts: {
    name: string;
    userId: string;
    coachId?: string | null;
    active?: boolean;
    weekly: Partial<
      Record<
        DayOfWeek,
        {
          id: string;
          name: string;
          exercises: Array<{
            id: string;
            name: string;
            targetSets: number;
            targetReps: string;
            rest?: number | null;
            img?: string;
            video?: string;
            desc?: string;
            gallery?: string[];
          }>;
        }
      >
    >;
    metadata?: Record<string, any>;
  }) {
    const program = buildProgramFromSeed(opts.weekly);

    return this.ds.transaction(async trx => {
      if (opts.active) {
        await trx.getRepository(WorkoutPlan).update({ userId: opts.userId, isActive: true }, { isActive: false });
      }
      const plan = trx.getRepository(WorkoutPlan).create({
        name: opts.name,
        userId: opts.userId,
        coachId: opts.coachId ?? null,
        isActive: !!opts.active,
        metadata: opts.metadata ?? {},
        program,
      });
      return trx.getRepository(WorkoutPlan).save(plan);
    });
  }

  // plans.service.ts
  async reassign(planId: string, opts: { newUserId?: string; newCoachId?: string | null; setActiveForNewUser?: boolean }) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    return this.ds.transaction(async trx => {
      const repo = trx.getRepository(WorkoutPlan);

      // change coach if provided
      if (typeof opts.newCoachId !== 'undefined') {
        plan.coachId = opts.newCoachId; // may be null; FK will validate existence
      }

      // change user if provided
      if (opts.newUserId && opts.newUserId !== plan.userId) {
        const oldUserId = plan.userId;
        plan.userId = opts.newUserId;

        if (opts.setActiveForNewUser) {
          // deactivate existing active plan(s) for the NEW user, then mark this one active
          await repo.update({ userId: plan.userId, isActive: true }, { isActive: false });
          plan.isActive = true;
        } else {
          // safe default: do not auto-activate on the new user
          plan.isActive = false;
        }

        // (Optional) if you maintain users.activePlanId elsewhere, update it accordingly in your UsersService.
      }

      // save (may throw FK 23503 which your controller filter will shape)
      await repo.save(plan);
      return { success: true, planId: plan.id, userId: plan.userId, coachId: plan.coachId, isActive: plan.isActive };
    });
  }

  async getActive(userId: string) {
    const plan = await this.planRepo.findOne({ where: { userId, isActive: true } });
    if (!plan) throw new NotFoundException('No active plan');
    // ensure order
    plan.program.days?.forEach(d => d.exercises?.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)));
    return plan;
  }

  async setActive(planId: string, isActive: boolean) {
    const existing = await this.planRepo.findOne({ where: { id: planId } });
    if (!existing) throw new NotFoundException('Plan not found');

    return this.ds.transaction(async trx => {
      if (isActive) {
        await trx.getRepository(WorkoutPlan).update({ userId: existing.userId, isActive: true }, { isActive: false });
      }
      await trx.getRepository(WorkoutPlan).update({ id: planId }, { isActive });
      return { success: true };
    });
  }

  // Example JSONB patch: update an exercise media by ids (no relations)
  async updateExerciseMedia(
    planId: string,
    dayId: string,
    exerciseId: string,
    patch: {
      img?: string | null;
      video?: string | null;
      desc?: string | null;
    },
  ) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const d = plan.program.days.find(x => x.id === dayId);
    if (!d) throw new NotFoundException('Day not found');

    const ex = d.exercises.find(x => x.id === exerciseId);
    if (!ex) throw new NotFoundException('Exercise not found');

    ex.img = patch.img ?? ex.img ?? null;
    ex.video = patch.video ?? ex.video ?? null;
    ex.desc = patch.desc ?? ex.desc ?? null;

    return this.planRepo.save(plan);
  }

  async reorderDayExercises(planId: string, dayId: string, orderedExerciseIds: string[]) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const d = plan.program.days.find(x => x.id === dayId);
    if (!d) throw new NotFoundException('Day not found');

    const map = new Map(d.exercises.map(e => [e.id, e]));
    d.exercises = orderedExerciseIds.map((id, idx) => {
      const e = map.get(id);
      if (!e) throw new NotFoundException(`Exercise ${id} missing`);
      return { ...e, sort: idx };
    });

    return this.planRepo.save(plan);
  }

  // make this SYNC (remove async)
  private normalizeDay(d: any) {
    return {
      id: d.id,
      dayOfWeek: d.dayOfWeek,
      name: d.name,
      exercises: (d.exercises ?? []).map((e: any, i: number) => ({
        id: e.id,
        name: e.name,
        targetSets: e.targetSets ?? 3,
        targetReps: e.targetReps,
        restSeconds: Number.isFinite(e.rest as any) ? (e.rest as number) : null,
        img: e.img ?? null,
        video: e.video ?? null,
        desc: e.desc ?? null,
        gallery: e.gallery ?? [],
        sort: i,
      })),
    };
  }

  // robust upsertDays
  async upsertDays(planId: string, dto: any) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const incomingDays = Array.isArray(dto?.days) ? dto.days : [];
    if (!incomingDays.length) {
      throw new BadRequestException('days array is required and cannot be empty');
    }

    // validate duplicates in payload
    const idsInPayload = new Set<string>();
    for (const d of incomingDays) {
      if (!d?.id) throw new BadRequestException('Each day must have an id');
      if (idsInPayload.has(d.id)) {
        throw new BadRequestException(`Duplicate day id in payload: ${d.id}`);
      }
      idsInPayload.add(d.id);
    }

    // current days map
    const existingDays = Array.isArray(plan.program?.days) ? plan.program.days : [];
    const map = new Map<string, any>(existingDays.map(d => [d.id, d]));

    // apply incoming
    for (const incoming of incomingDays) {
      if (map.has(incoming.id) && !dto?.replaceIfExists) {
        throw new BadRequestException(`Day already exists: ${incoming.id}`);
      }
      map.set(incoming.id, this.normalizeDay(incoming)); // now NOT async
    }

    // stable order
    const order = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
    const nextDays: any[] = [];
    for (const key of order) {
      const d = map.get(key);
      if (d) nextDays.push(d);
    }
    for (const [k, v] of map.entries()) {
      if (!order.includes(k)) nextDays.push(v); // append any extras
    }

    // IMPORTANT: reassign whole JSONB object so TypeORM marks it dirty
    plan.program = { ...(plan.program ?? {}), days: nextDays };

    return this.planRepo.save(plan);
  }

  async deleteDay(planId: string, dayId: string) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const before = plan.program.days.length;
    plan.program.days = plan.program.days.filter(d => d.id !== dayId);
    if (plan.program.days.length === before) {
      throw new NotFoundException('Day not found');
    }
    return this.planRepo.save(plan);
  }
}
