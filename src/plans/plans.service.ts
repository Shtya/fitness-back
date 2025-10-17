// src/plans/plans.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, EntityManager } from 'typeorm';
import {
  Exercise,
  ExercisePlan,
  ExercisePlanDay,
  ExercisePlanDayExercise,
  User,
  DayOfWeek,
} from 'entities/global.entity';
import { CRUD } from 'common/crud.service';

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

const WEEK_ORDER: Array<'saturday'|'sunday'|'monday'|'tuesday'|'wednesday'|'thursday'|'friday'> =
  ['saturday','sunday','monday','tuesday','wednesday','thursday','friday'];

function toArray<T = any>(v: any): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function parseMaybeJson<T = any>(v: any): T {
  if (v == null) return v as T;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return {} as any;
    try { return JSON.parse(s) as T; } catch { return v as T; }
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
  ) {}

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

  /* ---------- Import (plans/plans.controller: POST /plans/import) ---------- */
  async importAndActivate(body: any) {
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

    // sanity: ensure program.days
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

        // prevent duplicate days within this plan
        const seen = new Set<string>();
        for (const d of days) {
          const norm = String(this.normDay(d?.dayOfWeek ?? d?.id));
          if (seen.has(norm)) throw new BadRequestException(`plans[${index}]: Duplicate day: ${norm}`);
          seen.add(norm);
        }

        // 1) create plan
        const plan = await manager.save(ExercisePlan, manager.create(ExercisePlan, { name: planName, isActive: true }));

        const responseDays: any[] = [];
        let linkedCount = 0;

        // 2) per day: create day and its items
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
          // allow: [{name,...}] OR {exerciseId, orderIndex} OR just string id
          let order = 0;
          const items: ExercisePlanDayExercise[] = [];
          for (const src of exArr) {
            const exId = typeof src === 'string' ? src : (src?.exerciseId || src?.id || null);
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

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return { status: 'error', error: 'User not found' as const };

    if (!user.activeExercisePlanId) return { status: 'none', error: 'No active plan set for this user' as const };

    const active = await this.planRepo.findOne({
      where: { id: user.activeExercisePlanId },
      relations: ['days', 'days.items', 'days.items.exercise'],
    });
    if (!active) return { status: 'none', error: 'Active plan not found' as const };

    return this.planToFrontendShape(active);
  }

  /* ---------- Create with content ---------- */
  async createPlanWithContent(input: any) {
    const { name, isActive = true, program } = input ?? {};
    if (!name) throw new BadRequestException('name is required');
    if (!program?.days?.length) throw new BadRequestException('program.days[] required');

    // no duplicate days
    const seenDays = new Set<string>();
    for (const d of program.days) {
      const k = String(dayEnum(String(d.dayOfWeek ?? d.id).toLowerCase()));
      if (seenDays.has(k)) throw new BadRequestException(`Duplicate day: ${k}`);
      seenDays.add(k);
    }

    return this.dataSource.transaction(async manager => {
      const plan = await manager.save(ExercisePlan, manager.create(ExercisePlan, { name, isActive: !!isActive }));

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

      return this.planToFrontendShape(full as any);
    });
  }

  /* ---------- List / Get Deep ---------- */
  async list(q: any) {
    return CRUD.findAll<ExercisePlan>(
      this.planRepo as any,
      'plan',
      q.search,
      q.page,
      q.limit,
      q.sortBy,
      q.sortOrder,
      // ['days', 'days.items'],
			['days' , 'days.items'  ],
      ['name'],
      {},
    );
  }

  async getOneDeep(id: string) {
    const plan = await this.planRepo.findOne({
      where: { id },
      relations: ['days', 'days.items', 'days.items.exercise'],
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return this.planToFrontendShape(plan);
  }

  /* ---------- Update (days + items) ---------- */
  async updatePlanAndContent(id: string, dto: any) {
    return await this.dataSource.transaction(async manager => {
      const plan = await manager.findOne(ExercisePlan, {
        where: { id },
        relations: ['days', 'days.items', 'days.items.exercise'],
      });
      if (!plan) throw new NotFoundException('Plan not found');

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

      return this.planToFrontendShape(full as any);
    });
  }

  /* ---------- Delete ---------- */
  async remove(id: string) {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    await this.planRepo.remove(plan);
    return { message: 'Plan deleted' };
  }

  /* ---------- Assignments (simplified via User.activeExercisePlanId) ---------- */
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
    _actorId: string,
  ) {
    if (!Array.isArray(dto.athleteIds) || dto.athleteIds.length === 0) {
      throw new BadRequestException('athleteIds[] required');
    }

    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const uniqueIds = [...new Set(dto.athleteIds)];

    // only set pointer now if dates include "now"
    const now = new Date();
    const startOk = !dto.startDate || new Date(dto.startDate) <= now;
    const endOk = !dto.endDate || new Date(dto.endDate) >= now;
    const shouldPointUserNow = (dto.isActive !== false) && startOk && endOk;

    await this.dataSource.transaction(async manager => {
      const users = await manager.find(User, { where: { id: In(uniqueIds) } });
      if (users.length !== uniqueIds.length) {
        const got = new Set(users.map(u => u.id));
        const missing = uniqueIds.filter(id => !got.has(id));
        throw new NotFoundException(`Athlete(s) not found: ${missing.join(', ')}`);
      }

      for (const u of users) {
        await manager.update(User, { id: u.id }, { activeExercisePlanId: shouldPointUserNow ? planId : null });
      }
    });

    return this.listAssignees(planId);
  }

  async listAssignees(planId: string) {
    // no join-table: just return users pointing to this plan
    const users = await this.userRepo.find({ where: { activeExercisePlanId: planId } });
    return users;
  }

  /* ---------- FE shape ---------- */
  planToFrontendShape(plan: ExercisePlan) {
    const daysRaw = Array.isArray((plan as any)?.days) ? (plan as any).days : [];

    const days = daysRaw
      .map((d: ExercisePlanDay & { items?: ExercisePlanDayExercise[] }) => {
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
      program: { days },
    };
  }

  /* ---------- KPIs (light) ---------- */
  async listPlansWithStats(q: ListPlansWithStatsQuery) {
    const search = (q.search || '').trim();
    const where = search ? 'p.name ILIKE :search' : '1=1';
    const params: any = search ? { search: `%${search}%` } : {};

    const agg = await this.planRepo
      .createQueryBuilder('p')
      .leftJoin('p.days', 'd')
      .leftJoin('d.items', 'i')
      .where(where, params)
      .select('COUNT(DISTINCT p.id)', 'plansTotal')
      .addSelect('COUNT(DISTINCT CASE WHEN p.isActive = true THEN p.id END)', 'plansActive')
      .addSelect('COUNT(DISTINCT d.id)', 'days')
      .addSelect('COUNT(DISTINCT i.id)', 'items')
      .getRawOne<{ plansTotal: string; plansActive: string; days: string; items: string }>();

    return {
      summary: {
        plans: {
          total: Number(agg?.plansTotal || 0),
          active: Number(agg?.plansActive || 0),
        },
        structure: {
          days: Number(agg?.days || 0),
          items: Number(agg?.items || 0),
        },
      },
    };
  }
}

type ListPlansWithStatsQuery = {
  page: number;
  limit: number;
  search?: string;
  sortBy?: 'name' | 'isActive' | 'created_at';
  sortOrder?: 'ASC' | 'DESC';
};
