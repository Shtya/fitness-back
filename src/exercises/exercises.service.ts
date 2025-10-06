// src/plan-exercises/plan-exercises.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { CreatePlanExercisesDto, UpdatePlanExercisesDto } from 'dto/exercises.dto';
import { ExerciseVideo, PlanExercises } from 'entities/global.entity';

type PublicExercise = {
  id: string;
  name: string;
  targetSets: number;
  targetReps: string;
  rest: number;
  tempo: string | null;
  img: string | null;
  video: string | null;
};

@Injectable()
export class PlanExercisesService {
  constructor(
    @InjectRepository(PlanExercises) public readonly repo: Repository<PlanExercises>,
    @InjectRepository(ExerciseVideo) private readonly exerciseVideoRepo: Repository<ExerciseVideo>, // Add this
    private readonly dataSource: DataSource,
  ) {}

  async saveExerciseVideo(dto: { userId: string; exerciseName: string; videoUrl: string; workoutDate?: string; setNumber?: number; weight?: number; reps?: number; notes?: string }): Promise<ExerciseVideo> {
    const video = this.exerciseVideoRepo.create({
      userId: dto.userId,
      exerciseName: dto.exerciseName,
      videoUrl: dto.videoUrl,
      workoutDate: dto.workoutDate || new Date().toISOString().split('T')[0],
      setNumber: dto.setNumber,
      weight: dto.weight?.toString(),
      reps: dto.reps,
      notes: dto.notes,
      status: 'pending',
    });

    return await this.exerciseVideoRepo.save(video);
  }

  // NEW: Get user's exercise videos
  async getUserExerciseVideos(userId: string): Promise<ExerciseVideo[]> {
    return await this.exerciseVideoRepo.find({
      where: { userId },
      order: { created_at: 'DESC' },
      relations: ['coach'],
    });
  }

  // NEW: Get videos for coach to review
  async getVideosForCoach(coachId: string, status?: string): Promise<ExerciseVideo[]> {
    const where: any = { coachId };
    if (status) {
      where.status = status;
    }

    return await this.exerciseVideoRepo.find({
      where,
      order: { created_at: 'DESC' },
      relations: ['user'],
    });
  }

  // NEW: Update video status and feedback
  async updateVideoFeedback(videoId: string, coachId: string, feedback: { status: string; coachFeedback: string }): Promise<ExerciseVideo> {
    const video = await this.exerciseVideoRepo.findOne({ where: { id: videoId } });
    if (!video) {
      throw new NotFoundException('Exercise video not found');
    }

    video.coachId = coachId;
    video.status = feedback.status;
    video.coachFeedback = feedback.coachFeedback;

    return await this.exerciseVideoRepo.save(video);
  }

  private toPublic(e: any) {
    return {
      id: e.id,
      name: e.name,
      targetSets: e.targetSets ?? 3,
      targetReps: e.targetReps ?? '10',
      rest: e.rest ?? 90,
      tempo: e.tempo ?? null,
      img: e.img ?? null,
      video: e.video ?? null,
      created_at: e.created_at ?? null, // <- map correctly
    };
  }

  private baseQB(q: any): SelectQueryBuilder<PlanExercises> {
    const qb = this.repo.createQueryBuilder('e');
    if (q?.search) {
      qb.andWhere('e.name ILIKE :s', { s: `%${q.search}%` });
    }
    return qb;
  }

