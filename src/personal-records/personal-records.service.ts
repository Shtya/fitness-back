import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AttemptPrDto, CreatePersonalRecordDto, QueryPrDto, UpdatePersonalRecordDto } from 'dto/personal-records.dto';
import { PersonalRecord, PersonalRecordAttempt, User } from 'entities/global.entity';
import { Repository, FindOptionsWhere, Between, Raw } from 'typeorm';
import { randomUUID } from 'crypto';

type SetInput = { id: string; weight: number; reps: number; done: boolean; setNumber: number };

@Injectable()
export class PersonalRecordsService {
  constructor(
    @InjectRepository(PersonalRecord) private readonly prRepo: Repository<PersonalRecord>,
    @InjectRepository(PersonalRecordAttempt) private readonly attRepo: Repository<PersonalRecordAttempt>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  private epley1RM(weight: number, reps: number) {
    return weight * (1 + reps / 30);
  }

  private normalizeRecords(records: SetInput[]): SetInput[] {
    const safe = (n: any) => Math.max(0, Number.isFinite(+n) ? Math.floor(+n) : 0);
    return [...(records ?? [])]
      .map(r => ({
        id: r.id ?? randomUUID(), // <-- assign here
        weight: safe(r.weight),
        reps: safe(r.reps),
        done: !!r.done,
        setNumber: safe(r.setNumber) || 1,
      }))
      .sort((a, b) => a.setNumber - b.setNumber);
  }

  private deepEqual(a: any, b: any) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /** Create-or-edit same day. No-op if identical. Also rebuilds attempts fan-out. */
  async create(userId: string, dto: CreatePersonalRecordDto) {
    await this.ensureUser(userId);

    // normalize first
    const norm = this.normalizeRecords(dto.records as any)
      // ensure all records have ids
      .map(r => ({ ...r, id: r.id ?? randomUUID() }));

    const existing = await this.prRepo.findOne({
      where: { userId, exerciseName: dto.exerciseName, date: dto.date },
    });

    if (existing) {
      const prev = this.normalizeRecords((existing as any).records || []);
      // also map prev to include id defaulting (so equality is fair if client omitted ids)
      const prevWithIds = prev.map((r: any) => ({ ...r, id: r.id ?? randomUUID() }));

      if (this.deepEqual(prevWithIds, norm)) return existing;

      (existing as any).records = norm;
      const saved = await this.prRepo.save(existing);
      await this.rebuildAttemptsForDay(userId, saved);
      return saved;
    }

    const pr = this.prRepo.create({
      userId,
      exerciseName: dto.exerciseName,
      date: dto.date,
      records: norm,
    } as any);

    const saved: any = await this.prRepo.save(pr);
    await this.rebuildAttemptsForDay(userId, saved);
    return saved;
  }

  // personal-records.service.ts

  async attempt(userId: string, dto: any) {
    await this.ensureUser(userId);

    let day: any = await this.prRepo.findOne({
      where: { userId, exerciseName: dto.exerciseName, date: dto.date },
    });

    // normalize incoming single set
    const incoming = this.normalizeRecords([dto.set])[0];

    if (!day) {
      // brand-new day: ensure id exists
      if (!incoming.id) incoming.id = randomUUID();

      day = this.prRepo.create({
        userId,
        exerciseName: dto.exerciseName,
        date: dto.date,
        records: [incoming],
      } as any);

      const saved = await this.prRepo.save(day);
      await this.rebuildAttemptsForDay(userId, saved);
      return saved;
    }

    // merge/replace by setNumber
    const recs: any[] = this.normalizeRecords((day as any).records || []);
    const idx = recs.findIndex(s => s.setNumber === incoming.setNumber);

    if (idx === -1) {
      // appending a new set: give it an id if missing
      if (!incoming.id) incoming.id = randomUUID();
      recs.push(incoming);
    } else {
      // replacing existing: preserve existing id if client didn't send one
      const existingSet = recs[idx];
      recs[idx] = {
        id: incoming.id ?? existingSet?.id ?? randomUUID(),
        weight: incoming.weight,
        reps: incoming.reps,
        done: incoming.done,
        setNumber: incoming.setNumber,
      };
    }

    const prev = this.normalizeRecords((day as any).records || []);
    const next = this.normalizeRecords(recs);

    if (this.deepEqual(prev, next)) return day;

    (day as any).records = next;
    const saved = await this.prRepo.save(day);
    await this.rebuildAttemptsForDay(userId, saved);
    return saved;
  }

  /** Rebuild attempts (delete + insert per set) and mark PRs for that exercise. */
  private async rebuildAttemptsForDay(userId: string, pr: PersonalRecord) {
    await this.attRepo.delete({ userId, exerciseName: pr.exerciseName, date: pr.date });

    const records: SetInput[] = this.normalizeRecords((pr as any).records || []);

    // current all-time max before today's insert
    const prevMaxRow = await this.attRepo.createQueryBuilder('a').select('MAX(a.e1rm)', 'mx').where('a.userId = :userId AND a.exerciseName = :ex', { userId, ex: pr.exerciseName }).getRawOne<{ mx: string | null }>();
    const prevAllTime = Number(prevMaxRow?.mx ?? 0);

    let todaysMax = prevAllTime;

    for (const r of records) {
      const e1rm = this.epley1RM(r.weight, r.reps);
      if (e1rm > todaysMax) todaysMax = e1rm;

      await this.attRepo.save(
        this.attRepo.create({
          userId,
          exerciseName: pr.exerciseName,
          recordId: pr.id,
          recordSetId: r.id ?? null,
          setIndex: r.setNumber ?? null,
          weight: r.weight,
          reps: r.reps,
          e1rm,
          date: pr.date,
          isPr: false,
          sessionId: null,
        }),
      );
    }

    // mark only today's max if it beats all-time
    if (todaysMax > prevAllTime) {
      // optional: unflag all previous PRs for this exercise
      await this.attRepo.createQueryBuilder().update().set({ isPr: false }).where('userId = :userId AND exerciseName = :ex', { userId, ex: pr.exerciseName }).execute();

      await this.attRepo
        .createQueryBuilder()
        .update()
        .set({ isPr: true })
        .where('userId = :userId AND exerciseName = :ex AND date = :d AND e1rm = :mx', {
          userId,
          ex: pr.exerciseName,
          d: pr.date,
          mx: todaysMax,
        })
        .execute();
    }
  }

  /** List/filter/paginate current user daily records */
  async list(userId: string, q: QueryPrDto) {
    const where: FindOptionsWhere<PersonalRecord> = { userId };

    if (q.exerciseName) (where as any).exerciseName = q.exerciseName;

    if (q.from && q.to) (where as any).date = Between(q.from, q.to);
    else if (q.from) (where as any).date = Between(q.from, q.from);
    else if (q.to) (where as any).date = Between(q.to, q.to);

    // JSONB filter for done=true/false across any set
    if (q.done === 'true') {
      (where as any).records = Raw(() => `EXISTS (SELECT 1 FROM jsonb_array_elements(records) s WHERE (s->>'done')::boolean = true)`);
    }
    if (q.done === 'false') {
      (where as any).records = Raw(() => `NOT EXISTS (SELECT 1 FROM jsonb_array_elements(records) s WHERE (s->>'done')::boolean = true)`);
    }

    const [items, total] = await this.prRepo.findAndCount({
      where,
      order: { [q.sortBy ?? 'updatedAt']: (q.sortOrder ?? 'DESC') as any },
      take: q.limit ?? 20,
      skip: q.offset ?? 0,
    });

    return { total, items };
  }

  async get(userId: string, id: string) {
    const pr = await this.prRepo.findOne({ where: { id } });
    if (!pr) throw new NotFoundException('PR not found');
    if (pr.userId !== userId) throw new ForbiddenException();
    return pr;
  }

  async update(userId: string, id: string, dto: UpdatePersonalRecordDto) {
    const pr = await this.get(userId, id);

    // if changing date+exercise, ensure unique constraint won't collide
    if ((dto.exerciseName && dto.exerciseName !== pr.exerciseName) || (dto.date && dto.date !== pr.date)) {
      const conflict = await this.prRepo.findOne({
        where: {
          userId,
          exerciseName: dto.exerciseName ?? pr.exerciseName,
          date: dto.date ?? pr.date,
        },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictException('Daily record already exists for this exercise and date.');
      }
    }

    // update fields
    if (dto.exerciseName !== undefined) (pr as any).exerciseName = dto.exerciseName;
    if (dto.date !== undefined) (pr as any).date = dto.date;
    if (dto.records !== undefined) (pr as any).records = this.normalizeRecords(dto.records as any);

    const saved = await this.prRepo.save(pr);
    await this.rebuildAttemptsForDay(userId, saved);
    return saved;
  }

  async remove(userId: string, id: string) {
    const pr = await this.get(userId, id);
    await this.prRepo.remove(pr);
    // attempts cascade via FK (recordId)
    return { ok: true };
  }

  private async ensureUser(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } as any });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ---------- Stats ----------
  async e1rmSeries(userId: string, exerciseName: string, bucket: 'day' | 'week' | 'month', windowDays = 90) {
    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    const sinceStr = since.toISOString().slice(0, 10);

    const qb = this.attRepo.createQueryBuilder('a').select(`date_trunc(:bucket, a.date::timestamp)`, 'bucket').addSelect('MAX(a.e1rm)', 'max_e1rm').where('a.userId = :userId', { userId }).andWhere('a.exerciseName = :exerciseName', { exerciseName }).andWhere('a.date >= :since', { since: sinceStr }).groupBy('1').orderBy('1', 'ASC').setParameters({ bucket });

    const rows = await qb.getRawMany<{ bucket: string; max_e1rm: string }>();
    return rows.map(r => ({ bucket: r.bucket, e1rm: Number(r.max_e1rm) }));
  }

