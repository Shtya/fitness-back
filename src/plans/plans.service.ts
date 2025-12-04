// src/plans/plans.service.ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, EntityManager } from 'typeorm';
import { Exercise, ExercisePlan, ExercisePlanDay, ExercisePlanDayExercise, User, DayOfWeek, UserRole } from 'entities/global.entity';
import { CRUD } from 'common/crud.service';
import { RedisService } from '../redis/redis.service';

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

const WEEK_ORDER: Array<'saturday' | 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday'> = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function toArray<T = any>(v: any): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

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

@Injectable()
export class PlanService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ExercisePlan) private readonly planRepo: Repository<ExercisePlan>,
    @InjectRepository(ExercisePlanDay) private readonly dayRepo: Repository<ExercisePlanDay>,
    @InjectRepository(ExercisePlanDayExercise) private readonly pdeRepo: Repository<ExercisePlanDayExercise>,
    @InjectRepository(Exercise) private readonly exRepo: Repository<Exercise>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly redisService: RedisService, // Inject Redis service
  ) {}

  private assertCanAccessPlan(plan: ExercisePlan, actor: { id: string; role: UserRole }, action: 'view' | 'edit' | 'delete' | 'assign') {
    if (actor.role === UserRole.SUPER_ADMIN) {
      return;
    }

    if (actor.role === UserRole.ADMIN && plan.adminId === actor.id) {
      return;
    }

    throw new ForbiddenException('You can only take actions on plans you created.');
  }

  private scopedPlanQB(actor: { id: string; role: UserRole }) {
    const qb = this.planRepo.createQueryBuilder('p');

    if (actor.role === UserRole.SUPER_ADMIN) {
      return qb;
    }

    if (actor.role === UserRole.ADMIN || actor.role === UserRole.COACH) {
      qb.where('(p."adminId" IS NULL OR p."adminId" = :adminId)', { adminId: actor.id });
      return qb;
    }

    // default: block everything
    qb.where('1=0');
    return qb;
  }

  /* ---------- Helpers ---------- */
  weekIndex(d?: string) {
    const i = WEEK_ORDER.indexOf(String(d ?? '').toLowerCase() as any);
    return i === -1 ? 99 : i;
  }
  coalesce<T>(...vals: T[]): T | undefined {
    for (const v of vals) if (v !== undefined && v !== null) return v;
    return undefined;
  }
  private normDay(input: any): DayOfWeek {
    return dayEnum(String(input ?? '').toLowerCase());
  }

  async importAndActivate(body: any, actor: { id: string; role: UserRole }) {
    const raw: any = parseMaybeJson<any>(body);
    const payload = parseMaybeJson<any>(raw?.payload ?? raw);
    const payloadAlt = parseMaybeJson<any>(raw?.json);

    let plansInput: any[] = [];
    if (Array.isArray(payload)) plansInput = payload;
    else if (Array.isArray(payloadAlt)) plansInput = payloadAlt;
    else if (Array.isArray(payload?.plans)) plansInput = payload.plans;
    else if (Array.isArray(payloadAlt?.plans)) plansInput = payloadAlt.plans;
    else if (payload && typeof payload === 'object' && Object.keys(payload).length) plansInput = [payload];
    else if (payloadAlt && typeof payloadAlt === 'object' && Object.keys(payloadAlt).length) plansInput = [payloadAlt];
    else throw new BadRequestException('No plan payloads found.');

    for (const [i, p] of plansInput.entries()) {
      const program = parseMaybeJson<any>(p?.program ?? p?.plan?.program ?? p?.programAlt);
      if (!program || !Array.isArray(program.days) || !program.days.length) {
        throw new BadRequestException(`plans[${i}]: program.days[] is required`);
      }
    }

    return this.dataSource.transaction(async manager => {
      const batchResults: any[] = [];
      let batchLinked = 0;

      for (let index = 0; index < plansInput.length; index++) {
        const root = plansInput[index];
        const planName = String(root.name || `Program ${index + 1}`).trim();
        const program = parseMaybeJson<any>(root.program ?? root?.plan?.program ?? root?.programAlt);
        const days = toArray(program?.days);

        // no duplicate days across same plan
        const seen = new Set<string>();
        for (const d of days) {
          const norm = String(this.normDay(d?.dayOfWeek ?? d?.id));
          if (seen.has(norm)) throw new BadRequestException(`plans[${index}]: Duplicate day: ${norm}`);
          seen.add(norm);
        }

        // create plan WITH adminId
        const plan = await manager.save(
          ExercisePlan,
          manager.create(ExercisePlan, {
            name: planName,
            isActive: true,
            adminId: actor.role === UserRole.ADMIN ? actor.id : null,
          }),
        );

        const responseDays: any[] = [];
        let linkedCount = 0;

        for (const dRaw of days) {
          const dayRow = await manager.save(
            ExercisePlanDay,
            manager.create(ExercisePlanDay, {
              plan,
              name: dRaw?.nameOfWeek || dRaw?.name || dRaw?.id || dRaw?.dayOfWeek || 'Workout',
              day: this.normDay(dRaw?.dayOfWeek ?? dRaw?.id),
            }),
          );

          const exArr = toArray(dRaw?.exercises);
          let order = 0;
          const items: ExercisePlanDayExercise[] = [];
          for (const src of exArr) {
            const exId = typeof src === 'string' ? src : src?.exerciseId || src?.id || null;
            if (!exId) continue;
            const exercise = await manager.findOne(Exercise, { where: { id: String(exId) } });
            if (!exercise) throw new BadRequestException(`Exercise not found: ${exId}`);

            const item = manager.create(ExercisePlanDayExercise, {
              day: dayRow,
              exercise,
              orderIndex: (src?.orderIndex ?? src?.order ?? order) as number,
            });
            items.push(item);
            order++;
          }
          if (items.length) {
            await manager.save(ExercisePlanDayExercise, items);
            linkedCount += items.length;
            batchLinked += items.length;
          }

          responseDays.push({
            id: String(dayRow.day).toLowerCase(),
            dayOfWeek: String(dayRow.day).toLowerCase(),
            name: dayRow.name,
            exercises: items
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map(x => ({
                id: x.exercise.id,
                name: x.exercise.name,
                targetSets: x.exercise.targetSets,
                targetReps: x.exercise.targetReps,
                rest: x.exercise.rest ?? null,
                tempo: x.exercise.tempo ?? null,
                img: x.exercise.img ?? null,
                video: x.exercise.video ?? null,
              })),
          });
        }

        const fePlan = {
          id: plan.id,
          created_at: (plan as any).created_at,
          updated_at: (plan as any).updated_at,
          deleted_at: (plan as any).deleted_at ?? null,
          name: plan.name,
          isActive: !!plan.isActive,
          metadata: {},
          program: { days: responseDays },
        };

        batchResults.push({
          ok: true,
          message: `Imported successfully. ${linkedCount} items created.`,
          stats: { linkedFromLibrary: linkedCount },
          planId: plan.id,
          plan: fePlan,
        });
      }

      // Invalidate plans cache after import
      await this.invalidatePlansCache(actor.id);

      return {
        ok: true,
        totalPlans: batchResults.length,
        totalLinksCreated: batchLinked,
        results: batchResults,
      };
    });
  }

  /* ---------- Active plan ---------- */
  async getActivePlan(userId: string) {
    if (!userId) return { status: 'error', error: 'userId is required' as const };

    const cacheKey = `active_plan:${userId}`;

    // Try cache first
    const cachedResult = await this.redisService.get<{
      status: string;
      error?: string;
      id?: string;
      name?: string;
      program?: any;
    }>(cacheKey);

    if (cachedResult) {
      return cachedResult;
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return { status: 'error', error: 'User not found' as const };

    if (!user.activeExercisePlanId) return { status: 'none', error: 'No active plan set for this user' as const };

    const active = await this.planRepo.findOne({
      where: { id: user.activeExercisePlanId },
      relations: ['days', 'days.items', 'days.items.exercise'],
    });
    if (!active) return { status: 'none', error: 'Active plan not found' as const };

    const result = this.planToFrontendShape(active);

    // Cache for 5 minutes
    await this.redisService.set(cacheKey, { status: 'success', ...result }, 300);

    return result;
  }

  async createPlanWithContent(input: any, actor: { id: string; role: UserRole }) {
    const { name, isActive = true, program } = input ?? {};
    if (!name) throw new BadRequestException('name is required');
    if (!program?.days?.length) throw new BadRequestException('program.days[] required');

    // validate duplicate days
    const seenDays = new Set<string>();
    for (const d of program.days) {
      const k = String(dayEnum(String(d.dayOfWeek ?? d.id).toLowerCase()));
      if (seenDays.has(k)) throw new BadRequestException(`Duplicate day: ${k}`);
      seenDays.add(k);
    }

    return this.dataSource.transaction(async manager => {
      const plan = await manager.save(
        ExercisePlan,
        manager.create(ExercisePlan, {
          name,
          isActive: !!isActive,
          adminId: actor.role === UserRole.ADMIN ? actor.id : null,
        }),
      );

      for (const d of program.days) {
        const dayRow = await manager.save(
          ExercisePlanDay,
          manager.create(ExercisePlanDay, {
            plan,
            name: d.nameOfWeek || d.name || d.dayOfWeek,
            day: dayEnum(d.dayOfWeek || d.id),
          }),
        );

        const exItems = Array.isArray(d.exercises) ? d.exercises : [];
        let order = 0;
        const rows: ExercisePlanDayExercise[] = [];
        for (const e of exItems) {
          const exId = String(e.exerciseId || e.id || e);
          const ex = await manager.findOne(Exercise, { where: { id: exId } });
          if (!ex) throw new BadRequestException(`Exercise not found: ${exId}`);
          rows.push(
            manager.create(ExercisePlanDayExercise, {
              day: dayRow,
              exercise: ex,
              orderIndex: (e.orderIndex ?? e.order ?? order) as number,
            }),
          );
          order++;
        }
        if (rows.length) await manager.save(ExercisePlanDayExercise, rows);
      }

      const full = await manager.findOne(ExercisePlan, {
        where: { id: plan.id },
        relations: ['days', 'days.items', 'days.items.exercise'],
        order: { days: { created_at: 'ASC' as any } },
      });

      // Invalidate plans cache after creation
      await this.invalidatePlansCache(actor.id);

      return this.planToFrontendShape(full as any);
    });
  }

  async list(q: any, actor: { id: string; role: UserRole }) {
    const page = Number(q.page) || 1;
    const limit = Math.min(Number(q.limit) || 12, 100);
    const search = (q.search || '').trim();
    const sortBy = (q.sortBy as any) || 'created_at';
    const sortOrder: 'ASC' | 'DESC' = String(q.sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const cacheKey = ['plans:list', actor.id, actor.role, page, limit, sortBy, sortOrder, search || '_'].join(':');

    // Try cache with Redis service
    const cachedResult = await this.redisService.get<{
      total_records: number;
      current_page: number;
      per_page: number;
      records: any[];
    }>(cacheKey);

    if (cachedResult) {
      return cachedResult;
    }

    const SORTABLE: Record<string, string> = {
      created_at: 'p.created_at',
      name: 'p.name',
      isActive: 'p.isActive',
    };
    const sortExpr = SORTABLE[sortBy] ?? SORTABLE.created_at;

    const qb = this.scopedPlanQB(actor).leftJoinAndSelect('p.days', 'd').leftJoinAndSelect('d.items', 'i').leftJoinAndSelect('i.exercise', 'ex');

    if (search) {
      qb.andWhere('p.name ILIKE :s', { s: `%${search}%` });
    }

    qb.orderBy(sortExpr, sortOrder)
      .addOrderBy('p.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    const result = {
      total_records: total,
      current_page: page,
      per_page: limit,
      records: rows.map(plan => this.planToFrontendShape(plan)),
    };

    // Store in Redis cache for 60 seconds
    await this.redisService.set(cacheKey, result, 60);

    return result;
  }

  async getOneDeep(id: string) {
    const cacheKey = `plan:${id}`;

    // Try cache first
    const cachedResult = await this.redisService.get<any>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const plan = await this.planRepo.findOne({
      where: { id },
      relations: ['days', 'days.items', 'days.items.exercise'],
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const result = this.planToFrontendShape(plan);

    // Cache for 5 minutes
    await this.redisService.set(cacheKey, result, 300);

    return result;
  }

  /* ---------- Update (days + items) ---------- */
  /**
   * i need here if he super_admin can make any thing
   * if her admin check if the exercisePlan have { adminId == this user id } can make any thing if not cannot edit on it
   *
   */
  async updatePlanAndContent(id: string, dto: any, actor: { id: string; role: UserRole }) {
    return await this.dataSource.transaction(async manager => {
      const plan = await manager.findOne(ExercisePlan, {
        where: { id },
        relations: ['days', 'days.items', 'days.items.exercise'],
      });
      if (!plan) throw new NotFoundException('Plan not found');

      this.assertCanAccessPlan(plan, actor, 'edit');

      if (dto.name !== undefined) plan.name = dto.name;
      if (dto.isActive !== undefined) plan.isActive = !!dto.isActive;
      await manager.save(ExercisePlan, plan);

      if (dto.program?.days) {
        const incomingDays = toArray(dto.program.days);

        // validate duplicates
        const seen = new Set<string>();
        for (const d of incomingDays) {
          const k = String(this.normDay(d.dayOfWeek ?? d.id));
          if (seen.has(k)) throw new BadRequestException(`Duplicate day: ${k}`);
          seen.add(k);
        }

        // map existing days
        const existingDays = await manager.find(ExercisePlanDay, { where: { plan: { id } }, relations: ['items'] });
        const byDay = new Map(existingDays.map(d => [d.day, d]));

        // upsert days
        for (const d of incomingDays) {
          const dayKey = this.normDay(d.dayOfWeek ?? d.id);
          const cur = byDay.get(dayKey);

          if (cur) {
            cur.name = d.nameOfWeek || d.name || (cur.name ?? String(dayKey));
            await manager.save(ExercisePlanDay, cur);

            // replace items (simple approach)
            await manager.delete(ExercisePlanDayExercise, { day: { id: cur.id } as any });

            const src = toArray(d.exercises);
            let ord = 0;
            const rows: ExercisePlanDayExercise[] = [];
            for (const e of src) {
              const exId = String(e.exerciseId || e.id || e);
              const ex = await manager.findOne(Exercise, { where: { id: exId } });
              if (!ex) throw new BadRequestException(`Exercise not found: ${exId}`);
              rows.push(
                manager.create(ExercisePlanDayExercise, {
                  day: cur,
                  exercise: ex,
                  orderIndex: (e.orderIndex ?? e.order ?? ord) as number,
                }),
              );
              ord++;
            }
            if (rows.length) await manager.save(ExercisePlanDayExercise, rows);
            byDay.delete(dayKey);
          } else {
            const newDay = await manager.save(
              ExercisePlanDay,
              manager.create(ExercisePlanDay, {
                plan,
                name: d.nameOfWeek || d.name || String(dayKey),
                day: dayKey,
              }),
            );

            const src = toArray(d.exercises);
            let ord = 0;
            const rows: ExercisePlanDayExercise[] = [];
            for (const e of src) {
              const exId = String(e.exerciseId || e.id || e);
              const ex = await manager.findOne(Exercise, { where: { id: exId } });
              if (!ex) throw new BadRequestException(`Exercise not found: ${exId}`);
              rows.push(
                manager.create(ExercisePlanDayExercise, {
                  day: newDay,
                  exercise: ex,
                  orderIndex: (e.orderIndex ?? e.order ?? ord) as number,
                }),
              );
              ord++;
            }
            if (rows.length) await manager.save(ExercisePlanDayExercise, rows);
          }
        }

        // removed days
        for (const leftover of byDay.values()) {
          await manager.delete(ExercisePlanDayExercise, { day: { id: leftover.id } as any });
          await manager.remove(ExercisePlanDay, leftover);
        }
      }

      const full = await manager.findOne(ExercisePlan, {
        where: { id: plan.id },
        relations: ['days', 'days.items', 'days.items.exercise'],
      });

      // Invalidate caches after update
      await this.invalidatePlanCaches(id, actor.id);

      return this.planToFrontendShape(full as any);
    });
  }

  async remove(id: string, actor: { id: string; role: UserRole }) {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');

    this.assertCanAccessPlan(plan, actor, 'delete');

    await this.planRepo.remove(plan);

    // Invalidate caches after deletion
    await this.invalidatePlanCaches(id, actor.id);

    return { message: 'Plan deleted' };
  }

  async bulkAssign(
    planId: string,
    dto: {
      athleteIds: string[];
      startDate?: string;
      endDate?: string;
      isActive?: boolean;
      confirm?: 'yes' | 'no';
      removeOthers?: boolean;
    },
    actor: { id: string; role: UserRole },
  ) {
    if (!Array.isArray(dto.athleteIds) || dto.athleteIds.length === 0) {
      throw new BadRequestException('athleteIds[] required');
    }

    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const uniqueIds = [...new Set(dto.athleteIds)];

    // (rest of your logic is unchanged)
    const now = new Date();
    const startOk = !dto.startDate || new Date(dto.startDate) <= now;
    const endOk = !dto.endDate || new Date(dto.endDate) >= now;
    const shouldPointUserNow = dto.isActive !== false && startOk && endOk;

    await this.dataSource.transaction(async manager => {
      const users = await manager.find(User, { where: { id: In(uniqueIds) } });
      if (users.length !== uniqueIds.length) {
        const got = new Set(users.map(u => u.id));
        const missing = uniqueIds.filter(id => !got.has(id));
        throw new NotFoundException(`Athlete(s) not found: ${missing.join(', ')}`);
      }

      for (const u of users) {
        await manager.update(User, { id: u.id }, { activeExercisePlanId: shouldPointUserNow ? planId : null });

        // Invalidate active plan cache for each user
        await this.redisService.del(`active_plan:${u.id}`);
      }
    });

    // Invalidate plan caches
    await this.invalidatePlanCaches(planId, actor.id);

    return this.listAssignees(planId);
  }

  async listAssignees(planId: string) {
    // no join-table: just return users pointing to this plan
    const users = await this.userRepo.find({ where: { activeExercisePlanId: planId } });
    return users;
  }

  /* ---------- Cache Invalidation Methods ---------- */
  private async invalidatePlansCache(actorId: string) {
    const pattern = `plans:list:${actorId}:*`;
    await this.redisService.deletePattern(pattern);
  }

  private async invalidatePlanCaches(planId: string, actorId: string) {
    // Invalidate specific plan cache
    await this.redisService.del(`plan:${planId}`);

    // Invalidate plans list cache for this actor
    await this.invalidatePlansCache(actorId);

    // Invalidate any active plan caches that might reference this plan
    const pattern = `active_plan:*`;
    await this.redisService.deletePattern(pattern);
  }

  /* ---------- FE shape ---------- */
  planToFrontendShape(plan: ExercisePlan) {

		const daysRaw = Array.isArray((plan as any)?.days) ? (plan as any).days : [];

    const days = daysRaw.map((d: any & { items?: ExercisePlanDayExercise[] }) => {
        const dayOfWeek = String(d.day).toLowerCase();
        const items = Array.isArray(d.items) ? d.items.slice().sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)) : [];

        const exercises = items.map(e => {
          const x = e.exercise;
          return {
            id: x.id,
            name: x.name,
            targetSets: x.targetSets,
            targetReps: x.targetReps,
            rest: x.rest ?? null,
            tempo: x.tempo ?? null,
            img: x.img ?? null,
            video: x.video ?? null,
          };
        });

        return {
          id: dayOfWeek,
          dayOfWeek,
          name: d.name ?? dayOfWeek,
          
          exercises,
        };
      })
      .sort((a: any, b: any) => this.weekIndex(a.dayOfWeek) - this.weekIndex(b.dayOfWeek));

    return {
      id: (plan as any).id,
      created_at: (plan as any).created_at ?? null,
      updated_at: (plan as any).updated_at ?? null,
      deleted_at: (plan as any).deleted_at ?? null,
      name: plan.name,
      isActive: !!plan.isActive,
			adminId: plan?.adminId ,
      program: { days },
    };
  }

  async listPlansWithStats(q: ListPlansWithStatsQuery, actor: { id: string; role: UserRole }) {
    const search = (q.search || '').trim();

    const cacheKey = ['plans:stats', actor.id, actor.role, search || '_'].join(':');

    // Try cache first
    const cachedResult = await this.redisService.get<{
      plans: {
        total: number;
        totalPlansPersonal: number;
      };
    }>(cacheKey);

    if (cachedResult) {
      return cachedResult;
    }

    // قاعدة الاستعلام الأساسية
    const qb = this.scopedPlanQB(actor);

    if (search) {
      qb.andWhere('p.name ILIKE :search', { search: `%${search}%` });
    }

    // احسب إجمالي الخطط العامة (adminId = null)
    const publicPlansQb = qb.clone().andWhere('p.adminId IS NULL').select('COUNT(DISTINCT p.id)', 'publicPlansTotal');

    // احسب إجمالي الخطط الشخصية (adminId = actor.id)
    const personalPlansQb = qb.clone().andWhere('p.adminId = :adminId', { adminId: actor.id }).select('COUNT(DISTINCT p.id)', 'personalPlansTotal');

    const [publicAgg, personalAgg] = await Promise.all([publicPlansQb.getRawOne<{ publicPlansTotal: string }>(), personalPlansQb.getRawOne<{ personalPlansTotal: string }>()]);

    const result = {
      plans: {
        total: Number(publicAgg?.publicPlansTotal || 0),
        totalPlansPersonal: Number(personalAgg?.personalPlansTotal || 0),
      },
    };

    // Cache for 2 minutes
    await this.redisService.set(cacheKey, result, 120);

    return result;
  }
}

type ListPlansWithStatsQuery = {
  page: number;
  limit: number;
  search?: string;
  sortBy?: 'name' | 'isActive' | 'created_at';
  sortOrder?: 'ASC' | 'DESC';
};

/* 
	⏱️ Request took: 334ms
	⏱️ Request took: 296ms
	⏱️ Request took: 411ms
	⏱️ Request took: 1522ms
*/