  async list(q: any) {
    const page = Math.max(1, parseInt(q?.page ?? '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(q?.limit ?? '12', 10)));

    // what the client can send
    const sortKey = String(q?.sortBy ?? 'created_at');

    // map to entity properties
    const SORTABLE: Record<string, string> = {
      created_at: 'e.created_at', // entity property
      name: 'e.name',
    };

    const sortByExpr = SORTABLE[sortKey] ?? SORTABLE.created_at;
    const sortOrder: 'ASC' | 'DESC' = String(q?.sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const qb = this.baseQB(q)
      .orderBy(sortByExpr, sortOrder)
      // optional: add stable secondary order to keep pagination consistent
      .addOrderBy('e.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      total_records: total,
      current_page: page,
      per_page: limit,
      records: rows.map(r => this.toPublic(r)),
    };
  }

  async stats(q?: any) {
    // simple stats for your KPIs; feel free to grow later
    const totals = await this.repo.createQueryBuilder('e').select(['COUNT(*)::int AS total', `SUM(CASE WHEN e.img   IS NOT NULL AND e.img   <> '' THEN 1 ELSE 0 END)::int AS with_image`, `SUM(CASE WHEN e.video IS NOT NULL AND e.video <> '' THEN 1 ELSE 0 END)::int AS with_video`, `COALESCE(AVG(e.rest),0)::float AS avg_rest`, `COALESCE(AVG(e."targetSets"),0)::float AS avg_sets`, `SUM(CASE WHEN e.created_at >= NOW() - INTERVAL '7 days'  THEN 1 ELSE 0 END)::int AS created_7d`, `SUM(CASE WHEN e.created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS created_30d`]).getRawOne<{
      total: number;
      with_image: number;
      with_video: number;
      avg_rest: number;
      avg_sets: number;
      created_7d: number;
      created_30d: number;
    }>();

    return {
      totals: {
        total: totals?.total ?? 0,
        withImage: totals?.with_image ?? 0,
        withVideo: totals?.with_video ?? 0,
        avgRest: Math.round(totals?.avg_rest ?? 0),
        avgTargetSets: Number((totals?.avg_sets ?? 0).toFixed(2)),
        created7d: totals?.created_7d ?? 0,
        created30d: totals?.created_30d ?? 0,
      },
    };
  }

  async get(id: string): Promise<PublicExercise> {
    const ex = await this.repo.findOne({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');
    return this.toPublic(ex);
  }

  async create(dto: CreatePlanExercisesDto): Promise<PublicExercise> {
    const entity = this.repo.create({
      name: dto.name,
      targetSets: dto.targetSets ?? 3,
      targetReps: dto.targetReps ?? '10',
      rest: dto.rest ?? 90,
      tempo: dto.tempo ?? null,
      img: dto.img ?? null,
      video: dto.video ?? null,
    } as any);
    const saved = await this.repo.save(entity);
    return this.toPublic(saved);
  }

  async bulkCreate(items: CreatePlanExercisesDto[]): Promise<PublicExercise[]> {
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(PlanExercises);
      const entities: any = items.map(i =>
        repo.create({
          name: i.name,
          targetSets: i.targetSets ?? 3,
          targetReps: i.targetReps ?? '10',
          rest: i.rest ?? 90,
          tempo: i.tempo ?? null,
          img: i.img ?? null,
          video: i.video ?? null,
        } as any),
      );
      const saved = await repo.save(entities);
      return saved.map(s => this.toPublic(s));
    });
  }

  async update(id: string, dto: UpdatePlanExercisesDto): Promise<PublicExercise> {
    const ex: any = await this.repo.findOne({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');

    if (dto.name !== undefined) ex.name = dto.name;
    if (dto.targetSets !== undefined) ex.targetSets = dto.targetSets;
    if (dto.targetReps !== undefined) ex.targetReps = dto.targetReps;
    if (dto.rest !== undefined) ex.rest = dto.rest;
    if (dto.tempo !== undefined) ex.tempo = dto.tempo;
    if (dto.img !== undefined) ex.img = dto.img;
    if (dto.video !== undefined) ex.video = dto.video;

    const saved = await this.repo.save(ex);
    return this.toPublic(saved);
  }

  async remove(id: string) {
    const ex = await this.repo.findOne({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');
    await this.repo.remove(ex);
    return { deleted: true, id };
  }

  async updateImage(id: string, path: string): Promise<PublicExercise> {
    const ex = await this.repo.findOne({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');
    ex.img = path;
    return this.toPublic(await this.repo.save(ex));
  }

  async updateVideo(id: string, path: string): Promise<PublicExercise> {
    const ex = await this.repo.findOne({ where: { id } });
    if (!ex) throw new NotFoundException('Exercise not found');
    ex.video = path;
    return this.toPublic(await this.repo.save(ex));
  }
}
