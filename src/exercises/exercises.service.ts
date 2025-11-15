// src/exercises/exercises.service.ts
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import { Exercise, ExerciseVideo, UserRole } from 'entities/global.entity';
import { RedisService } from 'src/redis/redis.service';

type PublicExercise = {
  id: string;
  name: string;
  details: string | null;
  category: string | null;
  primaryMusclesWorked: string[];
  secondaryMusclesWorked: string[];
  targetSets: number;
  targetReps: string;
  rest: number;
  tempo: string | null;
  img: string | null;
  video: string | null;
  created_at?: string | null;
};

type CreateExerciseInput = {
  name: string;
  details?: string | null;
  category?: string | null;
  primaryMusclesWorked?: string[];
  secondaryMusclesWorked?: string[];
  targetSets?: number;
  targetReps?: string;
  rest?: number;
  tempo?: string | null;
  img?: string | null;
  video?: string | null;
  userId?: string | null;
};

type UpdateExerciseInput = Partial<CreateExerciseInput>;

@Injectable()
export class ExercisesService {
  constructor(
    @InjectRepository(Exercise) public readonly repo: Repository<Exercise>,
    @InjectRepository(ExerciseVideo) private readonly exerciseVideoRepo: Repository<ExerciseVideo>,
    private readonly dataSource: DataSource,
    private redisService: RedisService,
  ) {}

  async saveExerciseVideo(dto: { userId: string; exerciseName: string; videoUrl: string; workoutDate?: string; setNumber?: number; weight?: number; reps?: number; notes?: string }) {
    const video = this.exerciseVideoRepo.create({
      userId: dto.userId,
      exerciseName: dto.exerciseName,
      videoUrl: dto.videoUrl,
      workoutDate: dto.workoutDate || new Date().toISOString().split('T')[0],
      setNumber: dto.setNumber ?? null,
      weight: dto.weight?.toString() ?? null,
      reps: dto.reps ?? null,
      notes: dto.notes ?? null,
      status: 'pending',
    });

    return await this.exerciseVideoRepo.save(video);
  }

