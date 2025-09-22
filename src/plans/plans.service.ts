import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Plan, PlanDay, PlanExercise, PlanAssignment, User } from 'entities/global.entity';
import { CRUD } from 'common/crud.service';
import { ImportPlanDto } from './plans.dto';
import { DayOfWeek } from 'entities/global.entity';

const DAY_ALIASES: Record<string, string> = {
  mon: 'monday',
  monday: 'monday',
  tue: 'tuesday',
  tuesday: 'tuesday',
  wed: 'wednesday',
  wednesday: 'wednesday',
  thu: 'thursday',
  thursday: 'thursday',
  fri: 'friday',
  friday: 'friday',
  sat: 'saturday',
  saturday: 'saturday',
  sun: 'sunday',
  sunday: 'sunday',
};
const normalizeDay = (v: string) => {
  const key = String(v || '').toLowerCase();
  const out = DAY_ALIASES[key];
  if (!out) throw new BadRequestException(`Invalid dayOfWeek: ${v}`);
  return out;
};

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
    coachId: plan.coach?.id || null,
    isActive: plan.isActive,
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
    @InjectRepository(PlanExercise) private readonly exRepo: Repository<PlanExercise>,
    @InjectRepository(PlanAssignment) private readonly assignRepo: Repository<PlanAssignment>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
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
      } as any);
      const savedPlan:any = await planRepo.save(plan);

      // create days + exercises
      for (let i = 0; i < program.days.length; i += 1) {
        const d = program.days[i];
        const dayEntity = dayRepo.create({
          plan: savedPlan,
          name: d.name || d.id || 'Workout',
          day: normalizeDayEnum(d.dayOfWeek || d.id),
          orderIndex: i,
        } as any);
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
          } as any);
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

    // const active = await this.plans.findOne({
    //   where: { athlete: { id: userId }, isActive: true },
    //   relations: ['athlete', 'coach', 'days', 'days.exercises'],
    //   order: { days: { orderIndex: 'ASC' } },
    // });

    // if (!active) return { status: 'none' };

    // return {
    //   status: 'active',
    //   plan: planToFrontendShape(active, active.days),
    // };
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
        meals: program.meals ?? [],
        instructions: program.instructions ?? [],
      });

      if (coachId) {
        const coach = await manager.findOne(User, { where: { id: coachId } });
        if (!coach) throw new BadRequestException('coachId not found');
        (plan as any).coach = coach;
      }

      const savedPlan = await manager.save(Plan, plan);

      // Days
      for (const d of program.days) {
        const dayEntity = manager.create(PlanDay, {
          plan: savedPlan,
          name: d.name || d.dayOfWeek,
          day: normalizeDay(d.dayOfWeek),
          orderIndex: Number(d.orderIndex ?? 0),
        } as any);
        const savedDay = await manager.save(PlanDay, dayEntity);

        const exItems: any[] = Array.isArray(d.exercises) ? d.exercises : [];
        for (const item of exItems) {
          const orderIndex = Number(item.order ?? item.orderIndex ?? 0);

          // 1) From library reference
          if (item.exerciseId) {
            const lib = await manager.findOne(PlanExercise, { where: { id: item.exerciseId } });
            if (!lib) throw new BadRequestException(`exerciseId not found: ${item.exerciseId}`);

            const copy = manager.create(PlanExercise, {
              day: savedDay,
              orderIndex,
              // copy relevant fields
              name: lib.name,
              targetReps: lib.targetReps,
              img: lib.img,
              video: lib.video,
              desc: lib.desc ?? null,
              primaryMuscles: lib.primaryMuscles ?? [],
              secondaryMuscles: lib.secondaryMuscles ?? [],
              equipment: lib.equipment ?? null,
              targetSets: lib.targetSets ?? 3,
              restSeconds: lib.restSeconds ?? 90,
              alternatives: lib.alternatives ?? [],
              status: lib.status,
            });
            await manager.save(PlanExercise, copy);
            continue;
          }

          // 2) Inline payload
          if (!item.name) throw new BadRequestException('exercise requires name or exerciseId');
          const inline = manager.create(PlanExercise, {
            day: savedDay,
            orderIndex,
            name: item.name,
            targetReps: String(item.targetReps ?? '10'),
            img: item.img ?? null,
            video: item.video ?? null,
            desc: item.desc ?? null,
            primaryMuscles: item.primaryMuscles ?? [],
            secondaryMuscles: item.secondaryMuscles ?? [],
            equipment: item.equipment ?? null,
            targetSets: Number(item.targetSets ?? 3),
            restSeconds: Number(item.restSeconds ?? 90),
            alternatives: item.alternatives ?? [],
            status: item.status ?? 'Active',
          });
          await manager.save(PlanExercise, inline);
        }
      }

      return this.getOneDeep(savedPlan.id, manager);
    });
  }

  /* -------------------------------- List (CRUD) ------------------------------- */
  async list(q: any) {
    // keep it light; no heavy relations on list
    return CRUD.findAll<Plan>(
      this.planRepo,
      'plan',
      q.search,
      q.page,
      q.limit,
      q.sortBy,
      q.sortOrder,
      [], // relations
      ['name', 'notes'], // searchFields
      {}, // filters
    );
  }

  /* ------------------------------ Get one (deep) ------------------------------ */
  async getOneDeep(id: string, mgr?: any) {
    const repo = mgr ? mgr.getRepository(Plan) : this.planRepo;
    const plan = await repo.findOne({
      where: { id },
      relations: ['coach', 'days', 'days.exercises', 'assignments', 'assignments.athlete'],
      order: {
        days: { orderIndex: 'ASC' },
        // @ts-ignore
        'days.exercises': { orderIndex: 'ASC' },
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
      if (dto.notes !== undefined) plan.notes = dto.notes;
      if (dto.isActive !== undefined) plan.isActive = !!dto.isActive;
      if (dto.meals !== undefined) (plan as any).meals = dto.meals;
      if (dto.instructions !== undefined) (plan as any).instructions = dto.instructions;

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
        // remove existing days (cascade removes day.exercises)
        const oldDays = await manager.find(PlanDay, { where: { plan: { id: plan.id } } });
        if (oldDays.length) await manager.remove(PlanDay, oldDays);

        // recreate using the same logic as create
        await this.createPlanWithContent({ ...dto, name: plan.name, program: dto.program });
        // ^ returns a fresh plan; but inside this tx we just need to finish
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

        const existing = await manager.findOne(PlanAssignment, { where: { plan: { id: planId }, athlete: { id: athleteId } } });

        if (existing) {
          existing.isActive = isActive;
          existing.startDate = dto.startDate ?? existing.startDate ?? null;
          existing.endDate = dto.endDate ?? existing.endDate ?? null;
          await manager.save(PlanAssignment, existing);
        } else {
          const assign = manager.create(PlanAssignment, {
            plan,
            athlete,
            isActive,
            startDate: dto.startDate ?? null,
            endDate: dto.endDate ?? null,
          });
          await manager.save(PlanAssignment, assign);
        }
      }

      return this.listAssignees(planId, manager);
    });
  }

  async listAssignees(planId: string, mgr?: any) {
    const repo = mgr ? mgr.getRepository(PlanAssignment) : this.assignRepo;
    return repo.find({ where: { plan: { id: planId } }, relations: ['athlete'] });
  }

  async updateAssignment(assignmentId: string, dto: any) {
    const a = await this.assignRepo.findOne({ where: { id: assignmentId }, relations: ['athlete'] });
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
    if (dto.startDate !== undefined) a.startDate = dto.startDate ?? null;
    if (dto.endDate !== undefined) a.endDate = dto.endDate ?? null;

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
