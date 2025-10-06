// --- File: plans/plans.service.ts ---
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull, In } from 'typeorm';
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

function planToFrontendShape(plan: Plan, eagerDays: PlanDay[]) {
  const days = (eagerDays || []).map(d => ({
    id: String(d.day).toLowerCase(),
    dayOfWeek: String(d.day).toLowerCase(),
    name: d.name,
    exercises: (d.exercises || []).map((e: any) => ({
      id: e.id,
      name: e.name,
      targetSets: e.targetSets ?? 0,
      targetReps: e.targetReps,
      rest: e.restSeconds ?? null,
      tempo: e.tempo ?? null,
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
    userId: (plan as any)?.athlete?.id ?? null,
    isActive: !!plan.isActive,
    metadata: {},
    program: { days },
  };
}
type BulkAssignDto = {
  athleteIds: string[];
  startDate?: string;
  endDate?: string;
  isActive?: boolean;
  confirm?: 'yes' | 'no';
  removeOthers?: boolean; // 👈 NEW
};

function parseMaybeJson<T = any>(v: any): T {
  if (v == null) return v as T;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return {} as any;
    try {
      return JSON.parse(s) as T;
    } catch {
      return v as T;
    }
  }
  return v as T;
}

type ExerciseInput = {
  exerciseId?: string; // library id (plan_exercises row with day = null)
  name?: string; // inline name or override when copying from library
  targetReps?: string;
  targetSets?: number;
  rest?: number;
  tempo?: string | null;
  img?: string | null;
  video?: string | null;
  order?: number;
  orderIndex?: number;
};
const WEEK_ORDER: Array<'saturday' | 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday'> = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

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

  private async resolveLibraryExercise(manager: any, id: string) {
    return manager.findOne(PlanExercises, { where: { id } });
  }

  private async resolveLibraryByName(manager: any, name: string): Promise<PlanExercises | null> {
    // نبحث في "المكتبة": صفوف plan_exercises التي dayId فيها NULL
    return manager.getRepository(PlanExercises).createQueryBuilder('x').where('LOWER(x.name) = LOWER(:name)', { name }).getOne();
  }

  async importAndActivate(body: any /* ImportPlanDto | string | any */) {
    // accept object, stringified JSON, or {payload}/{json}
    const raw: any = parseMaybeJson<any>(body);
    const payload = parseMaybeJson<any>(raw?.payload ?? raw);
    const payloadAlt = parseMaybeJson<any>(raw?.json);
    const root = payload && typeof payload === 'object' && Object.keys(payload).length ? payload : payloadAlt && typeof payloadAlt === 'object' ? payloadAlt : {};

    const userId = root.userId || root?.athlete?.id || root?.user_id || root?.user || null;
    const planName = (root.name || 'Program').toString().trim();

    const program = parseMaybeJson<any>(root.program ?? root?.plan?.program ?? root?.programAlt);
    if (!program || !Array.isArray(program.days)) {
      throw new BadRequestException('program.days[] is required');
    }

    return this.ds.transaction(async manager => {
      const userRepo = manager.getRepository(User);
      const planRepo = manager.getRepository(Plan);
      const dayRepo = manager.getRepository(PlanDay);
      const exRepo = manager.getRepository(PlanExercises);

      if (userId) {
        const exists = await userRepo.findOne({ where: { id: userId } });
        if (!exists) throw new BadRequestException('Athlete not found');
      }

      // Create plan
      const savedPlan: any = await planRepo.save(planRepo.create({ name: planName, isActive: true } as any));

      // Stats
      let createdCount = 0;
      let linkedFromLibraryCount = 0;
      let mergedExistingCount = 0;

      // We’ll build the FE response program from the payload, preserving duplicates.
      const responseDays: Array<{
        id: string;
        dayOfWeek: string;
        name: string;
        exercises: Array<{
          id: string;
          name: string;
          targetSets: number;
          targetReps: string;
          rest: number | null;
          tempo: string | null;
          img: string | null;
          video: string | null;
        }>;
      }> = [];

      for (let i = 0; i < program.days.length; i++) {
        const dRaw = parseMaybeJson<any>(program.days[i]);
        const dow = String(dRaw.dayOfWeek || dRaw.id || 'monday').toLowerCase();

        const savedDay: any = await dayRepo.save(
          dayRepo.create({
            plan: savedPlan,
            name: dRaw.name || dRaw.id || 'Workout',
            day: dayEnum(dRaw.dayOfWeek || dRaw.id),
          } as any),
        );

        // cache EXISTING rows for THIS day by lower(name) → used for merge/reuse
        const existingDayExs = await exRepo.find({ where: { day: { id: savedDay.id } } as any });
        const dayByName = new Map<string, PlanExercises>((existingDayExs || []).map(x => [x.name.toLowerCase(), x]));

        // We'll also keep a local cache of resolved rows per name for this day,
        // so duplicates in the same payload reuse the same row instance+id.
        const resolvedForThisDay = new Map<string, PlanExercises>();

        const exArrRaw = parseMaybeJson<any>(dRaw.exercises);
        const exercises: any[] = Array.isArray(exArrRaw) ? exArrRaw : [];

        // Build the response day object (we’ll push per incoming exercise)
        const respDay = {
          id: dow,
          dayOfWeek: dow,
          name: savedDay.name,
          exercises: [] as Array<{
            id: string;
            name: string;
            targetSets: number;
            targetReps: string;
            rest: number | null;
            tempo: string | null;
            img: string | null;
            video: string | null;
          }>,
        };

        for (let j = 0; j < exercises.length; j++) {
          const eRaw = parseMaybeJson<any>(exercises[j]);

          const finalName = String(eRaw?.name ?? '').trim();
          if (!finalName) {
            throw new BadRequestException(`exercise requires 'name' (day: ${dRaw.name || dRaw.id}, index: ${j})`);
          }
          const key = finalName.toLowerCase();

          // If we already resolved this name earlier in the same day (duplicate in payload),
          // just reuse the SAME row and push it to response.
          if (resolvedForThisDay.has(key)) {
            const same = resolvedForThisDay.get(key)!;
            respDay.exercises.push({
              id: same.id,
              name: same.name,
              targetSets: same.targetSets,
              targetReps: same.targetReps,
              rest: same.rest ?? null,
              tempo: same.tempo ?? null,
              img: same.img ?? null,
              video: same.video ?? null,
            });
            // keep orderIndex of the original row; if you want to update, uncomment below
            // same.orderIndex = Number(eRaw.order ?? eRaw.orderIndex ?? same.orderIndex);
            // await exRepo.save(same);
            continue;
          }

          // 1) If same-name already exists in THIS day → MERGE (don’t create)
          let row: any = dayByName.get(key);
          if (row) {
            if (eRaw.targetReps != null) row.targetReps = String(eRaw.targetReps);
            if (eRaw.targetSets != null) row.targetSets = Number(eRaw.targetSets);
            if (eRaw.rest != null) row.rest = Number(eRaw.rest);
            if (eRaw.tempo != null) row.tempo = eRaw.tempo;
            if (eRaw.img != null) row.img = eRaw.img;
            if (eRaw.video != null) row.video = eRaw.video;
            if (eRaw.order != null || eRaw.orderIndex != null) {
              row.orderIndex = Number(eRaw.order ?? eRaw.orderIndex);
            } else {
              // ensure some stable default order if not provided
              row.orderIndex = row.orderIndex || j + 1;
            }
            await exRepo.save(row);
            mergedExistingCount++;
          } else {
            // 2) Else, try to LINK an existing "library" row (dayId IS NULL)
            const lib = await this.resolveLibraryByName(manager, finalName);
            if (lib) {
              lib.day = savedDay; // link same id to this day (no new row)
              if (eRaw.targetReps != null) lib.targetReps = String(eRaw.targetReps);
              if (eRaw.targetSets != null) lib.targetSets = Number(eRaw.targetSets);
              if (eRaw.rest != null) lib.rest = Number(eRaw.rest);
              if (eRaw.tempo != null) lib.tempo = eRaw.tempo;
              if (eRaw.img != null) lib.img = eRaw.img;
              if (eRaw.video != null) lib.video = eRaw.video;
              lib.orderIndex = Number(eRaw.order ?? eRaw.orderIndex ?? j + 1);
              await exRepo.save(lib);
              row = lib;
              linkedFromLibraryCount++;
              dayByName.set(key, row);
            } else {
              // 3) Else, CREATE a brand-new day exercise
              row = exRepo.create({
                day: savedDay,
                name: finalName,
                targetReps: String(eRaw.targetReps ?? '10'),
                targetSets: Number(eRaw.targetSets ?? 3),
                rest: Number(eRaw.rest ?? 90),
                tempo: eRaw.tempo ?? null,
                img: eRaw.img ?? null,
                video: eRaw.video ?? null,
                orderIndex: Number(eRaw.order ?? eRaw.orderIndex ?? j + 1),
              } as any);
              await exRepo.save(row);
              createdCount++;
              dayByName.set(key, row);
            }
          }

          // cache resolved row for this day so next duplicates reuse same id
          resolvedForThisDay.set(key, row);

          // push to response as sent (preserving duplicates)
          respDay.exercises.push({
            id: row.id,
            name: row.name,
            targetSets: row.targetSets,
            targetReps: row.targetReps,
            rest: row.rest ?? null,
            tempo: row.tempo ?? null,
            img: row.img ?? null,
            video: row.video ?? null,
          });
        }

        responseDays.push(respDay);
      }

      // Build FE plan directly from responseDays (preserves duplicates in payload)
      const fePlan = {
        id: savedPlan.id,
        created_at: savedPlan.created_at,
        updated_at: savedPlan.updated_at,
        deleted_at: savedPlan.deleted_at ?? null,
        name: savedPlan.name,
        userId: null,
        isActive: !!savedPlan.isActive,
        metadata: {},
        program: { days: responseDays },
      };

      const message = `Imported successfully. ${createdCount} created, ` + `${linkedFromLibraryCount} linked from library, ${mergedExistingCount} merged in day.`;

      return {
        ok: true,
        message,
        stats: {
          created: createdCount,
          linkedFromLibrary: linkedFromLibraryCount,
          mergedInDay: mergedExistingCount,
        },
        planId: savedPlan.id,
        plan: fePlan,
      };
    });
  }

  weekIndex(d?: string) {
    const i = WEEK_ORDER.indexOf(String(d ?? '').toLowerCase() as any);
    return i === -1 ? 99 : i;
  }

  coalesce<T>(...vals: T[]): T | undefined {
    for (const v of vals) if (v !== undefined && v !== null) return v;
    return undefined;
  }

  planToFrontendShape(plan: any) {
    const daysRaw = Array.isArray(plan?.days) ? plan.days : [];

    const days = daysRaw
      .map((d: any) => {
        const dayOfWeek = String(this.coalesce(d.dayOfWeek, d.day, d.id, '')).toLowerCase();
        const exRaw = Array.isArray(d.exercises) ? d.exercises : [];

        const exercises = exRaw
          .map((e: any) => {
            // support join model (e.exercise) OR stored fields on (e)
            const base = e.exercise ?? e;
            const orderIndex = this.coalesce(e.order, e.orderIndex, base.order, base.orderIndex, 0);

            return {
              id: this.coalesce(base.id, e.id),
              name: this.coalesce(base.name, e.name),
              targetSets: this.coalesce(e.targetSets, base.targetSets, 0),
              targetReps: this.coalesce(e.targetReps, base.targetReps, ''),
              rest: this.coalesce(e.rest, base.rest, 0),
              tempo: this.coalesce(e.tempo, base.tempo, ''),
              img: this.coalesce(base.img, e.img, null),
              video: this.coalesce(base.video, e.video, null),
              orderIndex, // harmless if your UI ignores it
            };
          })
          .sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
          .map(({ orderIndex, ...rest }) => rest); // strip orderIndex if you don’t want it

        return {
          id: this.coalesce(d.id, dayOfWeek),
          dayOfWeek,
          name: this.coalesce(d.name, dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)),
          exercises,
          // you can keep created_at/updated_at on the day if your UI needs them
        };
      })
      // prefer explicit orderIndex on day, else week order, else fallback by name
      .sort((a: any, b: any) => {
        const ai = this.coalesce(a.orderIndex, this.weekIndex(a.dayOfWeek), 99) as number;
        const bi = this.coalesce(b.orderIndex, this.weekIndex(b.dayOfWeek), 99) as number;
        return ai - bi;
      })
      .map(({ orderIndex, ...rest }) => rest);

    return {
      id: this.coalesce(plan.id),
      created_at: this.coalesce(plan.created_at, plan.createdAt, null),
      updated_at: this.coalesce(plan.updated_at, plan.updatedAt, null),
      deleted_at: this.coalesce(plan.deleted_at, plan.deletedAt, null),
      name: this.coalesce(plan.name, 'Untitled Plan'),
      isActive: !!this.coalesce(plan.isActive, true),
      program: { days },
    };
  }

  async getActivePlan(userId: string) {
    try {
      if (!userId) return { status: 'error', error: 'userId is required' as const };

      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) return { status: 'error', error: 'User not found' as const };

      if (!user.activePlanId) return { status: 'none', error: 'No active plan set for this user' as const };

      const active = await this.planRepo.findOne({
        where: { id: user.activePlanId } as any,
        relations: ['days', 'days.exercises'],
      });

      if (!active) return { status: 'none', error: 'Active plan not found' as const };

      return this.planToFrontendShape(active)
    } catch (err) {
      return { status: 'error', error: 'Unexpected error while fetching active plan' as const };
    }
  }

  async createPlanWithContent(dto: any) {
    const input = dto?.payload ?? dto;
    const { name, notes = null, isActive = true, program } = input ?? {};

    if (!name) throw new BadRequestException('name is required');
    if (!program?.days?.length) throw new BadRequestException('program.days[] required');

    // validate duplicate days...
    const seen = new Set<string>();
    for (const d of program.days) {
      const dup = String(dayEnum(String(d.dayOfWeek ?? d.id).toLowerCase()));
      if (seen.has(dup)) throw new BadRequestException(`Duplicate day: ${dup}`);
      seen.add(dup);
    }

    return this.dataSource.transaction(async manager => {
      // 1) Plan
      const savedPlan = await manager.save(Plan, manager.create(Plan, { name, notes, isActive: !!isActive }));

      // 2) Days
      for (const d of program.days) {
        const savedDay = await manager.save(
          PlanDay,
          manager.create(PlanDay, {
            plan: savedPlan,
            name: d.nameOfWeek || d.name || d.dayOfWeek || 'Workout',
            day: dayEnum(d.dayOfWeek || d.id),
          }),
        );

        // 3) “Link” by reassigning the existing plan_exercises row
        const exItems = Array.isArray(d.exercises) ? d.exercises : [];
        for (let j = 0; j < exItems.length; j++) {
          const item = exItems[j];
          if (!item.exerciseId) continue;

          const lib = await this.resolveLibraryExercise(manager, item.exerciseId);
          if (!lib) {
            // If you want strictness, throw; else continue
            throw new BadRequestException(`exerciseId ${item.exerciseId} not found in library (day IS NULL).`);
          }

          // Move it from library to plan-day
          lib.day = savedDay;
          // Optional per-plan overrides:
          if (item.name) lib.name = item.name;
          if (item.img !== undefined) lib.img = item.img;
          if (item.video !== undefined) lib.video = item.video;
          if (item.targetReps !== undefined) lib.targetReps = item.targetReps;
          if (item.targetSets !== undefined) lib.targetSets = item.targetSets;
          if (item.rest !== undefined) lib.rest = item.rest;
          if (item.tempo !== undefined) lib.tempo = item.tempo;
          if (item.desc !== undefined) lib.desc = item.desc;

          lib.orderIndex = item.order ?? j + 1;

          await manager.save(PlanExercises, lib);
        }
      }

      const full = await manager.findOne(Plan, {
        where: { id: savedPlan.id },
        relations: ['days', 'days.exercises'],
      });
      for (const d of full?.days ?? []) d.exercises?.sort?.((a, b) => a.orderIndex - b.orderIndex);
      return full;
    });
  }

  /* -------------------------------- List (CRUD) ------------------------------- */
  async list(q: any) {
    return CRUD.findAll<Plan>(this.planRepo, 'plan', q.search, q.page, q.limit, q.sortBy, q.sortOrder, ['assignments', 'days'], ['name', 'notes'], {});
  }

  /* ------------------------------ Get one (deep) ------------------------------ */
  async getOneDeep(id: string, mgr?: any) {
    const repo = mgr ? mgr.getRepository(Plan) : this.planRepo;
    const plan = await repo.findOne({
      where: { id },
      relations: ['days', 'assignments', 'days.exercises'],
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

  async bulkAssign(planId: string, dto: BulkAssignDto, userId: any) {
    if (!Array.isArray(dto.athleteIds) || dto.athleteIds.length === 0) {
      throw new BadRequestException('athleteIds[] required');
    }

    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const uniqueIds = [...new Set(dto.athleteIds)];
    const isActive = dto.isActive !== false;
    const isConfirmMove = dto.confirm === 'yes';
    const removeOthers = dto.removeOthers === true;

    // ✅ Guard: only set user.activePlanId if the dates make it currently active
    const now = new Date();
    const startOk = !dto.startDate || new Date(dto.startDate) <= now;
    const endOk = !dto.endDate || new Date(dto.endDate) >= now;
    const shouldPointUserNow = isActive && startOk && endOk; // 👈 key flag

    return await this.dataSource.transaction(async manager => {
      const athletes = await manager.find(User, {
        where: { id: In(uniqueIds) },
        select: ['id', 'name', 'activePlanId'],
      });

      console.log(athletes);

      if (athletes.length !== uniqueIds.length) {
        const found = new Set(athletes.map(a => a.id));
        const missing = uniqueIds.filter(id => !found.has(id));
        throw new NotFoundException(`Athlete(s) not found: ${missing.join(', ')}`);
      }

      // Conflicts = already on another plan
      const conflicts = athletes.filter(a => a.activePlanId && a.activePlanId !== planId);

      if (conflicts.length > 0 && !isConfirmMove) {
        const planIds = Array.from(new Set(conflicts.map(a => a.activePlanId!)));
        const plans = await manager.find(Plan, { where: { id: In(planIds) }, select: ['id', 'name'] });
        const nameById = new Map(plans.map(p => [p.id, p.name]));
        const display = conflicts.map(a => `${a.name} (currently on: ${nameById.get(a.activePlanId!) ?? a.activePlanId})`);
        throw new BadRequestException(`These users are already assigned to another plan: ${display.join(', ')}.`);
      }

      // Proceed
      for (const athlete of athletes) {
        const athleteId = athlete.id;

        if (isActive) {
          if (removeOthers) {
            // Hard-remove all assignments on other plans
            await manager.createQueryBuilder().delete().from(PlanAssignment).where('athleteId = :athleteId AND planId <> :planId', { athleteId, planId }).execute();
          } else {
            // Deactivate other active assignments
            await manager
              .createQueryBuilder()
              .update(PlanAssignment)
              .set({ isActive: false })
              .where('athleteId = :athleteId AND isActive = :active AND planId <> :planId', {
                athleteId,
                active: true,
                planId,
              })
              .execute();
          }
        }

        // Upsert this plan’s assignment
        let existing = await manager.findOne(PlanAssignment, {
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
            athlete: { id: athleteId } as any,
            isActive,
            startDate: dto.startDate ?? null,
            endDate: dto.endDate ?? null,
          } as any);
          await manager.save(PlanAssignment, assign);
        }

        // ✅ Point user's active plan — only if it's "currently" active per dates
        if (shouldPointUserNow) {
          await manager.update(User, { id: athleteId }, { activePlanId: planId });
        } else {
          // Clear only if the user currently points to THIS plan (safety against races)
          await manager.createQueryBuilder().update(User).set({ activePlanId: null }).where('id = :athleteId AND activePlanId = :planId', { athleteId, planId }).execute();
        }
      }

      return this.listAssignees(planId, manager);
    });
  }

  async listAssignees(planId: string, mgr?: any) {
    const repo = mgr ? mgr.getRepository(PlanAssignment) : this.assignRepo;
    return repo.find({ where: { plan: { id: planId } } as any, relations: ['athlete'] });
  }

  async listPlansWithStats(q: ListPlansWithStatsQuery) {
    const page = Math.max(1, q.page || 1);
    const limit = Math.min(Math.max(1, q.limit || 12), 100);
    const offset = (page - 1) * limit;
    const search = (q.search || '').trim();

    // base filter for plan name search
    const planWhere = search ? 'p.name ILIKE :search' : '1=1';
    const params: any = search ? { search: `%${search}%` } : {};

    // total count (plans) for pagination — doesn’t need joins
    const total_records = await this.planRepo.createQueryBuilder('p').where(planWhere, params).getCount();

    // map sort fields to SQL expressions available in the aggregated SELECT
    const sortMap: Record<string, string> = {
      name: '"name"',
      isActive: '"isActive"',
      created_at: '"created_at"',
      dayCount: '"dayCount"',
      exerciseCount: '"exerciseCount"',
      assignees: '"assignees"',
      activeAssignees: '"activeAssignees"',
    };
    const sortBy = sortMap[q.sortBy || 'created_at'] || '"created_at"';
    const sortOrder = q.sortOrder === 'ASC' ? 'ASC' : 'DESC';

    // aggregated rows
    const rows = await this.planRepo
      .createQueryBuilder('p')
      .leftJoin('p.days', 'd')
      .leftJoin('d.exercises', 'e')
      .leftJoin('p.assignments', 'a')
      .where(planWhere, params)
      .select('p.id', 'id')
      .addSelect('p.name', 'name')
      .addSelect('p.isActive', 'isActive')
      .addSelect('p.created_at', 'created_at')
      .addSelect('COUNT(DISTINCT d.id)', 'dayCount')
      .addSelect('COUNT(DISTINCT e.id)', 'exerciseCount')
      .addSelect('COUNT(DISTINCT a.id)', 'assignees')
      .addSelect(`COUNT(DISTINCT CASE WHEN a.isActive = true THEN a.id END)`, 'activeAssignees')
      .groupBy('p.id')
      .orderBy(sortBy, sortOrder as 'ASC' | 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{
        id: string;
        name: string;
        isActive: boolean;
        created_at: string;
        dayCount: string;
        exerciseCount: string;
        assignees: string;
        activeAssignees: string;
      }>();

    const records = rows.map(r => ({
      id: r.id,
      name: r.name,
      isActive: !!r.isActive,
      created_at: r.created_at,
      dayCount: Number(r.dayCount || 0),
      exerciseCount: Number(r.exerciseCount || 0),
      assignees: Number(r.assignees || 0),
      activeAssignees: Number(r.activeAssignees || 0),
    }));

    // summary for header KPIs (computed from current page or whole set — choose whole set)
    // Whole set summary: run the same query without paging and fold quickly.
    const fullAgg = await this.planRepo
      .createQueryBuilder('p')
      .leftJoin('p.days', 'd')
      .leftJoin('d.exercises', 'e')
      .leftJoin('p.assignments', 'a')
      .where(planWhere, params)
      .select('COUNT(DISTINCT p.id)', 'plansTotal')
      .addSelect('COUNT(DISTINCT CASE WHEN p.isActive = true THEN p.id END)', 'plansActive')
      .addSelect('COUNT(DISTINCT CASE WHEN d.id IS NULL THEN p.id END)', 'plansWithNoDays') // counted per plan
      .addSelect('COUNT(DISTINCT d.id)', 'days')
      .addSelect('COUNT(DISTINCT e.id)', 'exercisesAttached')
      .addSelect('COUNT(DISTINCT a.id)', 'assignments')
      .getRawOne<{
        plansTotal: string;
        plansActive: string;
        plansWithNoDays: string;
        days: string;
        exercisesAttached: string;
        assignments: string;
      }>();

    // Averages across the FULL filtered set (not only current page)
    const planCountForAvg = Math.max(1, Number(fullAgg?.plansTotal || 0));
    // We need totals per plan for assignees avg; we can approximate using total assignments / distinct plans
    const averages = {
      daysPerPlan: Number((Number(fullAgg?.days || 0) / planCountForAvg).toFixed(2)),
      exercisesPerPlan: Number((Number(fullAgg?.exercisesAttached || 0) / planCountForAvg).toFixed(2)),
      assigneesPerPlan: Number((Number(fullAgg?.assignments || 0) / planCountForAvg).toFixed(2)),
    };

    return {
      total_records,
      current_page: page,
      per_page: limit,
      sortBy: q.sortBy || 'created_at',
      sortOrder,
      search: search || null,
      summary: {
        plans: {
          total: Number(fullAgg?.plansTotal || 0),
          active: Number(fullAgg?.plansActive || 0),
          withNoDays: Number(fullAgg?.plansWithNoDays || 0),
        },
        structure: {
          days: Number(fullAgg?.days || 0),
          exercisesAttached: Number(fullAgg?.exercisesAttached || 0),
        },
        averages,
      },
      records, // [{ id, name, isActive, created_at, dayCount, exerciseCount, assignees, activeAssignees }]
    };
  }
}

type ListPlansWithStatsQuery = {
  page: number;
  limit: number;
  search?: string;
  sortBy?: 'name' | 'isActive' | 'created_at' | 'dayCount' | 'exerciseCount' | 'assignees' | 'activeAssignees';
  sortOrder?: 'ASC' | 'DESC';
};