  async overview(userId: string, windowDays = 30) {
    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    const sinceStr = since.toISOString().slice(0, 10);

    const [totalExercises, totalAttempts, totalPrs, recentPrs] = await Promise.all([this.attRepo.createQueryBuilder('a').select('COUNT(DISTINCT a.exerciseName)', 'cnt').where('a.userId = :userId', { userId }).getRawOne<{ cnt: string }>(), this.attRepo.createQueryBuilder('a').select('COUNT(1)', 'cnt').where('a.userId = :userId', { userId }).getRawOne<{ cnt: string }>(), this.attRepo.createQueryBuilder('a').select('COUNT(1)', 'cnt').where('a.userId = :userId AND a.isPr = true', { userId }).getRawOne<{ cnt: string }>(), this.attRepo.createQueryBuilder('a').select('COUNT(1)', 'cnt').where('a.userId = :userId AND a.isPr = true AND a.date >= :since', { userId, since: sinceStr }).getRawOne<{ cnt: string }>()]);

    // Current “bests” per exercise: max e1rm all-time
    const bests = await this.attRepo.createQueryBuilder('a').select(['a.exerciseName AS name', 'MAX(a.e1rm) AS e1rm']).where('a.userId = :userId', { userId }).groupBy('a.exerciseName').orderBy('e1rm', 'DESC').getRawMany();

    // Improvement rate last N days vs all-time
    const improvements = await this.attRepo.query(
      `
      WITH recent AS (
        SELECT exercise_name, MAX(e1rm) AS e1rm_recent
        FROM personal_record_attempts
        WHERE user_id = $1 AND date >= $2
        GROUP BY 1
      ),
      alltime AS (
        SELECT exercise_name, MAX(e1rm) AS e1rm_all
        FROM personal_record_attempts
        WHERE user_id = $1
        GROUP BY 1
      )
      SELECT a.exercise_name AS name,
             COALESCE(r.e1rm_recent, 0) AS recent_max,
             a.e1rm_all AS alltime_max,
             CASE WHEN a.e1rm_all > 0 THEN ROUND(100.0 * (COALESCE(r.e1rm_recent,0) - a.e1rm_all) / a.e1rm_all, 2)
                  ELSE NULL END AS pct_change
      FROM alltime a
      LEFT JOIN recent r ON r.exercise_name = a.exercise_name
      ORDER BY pct_change DESC NULLS LAST;
      `,
      [userId, sinceStr],
    );

    // Streak: consecutive days with at least one attempt
    const streakRows = await this.attRepo.query(
      `
      WITH days AS (
        SELECT DISTINCT date
        FROM personal_record_attempts
        WHERE user_id = $1
      ),
      seq AS (
        SELECT date, ROW_NUMBER() OVER (ORDER BY date DESC) AS rn
        FROM days
      )
      SELECT COALESCE(MAX(streak_len), 0) AS current_streak
      FROM (
        SELECT DATE(date) - rn * INTERVAL '1 day' AS grp, COUNT(*) AS streak_len
        FROM seq
        GROUP BY 1
      ) t
      `,
      [userId],
    );
    const currentStreak = Number(streakRows?.[0]?.current_streak ?? 0);

    return {
      totals: {
        exercisesTracked: Number(totalExercises?.cnt ?? 0),
        attempts: Number(totalAttempts?.cnt ?? 0),
        allTimePrs: Number(totalPrs?.cnt ?? 0),
        recentPrs: Number(recentPrs?.cnt ?? 0),
        currentStreakDays: currentStreak || 0,
      },
      bests, // [{ name, e1rm }]
      improvements, // [{ name, recent_max, alltime_max, pct_change }]
    };
  }

  async topSets(userId: string, exerciseName: string, top = 5) {
    const byWeight = await this.attRepo.find({
      where: { userId, exerciseName },
      order: { weight: 'DESC', reps: 'DESC', date: 'DESC' },
      take: top,
    });
    const byReps = await this.attRepo.find({
      where: { userId, exerciseName },
      order: { reps: 'DESC', weight: 'DESC', date: 'DESC' },
      take: top,
    });
    const byE1rm = await this.attRepo.find({
      where: { userId, exerciseName },
      order: { e1rm: 'DESC' as any, date: 'DESC' },
      take: top,
    });
    return { byWeight, byReps, byE1rm };
  }

  async attemptsHistory(userId: string, exerciseName: string) {
    return this.attRepo.find({
      where: { userId, exerciseName },
      order: { date: 'ASC', createdAt: 'ASC' },
    });
  }
}