  async getUserExerciseVideos(userId: string) {
    const cacheKey = `exercise_videos:user:${userId}`;

    // Try cache first
    const cachedResult = await this.redisService.get<any[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const result = await this.exerciseVideoRepo.find({
      where: { userId },
      order: { created_at: 'DESC' },
      relations: ['coach', 'user'],
    });

    // Cache for 2 minutes
    await this.redisService.set(cacheKey, result, 120);

    return result;
  }

  async getVideosForCoach(coachId: string, status?: string) {
    const cacheKey = `exercise_videos:coach:${coachId}:${status || 'all'}`;

    // Try cache first
    const cachedResult = await this.redisService.get<any[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const where: any = { coachId };
    if (status) where.status = status;

    const result = await this.exerciseVideoRepo.find({
      where,
      order: { created_at: 'DESC' },
      relations: ['user'],
    });

    // Cache for 2 minutes
    await this.redisService.set(cacheKey, result, 120);

    return result;
  }

  async updateVideoFeedback(videoId: string, coachId: string, feedback: { status: string; coachFeedback: string }) {
    const video = await this.exerciseVideoRepo.findOne({ where: { id: videoId } });
    if (!video) throw new NotFoundException('Exercise video not found');

    video.coachId = coachId;
    video.status = feedback.status;
    video.coachFeedback = feedback.coachFeedback;

    const result = await this.exerciseVideoRepo.save(video);

    // Invalidate relevant caches
    await this.invalidateVideoCaches(video.userId, coachId);

    return result;
  }

  private toPublic(e: Exercise): PublicExercise {
    return {
      id: e.id,
      name: e.name,
      details: e.details ?? null,
      category: e.category ?? null,
      primaryMusclesWorked: Array.isArray(e.primaryMusclesWorked) ? e.primaryMusclesWorked : [],
      secondaryMusclesWorked: Array.isArray(e.secondaryMusclesWorked) ? e.secondaryMusclesWorked : [],
      targetSets: e.targetSets ?? 3,
      targetReps: e.targetReps ?? '10',
      rest: e.rest ?? 90,
      tempo: e.tempo ?? null,
      img: e.img ?? null,
      video: e.video ?? null,
      created_at: (e as any).created_at ?? null,
    };
  }

  private baseQB(q: any, adminId: string): SelectQueryBuilder<Exercise> {
    const qb = this.repo.createQueryBuilder('e');
    qb.andWhere('(e."adminId" IS NULL OR e."adminId" = :adminId)', { adminId });

    if (q?.category) qb.andWhere('e.category ILIKE :c', { c: `%${q.category}%` });
    if (q?.search) {
      const s = String(q.search).trim();
      const like = `%${s}%`;
      const terms = s.split(/\s+/).filter(Boolean);

      // Build a lightweight full text expression (no unaccent)
      const TS_EXPR = `(
      setweight(to_tsvector('simple', coalesce(e.name, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(e.category, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(e.details, '')), 'C') ||
      setweight(to_tsvector('simple', array_to_string(e."primaryMusclesWorked", ' ')), 'B') ||
      setweight(to_tsvector('simple', array_to_string(e."secondaryMusclesWorked", ' ')), 'C')
    )`;

      // Rank by full-text match; fallback to ILIKE across key fields/arrays
      qb.addSelect(`ts_rank(${TS_EXPR}, websearch_to_tsquery('simple', :q))`, 'rank');

      qb.andWhere(
        `(
        ${TS_EXPR} @@ websearch_to_tsquery('simple', :q)
        OR e.name ILIKE :like
        OR e.category ILIKE :like
        OR e.details ILIKE :like
        OR EXISTS (SELECT 1 FROM unnest(e."primaryMusclesWorked") pm WHERE pm ILIKE :like)
        OR EXISTS (SELECT 1 FROM unnest(e."secondaryMusclesWorked") sm WHERE sm ILIKE :like)
      )`,
        { q: s, like },
      );

      terms.forEach((t, i) => {
        const k = `t${i}`;
        qb.andWhere(`(e.name ILIKE :${k} OR e.details ILIKE :${k} OR e.category ILIKE :${k})`, { [k]: `%${t}%` });
      });

      qb.orderBy('rank', 'DESC').addOrderBy('e.created_at', 'DESC').addOrderBy('e.id', 'DESC');
    }

    return qb;
  }

  async list(q: any, userId: string) {
    const page = Math.max(1, parseInt(q?.page ?? '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(q?.limit ?? '12', 10)));
    const sortKey = String(q?.sortBy ?? 'created_at');
    const SORTABLE: Record<string, string> = {
      created_at: 'e.created_at',
      name: 'e.name',
      category: 'e.category',
    };
    const sortByExpr = SORTABLE[sortKey] ?? SORTABLE.created_at;
    const sortOrder: 'ASC' | 'DESC' = String(q?.sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const search = (q?.search ?? '').toString();
    const category = (q?.category ?? '').toString();

    const cacheKey = ['exercises:list', userId || 'anon', page, limit, sortKey, sortOrder, search || '_', category || '_'].join(':');

    // Try cache with Redis service
    const cachedResult = await this.redisService.get<{
      total_records: number;
      current_page: number;
      per_page: number;
      records: PublicExercise[];
    }>(cacheKey);

    if (cachedResult) {
      return cachedResult;
    }

    const qb = this.baseQB(q, userId);

    if (q?.category) qb.andWhere('e.category ILIKE :cat', { cat: `%${q.category}%` });

    qb.orderBy(sortByExpr, sortOrder)
      .addOrderBy('e.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    const result = {
      total_records: total,
      current_page: page,
      per_page: limit,
      records: rows.map(r => this.toPublic(r)),
    };

    // Store in Redis cache for 60 seconds
    await this.redisService.set(cacheKey, result, 60);

    return result;
  }

  async categories(): Promise<string[]> {
    const cacheKey = 'exercises:categories';

    // Try cache first
    const cachedResult = await this.redisService.get<string[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const rows = await this.repo.createQueryBuilder('e').select('DISTINCT e.category', 'category').where("e.category IS NOT NULL AND TRIM(e.category) <> ''").orderBy('e.category', 'ASC').getRawMany<{ category: string }>();

    const result = rows.map(r => r.category);

    // Cache for 10 minutes (categories don't change often)
    await this.redisService.set(cacheKey, result, 600);

    return result;
  }

  async stats(_q?: any, actor?: { id: string; role: UserRole }) {
    const cacheKey = `exercises:stats:${actor?.id || 'global'}`;

    // Try cache first
    const cachedResult = await this.redisService.get<{
      success: boolean;
      totals: {
        totalGlobalExercise: number;
        totalPersonalExercise: number | null;
        withImage: number;
        withVideo: number;
        avgRest: number;
        avgTargetSets: number;
        created7d: number;
        created30d: number;
      };
    }>(cacheKey);

    if (cachedResult) {
      return cachedResult;
    }

    // --- Global statistics (for all exercises) ---
    const global = await this.repo.createQueryBuilder('e').select(['COUNT(*)::int AS total', `SUM(CASE WHEN e.img IS NOT NULL AND e.img <> '' THEN 1 ELSE 0 END)::int AS with_image`, `SUM(CASE WHEN e.video IS NOT NULL AND e.video <> '' THEN 1 ELSE 0 END)::int AS with_video`, `COALESCE(AVG(e.rest),0)::float AS avg_rest`, `COALESCE(AVG(e."targetSets"),0)::float AS avg_sets`, `SUM(CASE WHEN e.created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS created_7d`, `SUM(CASE WHEN e.created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS created_30d`]).getRawOne<{
      total: number;
      with_image: number;
      with_video: number;
      avg_rest: number;
      avg_sets: number;
      created_7d: number;
      created_30d: number;
    }>();

    // --- Get global count separately ---
    const globalCount = global?.total ?? 0;

    // --- Get personal count (only if admin) ---
    let personalCount: number | null = null;
    if (actor?.role === UserRole.ADMIN) {
      const personal = await this.repo.createQueryBuilder('e').where('e."adminId" = :adminId', { adminId: actor.id }).select('COUNT(*)::int', 'count').getRawOne<{ count: number }>();
      personalCount = personal?.count ?? 0;
    }

    // --- Return all stats (all metrics global, only counts separated) ---
    const result = {
      success: true,
      totals: {
        totalGlobalExercise: globalCount,
        totalPersonalExercise: actor?.role === UserRole.ADMIN ? personalCount : null,
        withImage: global?.with_image ?? 0,
        withVideo: global?.with_video ?? 0,
        avgRest: Math.round(global?.avg_rest ?? 0),
        avgTargetSets: Number((global?.avg_sets ?? 0).toFixed(2)),
        created7d: global?.created_7d ?? 0,
        created30d: global?.created_30d ?? 0,
      },
    };

    // Cache for 5 minutes
    await this.redisService.set(cacheKey, result, 300);

    return result;
  }

  async bulkCreate(items: CreateExerciseInput[]) {
    const result = await this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(Exercise);

      const rows = items.map(i => ({
        name: i.name,
        details: i.details ?? null,
        category: i.category ?? null,
        primaryMusclesWorked: i.primaryMusclesWorked ?? [],
        secondaryMusclesWorked: i.secondaryMusclesWorked ?? [],
        targetSets: i.targetSets ?? 3,
        targetReps: i.targetReps ?? '10',
        rest: i.rest ?? 90,
        tempo: i.tempo ?? null,
        img: i.img ?? null,
        video: i.video ?? null,
      }));

      const result = await repo.insert(rows);
      const ids = result.identifiers.map(x => x.id).filter(Boolean);

      const fresh = ids.length ? await repo.find({ where: { id: In(ids) } }) : await repo.find({ order: { id: 'DESC' }, take: rows.length }); // fallback

      return fresh.map(e => this.toPublic(e));
    });

    // Invalidate exercises cache after bulk create
    await this.invalidateExercisesCache();

    return result;
  }

  async get(id: string): Promise<PublicExercise> {
    const cacheKey = `exercise:${id}`;

    // Try cache first
    const cachedResult = await this.redisService.get<PublicExercise>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const ex = await this.repo.findOne({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');

    const result = this.toPublic(ex);

    // Cache for 5 minutes
    await this.redisService.set(cacheKey, result, 300);

    return result;
  }

  async create(dto: CreateExerciseInput): Promise<PublicExercise> {
    const entity = this.repo.create({
      name: dto.name,
      details: dto.details ?? null,
      category: dto.category ?? null,
      primaryMusclesWorked: dto.primaryMusclesWorked ?? [],
      secondaryMusclesWorked: dto.secondaryMusclesWorked ?? [],
      targetSets: dto.targetSets ?? 3,
      targetReps: dto.targetReps ?? '10',
      rest: dto.rest ?? 90,
      tempo: dto.tempo ?? null,
      img: dto.img ?? null,
      video: dto.video ?? null,
      adminId: dto.userId,
    } as any);
    const saved: any = await this.repo.save(entity);

    const result = this.toPublic(saved);

    // Invalidate exercises cache after creation
    await this.invalidateExercisesCache();

    return result;
  }

  async update(id: string, dto: UpdateExerciseInput): Promise<PublicExercise> {
    const ex = await this.repo.findOne({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');

    if (dto.name !== undefined) ex.name = dto.name;
    if (dto.details !== undefined) ex.details = dto.details;
    if (dto.category !== undefined) ex.category = dto.category;
    if (dto.primaryMusclesWorked !== undefined) ex.primaryMusclesWorked = dto.primaryMusclesWorked ?? [];
    if (dto.secondaryMusclesWorked !== undefined) ex.secondaryMusclesWorked = dto.secondaryMusclesWorked ?? [];
    if (dto.targetSets !== undefined) ex.targetSets = dto.targetSets;
    if (dto.targetReps !== undefined) ex.targetReps = dto.targetReps;
    if (dto.rest !== undefined) ex.rest = dto.rest;
    if (dto.tempo !== undefined) ex.tempo = dto.tempo;
    if (dto.img !== undefined) ex.img = dto.img;
    if (dto.video !== undefined) ex.video = dto.video;

    const saved = await this.repo.save(ex);
    const result = this.toPublic(saved);

    // Invalidate caches after update
    await this.invalidateExerciseCaches(id);

    return result;
  }

  async remove(id: string, actor?: { id: string; role: UserRole; lang?: string }) {
    const ex = await this.repo.findOne({ where: { id } });
    const lang = actor?.lang === 'ar' ? 'ar' : 'en';

    if (!ex) {
      throw new NotFoundException(lang === 'ar' ? 'التمرين غير موجود' : 'Exercise not found');
    }

    if (actor?.role === UserRole.SUPER_ADMIN) {
      await this.repo.remove(ex);
    } else if (actor?.role === UserRole.ADMIN) {
      if (ex.adminId !== actor.id) {
        throw new ForbiddenException(lang === 'ar' ? 'لا يمكنك حذف التمارين التي لم تنشئها' : 'You can only delete exercises you created.');
      }
      await this.repo.remove(ex);
    } else {
      throw new ForbiddenException(lang === 'ar' ? 'غير مسموح بحذف التمارين' : 'Not allowed to delete exercises.');
    }

    // Invalidate caches after deletion
    await this.invalidateExerciseCaches(id);

    return {
      deleted: true,
      id,
      message: lang === 'ar' ? 'تم حذف التمرين بنجاح' : 'Exercise deleted successfully',
    };
  }

  async updateImage(id: string, path: string): Promise<PublicExercise> {
    const ex = await this.repo.findOne({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');
    ex.img = path;
    const result = this.toPublic(await this.repo.save(ex));

    // Invalidate caches after image update
    await this.invalidateExerciseCaches(id);

    return result;
  }

  async updateVideo(id: string, path: string): Promise<PublicExercise> {
    const ex = await this.repo.findOne({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');
    ex.video = path;
    const result = this.toPublic(await this.repo.save(ex));

    // Invalidate caches after video update
    await this.invalidateExerciseCaches(id);

    return result;
  }

  /* ---------- Cache Invalidation Methods ---------- */
  private async invalidateExercisesCache() {
    const pattern = 'exercises:list:*';
    await this.redisService.deletePattern(pattern);
    await this.redisService.deletePattern('exercises:categories');
    await this.redisService.deletePattern('exercises:stats:*');
  }

  private async invalidateExerciseCaches(exerciseId: string) {
    // Invalidate specific exercise cache
    await this.redisService.del(`exercise:${exerciseId}`);

    // Invalidate lists and other caches
    await this.invalidateExercisesCache();
  }

  private async invalidateVideoCaches(userId: string, coachId: string) {
    // Invalidate user video cache
    await this.redisService.del(`exercise_videos:user:${userId}`);

    await this.redisService.deletePattern(`exercise_videos:coach:${coachId}:*`);
  }
}
