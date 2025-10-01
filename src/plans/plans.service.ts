// --- File: plans/plans.service.ts ---
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Plan, PlanDay, PlanExercises, PlanAssignment, User, DayOfWeek } from 'entities/global.entity';
import { CRUD } from 'common/crud.service';
import { ImportPlanDto, TemplateExerciseDto } from 'dto/plans.dto';

const DAY_ALIASES: Record<string, DayOfWeek> = {
  mon: DayOfWeek.MONDAY,
  monday: DayOfWeek.MONDAY,
  tue: DayOfWeek.TUESDAY,
  tuesday: DayOfWeek.TUESDAY,
  wed: DayOfWeek.WEDNESDAY,
  wednesday: DayOfWeek.WEDNESDAY,
  thu: DayOfWeek.THURSDAY,
  thursday: DayOfWeek.THURSDAY,
  fri: DayOfWeek.FRIDAY,
  friday: DayOfWeek.FRIDAY,
  sat: DayOfWeek.SATURDAY,
  saturday: DayOfWeek.SATURDAY,
  sun: DayOfWeek.SUNDAY,
  sunday: DayOfWeek.SUNDAY,
};
const dayEnum = (v?: string): DayOfWeek => {
  const key = String(v || 'monday').toLowerCase();
  const out = DAY_ALIASES[key];
  if (!out) throw new BadRequestException(`Invalid dayOfWeek: ${v}`);
  return out;
};

// map DB → FE "weeklyProgram-like" shape (only the minimal keys)
function planToFrontendShape(plan: Plan, eagerDays: PlanDay[]) {
  const days = (eagerDays || [])
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(d => ({
      id: String(d.day).toLowerCase(),
      dayOfWeek: String(d.day).toLowerCase(),
      name: d.name,
      exercises: (d.exercises || [])
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((e:any) => ({
          id: e.id,
          name: e.name,
          targetSets: e.targetSets ?? 0,
          targetReps: e.targetReps,
          rest: e.restSeconds ?? null,
          tempo: e.tempo ?? null,
          img: e.img || null,
          video: e.video || null,
        } )),
    }));

  return {
    id: plan.id,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    deleted_at: plan.deleted_at || null,
    name: plan.name,
    userId: (plan as any)?.athlete?.id ?? null,
    coachId: (plan as any)?.coach?.id ?? null,
    isActive: !!plan.isActive,
    metadata: {},
    program: { days },
  };
}

