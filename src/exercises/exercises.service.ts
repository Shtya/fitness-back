// src/plan-exercises/plan-exercises.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { CreatePlanExerciseDto, UpdatePlanExerciseDto } from 'dto/exercises.dto';
import { CRUD } from 'common/crud.service';
import { PlanDay, PlanExercise } from 'entities/global.entity';

@Injectable()
export class PlanExercisesService {
  constructor(
    @InjectRepository(PlanExercise) public readonly repo: Repository<PlanExercise>,
    @InjectRepository(PlanDay) private readonly dayRepo: Repository<PlanDay>,
    private readonly dataSource: DataSource,
  ) {}

  async list(q: any) {
    return CRUD.findAll(
      this.repo,
      'plan_exercise',
      q.search,
      q.page,
      q.limit,
      q.sortBy,
      q.sortOrder,
      ['day'], // eager relation if needed
      ['name', 'desc', 'equipment' ], // search fields
      q.filters || {},
    );
  }

  async bulkCreate(items: CreatePlanExerciseDto[]) {
    return this.dataSource.transaction(async manager => {
      const results: PlanExercise[] = [];
      for (const i of items) {
        const day = i.dayId ? await manager.getRepository(PlanDay).findOne({ where: { id: i.dayId } }) : null;
        const entity = manager.getRepository(PlanExercise).create({
          ...i,
          day: day || undefined,
          // img/video are already URL strings – just persist them
        });
        results.push(await manager.getRepository(PlanExercise).save(entity));
      }
      return results;
    });
  }

  async stats() {
    // --- Totals (no filters) ---
    const totals = await this.repo
      .createQueryBuilder('e')
      .select([
        'COUNT(*)::int AS total',
        `SUM(CASE WHEN e.status = 'Active' THEN 1 ELSE 0 END)::int AS active`,
        `SUM(CASE WHEN e.status = 'Inactive' THEN 1 ELSE 0 END)::int AS inactive`,
        `SUM(CASE WHEN e.img IS NOT NULL AND e.img <> '' THEN 1 ELSE 0 END)::int AS with_image`,
        `SUM(CASE WHEN e.video IS NOT NULL AND e.video <> '' THEN 1 ELSE 0 END)::int AS with_video`,
        // QUOTE camelCase:
        `SUM(CASE WHEN e."dayId" IS NOT NULL THEN 1 ELSE 0 END)::int AS linked_to_day`,
        `COALESCE(AVG(e."targetSets"),0)::float AS avg_target_sets`,
        `COALESCE(AVG(e."restSeconds"),0)::float AS avg_rest_seconds`,
        // created_at is snake_case in your DB (from CoreEntity) — keep as is:
        `SUM(CASE WHEN e.created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS created_7d`,
        `SUM(CASE WHEN e.created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS created_30d`,
      ])
      .getRawOne<{
        total: number;
        active: number;
        inactive: number;
        with_image: number;
        with_video: number;
        linked_to_day: number;
        avg_target_sets: number;
        avg_rest_seconds: number;
        created_7d: number;
        created_30d: number;
      }>();

    // --- Top primary muscles (global) ---
    const primaryMusclesTop = await this.repo.query<any[]>(
      `
    SELECT m.muscle AS label, COUNT(*)::int AS count
    FROM (
      SELECT jsonb_array_elements_text(e."primaryMuscles") AS muscle
      FROM "plan_exercises" e
    ) m
    GROUP BY m.muscle
    ORDER BY count DESC
    LIMIT 6
    `,
    );

    // --- Top secondary muscles (global) ---
    const secondaryMusclesTop = await this.repo.query<any[]>(
      `
    SELECT m.muscle AS label, COUNT(*)::int AS count
    FROM (
      SELECT jsonb_array_elements_text(e."secondaryMuscles") AS muscle
      FROM "plan_exercises" e
    ) m
    GROUP BY m.muscle
    ORDER BY count DESC
    LIMIT 6
    `,
    );

    // --- Equipment distribution (global) ---
    const equipmentTop = await this.repo.query<any[]>(
      `
    SELECT e.equipment AS label, COUNT(*)::int AS count
    FROM "plan_exercises" e
    WHERE e.equipment IS NOT NULL AND e.equipment <> ''
    GROUP BY e.equipment
    ORDER BY count DESC
    LIMIT 6
    `,
    );

    return {
      totals: {
        total: totals.total,
        active: totals.active,
        inactive: totals.inactive,
        withImage: totals.with_image,
        withVideo: totals.with_video,
        linkedToDay: totals.linked_to_day,
        avgTargetSets: Number(totals.avg_target_sets?.toFixed?.(2) ?? totals.avg_target_sets),
        avgRestSeconds: Math.round(totals.avg_rest_seconds),
        created7d: totals.created_7d,
        created30d: totals.created_30d,
      },
      top: {
        primaryMuscles: primaryMusclesTop,
        secondaryMuscles: secondaryMusclesTop,
        equipment: equipmentTop,
      },
    };
  }

  async get(id: string) {
    const ex = await this.repo.findOne({
      where: { id },
      relations: ['day'],
    });
    if (!ex) throw new NotFoundException('Exercise not found');
    return ex;
  }

  async create(dto: CreatePlanExerciseDto) {
    const entity = this.repo.create({
      ...dto,
      // `day` relation if dayId provided
      day: dto.dayId ? await this.dayRepo.findOne({ where: { id: dto.dayId } }) : undefined,
    });
    return this.repo.save(entity);
  }

  async update(id: string, dto: UpdatePlanExerciseDto) {
    const ex = await this.get(id);
    if (dto.dayId) {
      const day = await this.dayRepo.findOne({ where: { id: dto.dayId } });
      (ex as any).day = day || null;
      delete (dto as any).dayId;
    }
    Object.assign(ex, dto);
    return this.repo.save(ex);
  }

  async remove(id: string) {
    const ex = await this.get(id);
    await this.repo.remove(ex);
    return { deleted: true, id };
  }

  async updateImage(id: string, path: string) {
    const ex = await this.get(id);
    ex.img = path;
    return this.repo.save(ex);
  }

  async updateVideo(id: string, path: string) {
    const ex = await this.get(id);
    ex.video = path;
    return this.repo.save(ex);
  }
}
