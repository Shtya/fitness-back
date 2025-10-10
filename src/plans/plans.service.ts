// --- File: plans/plans.service.ts ---
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull, In, EntityManager } from 'typeorm';
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

const WEEK_ORDER: Array<'saturday' | 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday'> = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function toArray<T = any>(v: any): T[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

function dayEnumSafe(v: any) {
  return dayEnum(String(v ?? '').toLowerCase()); // نفس دالتك الموجودة
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

  async importAndActivate(body: any) {
    // 0) Parse incoming body in a flexible way (single or multi)
    const raw: any = parseMaybeJson<any>(body);
    const payload = parseMaybeJson<any>(raw?.payload ?? raw);
    const payloadAlt = parseMaybeJson<any>(raw?.json);

    // Normalize into an array of plan specs
    let plansInput: any[] = [];

    if (Array.isArray(payload)) {
      plansInput = payload;
    } else if (Array.isArray(payloadAlt)) {
      plansInput = payloadAlt;
    } else if (Array.isArray(payload?.plans)) {
      plansInput = payload.plans;
    } else if (Array.isArray(payloadAlt?.plans)) {
      plansInput = payloadAlt.plans;
    } else if (payload && typeof payload === 'object' && Object.keys(payload).length) {
      // single plan object
      plansInput = [payload];
    } else if (payloadAlt && typeof payloadAlt === 'object' && Object.keys(payloadAlt).length) {
      plansInput = [payloadAlt];
    } else {
      throw new BadRequestException('No plan payloads found. Expect a plan object, plans[], payload[], or { plans: [] }.');
    }

    // quick sanity: ensure every item has program.days
    for (const [i, p] of plansInput.entries()) {
      const program = parseMaybeJson<any>(p?.program ?? p?.plan?.program ?? p?.programAlt);
      if (!program || !Array.isArray(program.days) || !program.days.length) {
        throw new BadRequestException(`plans[${i}]: program.days[] is required`);
      }
    }

    return this.ds.transaction(async manager => {
      const userRepo = manager.getRepository(User);
      const planRepo = manager.getRepository(Plan);
      const dayRepo = manager.getRepository(PlanDay);
      const libRepo = manager.getRepository(PlanExercises); // your library table

      const batchResults: any[] = [];
      let batchLinked = 0;

      // Validate user(s) that are explicitly provided
      // (we validate per plan below to keep backward compatibility)
      for (let index = 0; index < plansInput.length; index++) {
        const root = plansInput[index];

        const userId = root.userId || root?.athlete?.id || root?.user_id || root?.user || null;
        if (userId) {
          const exists = await userRepo.findOne({ where: { id: userId } });
          if (!exists) throw new BadRequestException(`plans[${index}]: Athlete not found`);
        }
      }

      // Process each plan
      for (let index = 0; index < plansInput.length; index++) {
        const root = plansInput[index];

        const userId = root.userId || root?.athlete?.id || root?.user_id || root?.user || null;
        const planName = String(root.name || `Program ${index + 1}`).trim();

        const program = parseMaybeJson<any>(root.program ?? root?.plan?.program ?? root?.programAlt);
        const days = toArray(program?.days);

        // 1) prevent duplicate days *within this plan only*
        const seen = new Set<string>();
        for (const d of days) {
          const key = String((d?.dayOfWeek ?? d?.id ?? '').toString().toLowerCase());
          const norm = String(dayEnumSafe(key));
          if (seen.has(norm)) throw new BadRequestException(`plans[${index}]: Duplicate day: ${norm}`);
          seen.add(norm);
        }

        // 2) create the plan
        const plan: any = await planRepo.save(planRepo.create({ name: planName, isActive: true } as any));

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

        let linkedCount = 0;

        // 3) per day: create PlanDay, then attach existing exercise IDs via M2M
        for (const dRaw of days) {
          const dayKey = String(dRaw?.dayOfWeek ?? dRaw?.id ?? 'monday').toLowerCase();
          const savedDay: any = await dayRepo.save(
            dayRepo.create({
              plan,
              name: dRaw?.nameOfWeek || dRaw?.name || dRaw?.id || dRaw?.dayOfWeek || 'Workout',
              day: dayEnumSafe(dRaw?.dayOfWeek ?? dRaw?.id),
            } as any),
          );

          // accept both [{exerciseId, order}, ...] and ['id', 'id2', ...]
          const exArr = toArray(dRaw?.exercises);
          const exIds = exArr
            .map((e: any) => (typeof e === 'string' ? e : e?.exerciseId))
            .filter(Boolean)
            .map((s: any) => String(s));

          if (exIds.length) {
            // validate library rows exist
            const found = await libRepo.findBy({ id: In(exIds) });
            if (found.length !== exIds.length) {
              const ok = new Set(found.map(f => f.id));
              const missing = exIds.filter(x => !ok.has(x));
              throw new BadRequestException(`plans[${index}]: Some exerciseId(s) not found: ${missing.join(', ')}`);
            }

            // link all at once (does not create new rows in plan_exercises)
            await manager.createQueryBuilder().relation(PlanDay, 'exercises').of(savedDay).add(exIds);

            linkedCount += exIds.length;
            batchLinked += exIds.length;

            // shape FE response in payload order (display only; DB doesn’t persist order in M2M)
            const byId = new Map(found.map(f => [f.id, f]));
            const ordered = exIds.map(id => byId.get(id)).filter(Boolean) as typeof found;

            responseDays.push({
              id: dayKey,
              dayOfWeek: dayKey,
              name: savedDay.name,
              exercises: ordered.map(x => ({
                id: x.id,
                name: x.name,
                targetSets: x.targetSets,
                targetReps: x.targetReps,
                rest: x.rest ?? null,
                tempo: x.tempo ?? null,
                img: x.img ?? null,
                video: x.video ?? null,
              })),
            });
          } else {
            responseDays.push({
              id: dayKey,
              dayOfWeek: dayKey,
              name: savedDay.name,
              exercises: [],
            });
          }
        }

        // 4) build per-plan FE response
        const fePlan = {
          id: plan.id,
          created_at: (plan as any).created_at,
          updated_at: (plan as any).updated_at,
          deleted_at: (plan as any).deleted_at ?? null,
          name: plan.name,
          userId: userId ?? null,
          isActive: !!plan.isActive,
          metadata: {},
          program: { days: responseDays },
        };

        batchResults.push({
          ok: true,
          message: `Imported successfully. ${linkedCount} links created.`,
          stats: { linkedFromLibrary: linkedCount },
          planId: plan.id,
          plan: fePlan,
        });
      }

      // 5) final batch response
      return {
        ok: true,
        totalPlans: batchResults.length,
        totalLinksCreated: batchLinked,
        results: batchResults,
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
      created_at: this.coalesce(plan.created_at, plan.created_at, null),
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

      return this.planToFrontendShape(active);
    } catch (err) {
      return { status: 'error', error: 'Unexpected error while fetching active plan' as const };
    }
  }

  async createPlanWithContent(dto: any) {
    const input = dto?.payload ?? dto;
    const { name, notes = null, isActive = true, program } = input ?? {};

    if (!name) throw new BadRequestException('name is required');
    if (!program?.days?.length) throw new BadRequestException('program.days[] required');

    // prevent duplicate days in the same plan
    const seenDays = new Set<string>();
    for (const d of program.days) {
      const k = String(dayEnum(String(d.dayOfWeek ?? d.id).toLowerCase()));
      if (seenDays.has(k)) throw new BadRequestException(`Duplicate day: ${k}`);
      seenDays.add(k);
    }

    return this.dataSource.transaction(async manager => {
      // 1) Plan
      const plan = await manager.save(Plan, manager.create(Plan, { name, notes, isActive: !!isActive }));

      // 2) Days, then link M2M by IDs
      for (const d of program.days) {
        const exItems = Array.isArray(d.exercises) ? d.exercises : [];
        const exIds = exItems.map(e => String(e.exerciseId)).filter(Boolean);

        // Validate **library** rows (your PlanExercises table)
        if (exIds.length) {
          const found = await manager.findBy(PlanExercises, { id: In(exIds) });
          if (found.length !== exIds.length) {
            const set = new Set(found.map(f => f.id));
            const missing = exIds.filter(id => !set.has(id));
            throw new BadRequestException(`Some exerciseId(s) not found: ${missing.join(', ')}`);
          }
        }

        // Create the day
        const dayRow = await manager.save(
          PlanDay,
          manager.create(PlanDay, {
            plan,
            name: d.nameOfWeek || d.name || d.dayOfWeek,
            day: dayEnum(d.dayOfWeek || d.id),
          }),
        );

        // Attach links (this writes join rows in plan_day_exercise_links)
        if (exIds.length) {
          await manager.createQueryBuilder().relation(PlanDay, 'exercises').of(dayRow).add(exIds);
        }
      }

      // 3) Load graph
      const full = await manager.findOne(Plan, {
        where: { id: plan.id },
        relations: ['days', 'days.exercises'],
        // Adjust timestamp field name to your CoreEntity (created_at vs created_at)
        order: { days: { created_at: 'ASC' as any } },
      });

      // Optional: Present exercises in payload order (NOT persisted by DB)
      for (const d of full?.days ?? []) {
        const orig = program.days.find(x => dayEnum(x.dayOfWeek || x.id) === d.day);
        if (orig?.exercises?.length && d.exercises?.length) {
          const orderMap: any = new Map(orig.exercises.map((x: any, i: number) => [String(x.exerciseId), i]));
          d.exercises.sort((a: any, b: any) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
        }
      }

      return full;
    });
  }

  /* -------------------------------- List (CRUD) ------------------------------- */
  async list(q: any) {
    return CRUD.findAll<Plan>(this.planRepo, 'plan', q.search, q.page, q.limit, q.sortBy, q.sortOrder, ['assignments', 'days'], ['name', 'notes'], {});
  }

  /* ------------------------------ Get one (deep) ------------------------------ */
  async getOneDeep(id: string, mgr?: any, dayOrderMap?: Map<string, number>) {
    const repo = mgr ? mgr.getRepository(Plan) : this.planRepo;
    const plan = await repo.findOne({
      where: { id },
      relations: ['days', 'assignments', 'days.exercises'],
    });

    if (!plan) throw new NotFoundException('Plan not found');

    // Sort days - if dayOrderMap is provided, use it, otherwise use week order
    if (plan.days) {
      if (dayOrderMap && dayOrderMap.size > 0) {
        // Sort by the custom order from DTO
        plan.days.sort((a, b) => {
          const orderA = dayOrderMap.get(a.day) ?? 99;
          const orderB = dayOrderMap.get(b.day) ?? 99;
          return orderA - orderB;
        });
      } else {
        // Fallback to week order
        plan.days.sort((a, b) => {
          const orderA = WEEK_ORDER.indexOf(a.day as any);
          const orderB = WEEK_ORDER.indexOf(b.day as any);
          return orderA - orderB;
        });
      }
    }

    return plan;
  }

  /** نفس الدالة السابقة التي أعطيتك إياها */
  private dayEnum(input: string): string {
    const s = String(input || '')
      .trim()
      .toLowerCase();
    const map: Record<string, string> = {
      mon: 'monday',
      monday: 'monday',
      tue: 'tuesday',
      tues: 'tuesday',
      tuesday: 'tuesday',
      wed: 'wednesday',
      weds: 'wednesday',
      wednesday: 'wednesday',
      thu: 'thursday',
      thur: 'thursday',
      thurs: 'thursday',
      thursday: 'thursday',
      fri: 'friday',
      friday: 'friday',
      sat: 'saturday',
      saturday: 'saturday',
      sun: 'sunday',
      sunday: 'sunday',
    };
    const v = map[s];
    if (!v) throw new BadRequestException(`Invalid dayOfWeek "${input}"`);
    return v;
  }

  async updatePlanAndContent(id: string, dto: any) {
    return await this.dataSource.transaction(async manager => {
      const plan = await manager.findOne(Plan, {
        where: { id },
        relations: ['days', 'days.exercises'],
      });

      if (!plan) throw new NotFoundException('Plan not found');

      // Update basic plan properties
      if (dto.name !== undefined) plan.name = dto.name;
      if (dto.notes !== undefined) (plan as any).notes = dto.notes ?? null;
      if (dto.isActive !== undefined) plan.isActive = !!dto.isActive;

      await manager.save(Plan, plan);

      // Declare days variable outside the if block so it's accessible later
      let daysFromDto: any[] = [];
      let dayOrderMap: Map<string, number> = new Map();

      // If program.days is provided, update the plan structure
      if (dto.program?.days) {
        daysFromDto = toArray(dto.program.days);

        // Build day order map for sorting
        daysFromDto.forEach((dayDto, index) => {
          const dayKey = this.dayEnum(dayDto.dayOfWeek ?? dayDto.id);
          dayOrderMap.set(dayKey, index);
        });

        // Validate days to prevent duplicates
        const seenDays = new Set<string>();
        for (const d of daysFromDto) {
          const dayKey = String(this.dayEnum(d.dayOfWeek ?? d.id));
          if (seenDays.has(dayKey)) {
            throw new BadRequestException(`Duplicate day: ${dayKey}`);
          }
          seenDays.add(dayKey);
        }

        // Get existing days to compare
        const existingDays = await manager.find(PlanDay, {
          where: { plan: { id } },
          relations: ['exercises'],
        });

        const existingDayMap = new Map(existingDays.map(d => [d.day, d]));

        // Process each day from the DTO in order
        for (const dayDto of daysFromDto) {
          const dayOfWeek: any = this.dayEnum(dayDto.dayOfWeek ?? dayDto.id);
          const existingDay = existingDayMap.get(dayOfWeek);

          if (existingDay) {
            // Update existing day name and order
            existingDay.name = dayDto.nameOfWeek || dayDto.name || dayDto.dayOfWeek || existingDay.name;
            await manager.save(PlanDay, existingDay);

            // Update exercises for this day (maintaining order)
            await this.updateDayExercisesWithOrder(manager, existingDay, dayDto.exercises || []);

            // Remove from map to track which days were processed
            existingDayMap.delete(dayOfWeek);
          } else {
            // Create new day with order
            const newDayData: any = {
              plan,
              name: dayDto.nameOfWeek || dayDto.name || dayDto.dayOfWeek || 'Workout',
              day: dayOfWeek as DayOfWeek,
            };

            const newDay = await manager.save(PlanDay, manager.create(PlanDay, newDayData));

            // Add exercises to new day with order
            await this.updateDayExercisesWithOrder(manager, newDay, dayDto.exercises || []);
          }
        }

        // Remove days that are no longer in the DTO
        for (const removedDay of existingDayMap.values()) {
          await manager.remove(PlanDay, removedDay);
        }
      }

      // Return the updated plan with proper day ordering
      const updatedPlan = await this.getOneDeep(plan.id, manager, dayOrderMap);

      return updatedPlan;
    });
  }

  // Helper method to update exercises with order preservation
  private async updateDayExercisesWithOrder(manager: EntityManager, day: PlanDay, exercisesDto: any[]) {
    const exerciseRepo = manager.getRepository(PlanExercises);

    // Extract exercise IDs with their order from DTO
    const exercisesWithOrder = exercisesDto.map((e, index) => ({
      id: String(e.exerciseId || e),
      order: e.order !== undefined ? e.order : index,
    }));

    const newExerciseIds = exercisesWithOrder.map(e => e.id);

    // Validate that all exercise IDs exist in the library
    if (newExerciseIds.length > 0) {
      const foundExercises = await exerciseRepo.findBy({
        id: In(newExerciseIds),
      });

      if (foundExercises.length !== newExerciseIds.length) {
        const foundIds = new Set(foundExercises.map(e => e.id));
        const missingIds = newExerciseIds.filter(id => !foundIds.has(id));
        throw new BadRequestException(`Exercise IDs not found: ${missingIds.join(', ')}`);
      }
    }

    // Get current exercises for this day
    const currentExercises = await manager.createQueryBuilder().relation(PlanDay, 'exercises').of(day).loadMany();

    const currentExerciseIds = currentExercises.map(e => e.id);

    // Find exercises to add and remove
    const exercisesToAdd = newExerciseIds.filter(id => !currentExerciseIds.includes(id));
    const exercisesToRemove = currentExerciseIds.filter(id => !newExerciseIds.includes(id));

    // Remove exercises that are no longer needed
    if (exercisesToRemove.length > 0) {
      await manager.createQueryBuilder().relation(PlanDay, 'exercises').of(day).remove(exercisesToRemove);
    }

    // Add new exercises
    if (exercisesToAdd.length > 0) {
      await manager.createQueryBuilder().relation(PlanDay, 'exercises').of(day).add(exercisesToAdd);
    }

    // Since M2M doesn't natively support order, we'll store the order mapping
    // This can be used when querying to maintain order
    const exerciseOrderMap = new Map(exercisesWithOrder.map(e => [e.id, e.order]));

    // If you need to persist order, you might need a join entity with order field
    // For now, we'll handle order in the response transformation
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
    const search = (q.search || '').trim();

    const planWhere = search ? 'p.name ILIKE :search' : '1=1';
    const params: any = search ? { search: `%${search}%` } : {};

    // Enhanced summary for header KPIs
    const fullAgg = await this.planRepo.createQueryBuilder('p').leftJoin('p.days', 'd').leftJoin('d.exercises', 'e').leftJoin('p.assignments', 'a').leftJoin('p.activeUsers', 'au').where(planWhere, params).select('COUNT(DISTINCT p.id)', 'plansTotal').addSelect('COUNT(DISTINCT CASE WHEN p.isActive = true THEN p.id END)', 'plansActive').addSelect('COUNT(DISTINCT CASE WHEN d.id IS NULL THEN p.id END)', 'plansWithNoDays').addSelect('COUNT(DISTINCT CASE WHEN a.id IS NULL THEN p.id END)', 'plansWithNoAssignments').addSelect('COUNT(DISTINCT CASE WHEN au.id IS NOT NULL THEN p.id END)', 'plansWithActiveUsers').addSelect('COUNT(DISTINCT d.id)', 'days').addSelect('COUNT(DISTINCT e.id)', 'exercisesAttached').addSelect('COUNT(DISTINCT a.id)', 'assignments').addSelect('COUNT(DISTINCT au.id)', 'totalActiveUsers').addSelect('MAX(p.created_at)', 'newestPlanDate').addSelect('MIN(p.created_at)', 'oldestPlanDate').addSelect(`COUNT(DISTINCT CASE WHEN d.day = 'monday' THEN d.id END)`, 'totalMondays').addSelect(`COUNT(DISTINCT CASE WHEN d.day = 'friday' THEN d.id END)`, 'totalFridays').addSelect(`COUNT(DISTINCT CASE WHEN d.day = 'saturday' THEN d.id END)`, 'totalSaturdays').addSelect(`COUNT(DISTINCT CASE WHEN d.day = 'sunday' THEN d.id END)`, 'totalSundays').getRawOne<{
      plansTotal: string;
      plansActive: string;
      plansWithNoDays: string;
      plansWithNoAssignments: string;
      plansWithActiveUsers: string;
      days: string;
      exercisesAttached: string;
      assignments: string;
      totalActiveUsers: string;
      newestPlanDate: string;
      oldestPlanDate: string;
      totalMondays: string;
      totalFridays: string;
      totalSaturdays: string;
      totalSundays: string;
    }>();

    return {
      summary: {
        plans: {
          total: Number(fullAgg?.plansTotal || 0),
          active: Number(fullAgg?.plansActive || 0),
          withNoDays: Number(fullAgg?.plansWithNoDays || 0),
          withNoAssignments: Number(fullAgg?.plansWithNoAssignments || 0),
          withActiveUsers: Number(fullAgg?.plansWithActiveUsers || 0),
        },
        usage: {
          totalActiveUsers: Number(fullAgg?.totalActiveUsers || 0),
          totalAssignments: Number(fullAgg?.assignments || 0),
        },
      },
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