@Injectable()
export class PlanService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Plan) private readonly planRepo: Repository<Plan>,
    @InjectRepository(PlanDay) private readonly dayRepo: Repository<PlanDay>,
    @InjectRepository(PlanExercises) private readonly exRepo: Repository<PlanExercises>,
    @InjectRepository(PlanAssignment) private readonly assignRepo: Repository<PlanAssignment>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly ds: DataSource,
  ) {}

  /** Activate a plan for a user; ensures only one active at a time */
  async acceptPlan(planId: string, userId: string) {
    return this.ds.transaction(async manager => {
      const planRepo = manager.getRepository(Plan);
      const userRepo = manager.getRepository(User);

      const plan = await planRepo.findOne({
        where: { id: planId },
        relations: ['athlete'],
      });
      if (!plan) throw new NotFoundException('Plan not found');

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

  /** Helper: resolve a library exercise by primary or alternate IDs */
  private async resolveLibraryExercise(manager: any, item: TemplateExerciseDto): Promise<PlanExercises | null> {
    const tryIds: string[] = [];
    if (item.exerciseId) tryIds.push(item.exerciseId);
    if (item.altExerciseId) {
      if (Array.isArray(item.altExerciseId)) tryIds.push(...item.altExerciseId);
      else tryIds.push(item.altExerciseId);
    }
    for (const id of tryIds) {
      const lib = await manager.findOne(PlanExercises, { where: { id } });
      if (lib) return lib;
    }
    return null;
  }

  /** Import your weekly program and (optionally) activate for the userId */
  async importAndActivate(body: ImportPlanDto) {
    const payload = body || {};
    const userId = payload.userId || (payload as any)?.athlete?.id || (payload as any)?.user_id || (payload as any)?.user;

    const coachId = payload.coachId || (payload as any)?.coach?.id || null;
    const planName = payload.name || 'Program';
    const program = payload.program || (payload as any)?.plan?.program || (payload as any)?.programAlt;

    if (!program || !Array.isArray(program.days)) {
      throw new BadRequestException('program.days[] is required');
    }

    return this.ds.transaction(async manager => {
      const userRepo = manager.getRepository(User);
      const planRepo = manager.getRepository(Plan);
      const dayRepo = manager.getRepository(PlanDay);
      const exRepo = manager.getRepository(PlanExercises);

      let athlete: User | null = null;
      if (userId) {
        athlete = await userRepo.findOne({ where: { id: userId } });
        if (!athlete) throw new BadRequestException('Athlete not found');
        // deactivate any existing active plan
        await planRepo.createQueryBuilder().update(Plan).set({ isActive: false }).where('athleteId = :userId', { userId }).execute();
      }

      // create plan
      const plan = planRepo.create({
        name: planName,
        isActive: !!userId, // auto-activate if we have a user
        startDate: null,
        endDate: null,
        athlete: athlete || null,
        coach: coachId ? ({ id: coachId } as any) : null,
      } as any);
      const savedPlan: any = await planRepo.save(plan);

      // create days + exercises
      for (let i = 0; i < program.days.length; i++) {
        const d = program.days[i];
        const savedDay = await dayRepo.save(
          dayRepo.create({
            plan: savedPlan,
            name: d.name || d.id || 'Workout',
            day: dayEnum(d.dayOfWeek || d.id),
            orderIndex: Number(d.orderIndex ?? i),
          } as any),
        );

        const exercises: TemplateExerciseDto[] = Array.isArray(d.exercises) ? d.exercises : [];

        for (let j = 0; j < exercises.length; j++) {
          const e = exercises[j];

          // Try library first (exerciseId / altExerciseId)
          const lib:any = await this.resolveLibraryExercise(manager, e);

          if (lib) {
            const copy = exRepo.create({
              day: savedDay,
              orderIndex: Number(e.order ?? e.orderIndex ?? j),
              name: lib.name,
              targetReps: e.targetReps ?? lib.targetReps ?? '10',
              targetSets: e.targetSets !== undefined ? Number(e.targetSets) : (lib.targetSets ?? 3),
              restSeconds: e.rest !== undefined ? Number(e.rest) : (lib.restSeconds ?? 90),
              tempo: e.tempo ?? lib.tempo ?? null,
              img: e.img ?? lib.img ?? null,
              video: e.video ?? lib.video ?? null,
            } as any);
            await exRepo.save(copy);
            continue;
          }

          // Inline fallback
          if (!e.name) {
            throw new BadRequestException(`exercise requires name or exerciseId (day: ${d.name || d.id}, index: ${j})`);
          }

          const inline = exRepo.create({
            day: savedDay,
            orderIndex: Number(e.order ?? e.orderIndex ?? j),
            name: e.name,
            targetReps: String(e.targetReps ?? '10'),
            targetSets: Number(e.targetSets ?? 3),
            restSeconds: Number(e.rest ?? 90),
            tempo: e.tempo ?? null,
            img: e.img ?? null,
            video: e.video ?? null,
          } as any);
          await exRepo.save(inline);
        }
      }

      // Set user's active plan pointer
      if (athlete) {
        athlete.activePlanId = savedPlan.id;
        await userRepo.save(athlete);
      }

      // return full plan in FE shape
      const full = await planRepo.findOne({
        where: { id: savedPlan.id },
        relations: ['athlete', 'coach', 'days' ],
        order: { days: { orderIndex: 'ASC' } } as any,
      });

      return { ok: true, planId: full!.id, plan: planToFrontendShape(full!, full!.days) };
    });
  }

  /** Return active plan (frontend shape). If none, {status:'none'} */
  async getActivePlan(userId: string) {
    if (!userId) return { status: 'none', error: 'userId is required' };

    const active = await this.planRepo.findOne({
      where: { athlete: { id: userId }, isActive: true } as any,
      relations: ['athlete', 'coach', 'days' ],
      order: { days: { orderIndex: 'ASC' } } as any,
    });

    if (!active) return { status: 'none' };

    return {
      status: 'active',
      plan: planToFrontendShape(active, active.days),
    };
  }

  /* -------------------- Create plan + content (transaction) ------------------- */
  async createPlanWithContent(dto: any) {
    const { name, notes, isActive = true, coachId, program } = dto;
    if (!program?.days || !Array.isArray(program.days)) throw new BadRequestException('program.days[] required');

    return await this.dataSource.transaction(async manager => {
      const plan = manager.create(Plan, {
        name,
        notes: notes ?? null,
        isActive: !!isActive,
      });

      if (coachId) {
        const coach = await manager.findOne(User, { where: { id: coachId } });
        if (!coach) throw new BadRequestException('coachId not found');
        (plan as any).coach = coach;
      }

      const savedPlan = await manager.save(Plan, plan);

      // Days
      for (const [i, d] of program.days.entries()) {
        const dayEntity = manager.create(PlanDay, {
          plan: savedPlan,
          name: d.name || d.dayOfWeek,
          day: dayEnum(d.dayOfWeek || d.id),
          orderIndex: Number(d.orderIndex ?? i),
        } as any);
        const savedDay = await manager.save(PlanDay, dayEntity);

        const exItems: TemplateExerciseDto[] = Array.isArray(d.exercises) ? d.exercises : [];

        for (const [j, item] of exItems.entries()) {
          const orderIndex = Number(item.order ?? item.orderIndex ?? j);

          // Try library
          const lib:any = await this.resolveLibraryExercise(manager, item);
          if (lib) {
            const copy = manager.create(PlanExercises, {
              day: savedDay,
              orderIndex,
              name: lib.name,
              targetReps: item.targetReps ?? lib.targetReps ?? '10',
              targetSets: item.targetSets !== undefined ? Number(item.targetSets) : (lib.targetSets ?? 3),
              restSeconds: item.rest !== undefined ? Number(item.rest) : (lib.restSeconds ?? 90),
              tempo: item.tempo ?? lib.tempo ?? null,
              img: item.img ?? lib.img ?? null,
              video: item.video ?? lib.video ?? null,
            });
            await manager.save(PlanExercises, copy);
            continue;
          }

          // Inline payload
          if (!item.name) throw new BadRequestException('exercise requires name or exerciseId');

          const inline = manager.create(PlanExercises, {
            day: savedDay,
            orderIndex,
            name: item.name,
            targetReps: String(item.targetReps ?? '10'),
            targetSets: Number(item.targetSets ?? 3),
            restSeconds: Number(item.rest ?? 90),
            tempo: item.tempo ?? null,
            img: item.img ?? null,
            video: item.video ?? null,
          });
          await manager.save(PlanExercises, inline);
        }
      }

      return this.getOneDeep(savedPlan.id, manager);
    });
  }

  /* -------------------------------- List (CRUD) ------------------------------- */
  async list(q: any) {
    return CRUD.findAll<Plan>(this.planRepo, 'plan', q.search, q.page, q.limit, q.sortBy, q.sortOrder, [], ['name', 'notes'], {});
  }

  /* ------------------------------ Get one (deep) ------------------------------ */
  async getOneDeep(id: string, mgr?: any) {
    const repo = mgr ? mgr.getRepository(Plan) : this.planRepo;
    const plan = await repo.findOne({
      where: { id },
      relations: ['coach', 'days' , 'assignments', 'assignments.athlete'],
      order: {
        days: { orderIndex: 'ASC' },
        //  'days.exercises': { orderIndex: 'ASC' },
      } as any,
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  /* -------------------- Update (replace content if provided) ------------------- */
  async updatePlanAndContent(id: string, dto: any) {
    return await this.dataSource.transaction(async manager => {
      const plan = await manager.findOne(Plan, { where: { id } });
      if (!plan) throw new NotFoundException('Plan not found');

      // shallow updates
      if (dto.name !== undefined) plan.name = dto.name;
      if (dto.notes !== undefined) (plan as any).notes = dto.notes ?? null;
      if (dto.isActive !== undefined) plan.isActive = !!dto.isActive;
      if (dto.startDate !== undefined) (plan as any).startDate = dto.startDate ?? null;
      if (dto.endDate !== undefined) (plan as any).endDate = dto.endDate ?? null;

      // coach
      if (dto.coachId !== undefined) {
        if (dto.coachId === null) (plan as any).coach = null;
        else {
          const coach = await manager.findOne(User, { where: { id: dto.coachId } });
          if (!coach) throw new BadRequestException('coachId not found');
          (plan as any).coach = coach;
        }
      }

      await manager.save(Plan, plan);

      // replace content?
      if (dto.program?.days) {
        // remove existing days (cascade removes exercises)
        const oldDays = await manager.find(PlanDay, { where: { plan: { id: plan.id } } });
        if (oldDays.length) await manager.remove(PlanDay, oldDays);

        // recreate
        await this.createPlanWithContent({ ...dto, name: plan.name, program: dto.program });
      }

      return this.getOneDeep(plan.id, manager);
    });
  }

  /* --------------------------------- Remove ---------------------------------- */
  async remove(id: string) {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    await this.planRepo.remove(plan);
    return { message: 'Plan deleted' };
  }

  /* --------------------------- Assignments (bulk) ----------------------------- */
  async bulkAssign(planId: string, dto: { athleteIds: string[]; startDate?: string; endDate?: string; isActive?: boolean }) {
    if (!Array.isArray(dto.athleteIds) || dto.athleteIds.length === 0) {
      throw new BadRequestException('athleteIds[] required');
    }
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const uniqueIds = [...new Set(dto.athleteIds)];
    const isActive = dto.isActive !== false;

    return await this.dataSource.transaction(async manager => {
      for (const athleteId of uniqueIds) {
        const athlete = await manager.findOne(User, { where: { id: athleteId } });
        if (!athlete) throw new BadRequestException(`athlete not found: ${athleteId}`);

        if (isActive) {
          // ensure single active per athlete
          await manager.createQueryBuilder().update(PlanAssignment).set({ isActive: false }).where('athleteId = :athleteId AND isActive = :active', { athleteId, active: true }).execute();
        }

        const existing = await manager.findOne(PlanAssignment, {
          where: { plan: { id: planId }, athlete: { id: athleteId } } as any,
        });

        if (existing) {
          existing.isActive = isActive;
          (existing as any).startDate = dto.startDate ?? (existing as any).startDate ?? null;
          (existing as any).endDate = dto.endDate ?? (existing as any).endDate ?? null;
          await manager.save(PlanAssignment, existing);
        } else {
          const assign = manager.create(PlanAssignment, {
            plan,
            athlete,
            isActive,
            startDate: dto.startDate ?? null,
            endDate: dto.endDate ?? null,
          } as any);
          await manager.save(PlanAssignment, assign);
        }
      }

      return this.listAssignees(planId, manager);
    });
  }

  async listAssignees(planId: string, mgr?: any) {
    const repo = mgr ? mgr.getRepository(PlanAssignment) : this.assignRepo;
    return repo.find({ where: { plan: { id: planId } } as any, relations: ['athlete'] });
  }

  async updateAssignment(assignmentId: string, dto: any) {
    const a = await this.assignRepo.findOne({
      where: { id: assignmentId },
      relations: ['athlete'],
    });
    if (!a) throw new NotFoundException('Assignment not found');

    if (dto.isActive !== undefined && dto.isActive === true) {
      // deactivate other actives for this athlete
      await this.assignRepo
        .createQueryBuilder()
        .update(PlanAssignment)
        .set({ isActive: false })
        .where('athleteId = :athleteId AND id <> :id', { athleteId: (a as any).athlete.id, id: assignmentId })
        .execute();
    }

    if (dto.isActive !== undefined) a.isActive = !!dto.isActive;
    if (dto.startDate !== undefined) (a as any).startDate = dto.startDate ?? null;
    if (dto.endDate !== undefined) (a as any).endDate = dto.endDate ?? null;

    await this.assignRepo.save(a);
    return a;
  }

  async deleteAssignment(assignmentId: string) {
    const a = await this.assignRepo.findOne({ where: { id: assignmentId } });
    if (!a) throw new NotFoundException('Assignment not found');
    await this.assignRepo.remove(a);
    return { message: 'Assignment deleted' };
  }
}
