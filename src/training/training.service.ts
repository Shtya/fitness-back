// src/training/training.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, Repository } from 'typeorm';
import { DayOfWeek, ExercisePR, Plan, PlanDay, SessionSet, User, WorkoutSession } from 'entities/global.entity';
import { UpsertDailyPrDto } from 'dto/daily-pr.dto';
 
// FE uses Epley in the page too
const epley = (w: number, r: number) => Math.round((Number(w) || 0) * (1 + (Number(r) || 0) / 30));

function yyyyMmDd(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
function jsDayToEnum(d: number): DayOfWeek {
  // JS: 0=Sun..6=Sat | Your enum doesn’t have FRIDAY; your UI never uses it either.
  const map: Record<number, DayOfWeek> = {
    0: DayOfWeek.SUNDAY,
    1: DayOfWeek.MONDAY,
    2: DayOfWeek.TUESDAY,
    3: DayOfWeek.WEDNESDAY,
    4: DayOfWeek.THURSDAY,
    5: DayOfWeek.SATURDAY, // fallback
    6: DayOfWeek.SATURDAY,
  };
  return map[d] ?? DayOfWeek.MONDAY;
}

@Injectable()
export class TrainingService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
    @InjectRepository(PlanDay) private readonly planDays: Repository<PlanDay>,
    @InjectRepository(WorkoutSession) private readonly sessions: Repository<WorkoutSession>,
    @InjectRepository(SessionSet) private readonly sets: Repository<SessionSet>,
    @InjectRepository(ExercisePR) private readonly prs: Repository<ExercisePR>,
  ) {}

  private async ensureUser(userId: string) {
    const u = await this.users.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  // return active plan day name for a date (optional)
  private async findPlanNameForDate(userId: string, dateISO: string) {
    const plan = await this.plans.findOne({
      where: { athlete: { id: userId }, isActive: true },
      relations: { days: true },
    });
    if (!plan) return { day: jsDayToEnum(new Date(dateISO).getDay()), name: 'Workout' };

    const js = new Date(dateISO).getDay();
    const dayEnum = jsDayToEnum(js);
    const match = (plan.days || []).find((d) => d.day === dayEnum);
    return { day: dayEnum, name: match?.name || 'Workout' };
  }

  private async findOrCreateSession(userId: string, dateISO: string) {
    let session = await this.sessions.findOne({
      where: { user: { id: userId }, date: dateISO },
      relations: { user: true },
    });
    if (session) return session;

    const user = await this.ensureUser(userId);
    const { day, name } = await this.findPlanNameForDate(userId, dateISO);

    session = this.sessions.create({
      user,
      date: dateISO,
      name,
      day,
      startedAt: null,
      endedAt: null,
      durationSec: null,
    });
    return this.sessions.save(session);
  }

  private async upsertSet(
    sessionId: string,
    dateISO: string,
    exerciseName: string,
    setNumber: number,
    weight: number,
    reps: number,
    done: boolean,
    planExerciseId?: string | null,
  ) {
    let row = await this.sets.findOne({
      where: { session: { id: sessionId }, exerciseName, setNumber },
      relations: { session: true },
    });
    if (!row) {
      row = this.sets.create({
        session: { id: sessionId } as any,
        date: dateISO,
        exerciseName,
        setNumber,
        weight: (Number(weight) || 0).toFixed(2) as unknown as any, // stored as numeric(string) in entity
        reps: Number(reps) || 0,
        done: !!done,
        e1rm: null,
        isPr: false,
        planExerciseId: planExerciseId ?? null,
      });
    } else {
      row.weight = (Number(weight) || 0).toFixed(2) as unknown as any;
      row.reps = Number(reps) || 0;
      row.done = !!done;
    }

    // compute e1rm + PR
    const e = epley(Number(row.weight), row.reps);
    row.e1rm = isFinite(e) ? e : null;
    const saved = await this.sets.save(row);
    await this.updatePR(saved);
    return saved;
  }

  private async updatePR(set: SessionSet) {
    if (!set.e1rm || set.e1rm <= 0) return;

    const session = await this.sessions.findOne({ where: { id: set.session.id }, relations: { user: true } });
    const userId = session?.user?.id!;
    let pr = await this.prs.findOne({ where: { user: { id: userId }, exerciseName: set.exerciseName }, relations: { user: true } });

    if (!pr) {
      pr = this.prs.create({
        user: { id: userId } as any,
        exerciseName: set.exerciseName,
        bestE1rm: set.e1rm,
        weightAtBest: set.weight,
        repsAtBest: set.reps,
        dateOfBest: set.date,
      });
      await this.prs.save(pr);
      set.isPr = true;
      await this.sets.save(set);
      return;
    }

    if (set.e1rm > pr.bestE1rm) {
      pr.bestE1rm = set.e1rm;
      pr.weightAtBest = set.weight;
      pr.repsAtBest = set.reps;
      pr.dateOfBest = set.date;
      await this.prs.save(pr);
      set.isPr = true;
      await this.sets.save(set);
    }
  }

  // -------- Public API used by controller --------

  async upsertDaily(userId: string, dto: UpsertDailyPrDto) {
    const dateISO = dto.date.slice(0, 10);
    const session = await this.findOrCreateSession(userId, dateISO);

    // Bulk upsert rows
    const saved = await Promise.all(
      (dto.records || []).map((r) =>
        this.upsertSet(session.id, dateISO, dto.exerciseName, r.setNumber, r.weight, r.reps, r.done, null),
      ),
    );

    return {
      sessionId: session.id,
      exerciseName: dto.exerciseName,
      date: dateISO,
      records: saved.map((s) => ({
        id: s.id,
        setNumber: s.setNumber,
        weight: Number(s.weight),
        reps: s.reps,
        done: s.done,
        e1rm: s.e1rm,
        isPr: s.isPr,
      })),
    };
  }

  async upsertAttempt(userId: string, dto: any) {
    const dateISO = dto.date.slice(0, 10);
    const session = await this.findOrCreateSession(userId, dateISO);
    const s = dto.set;

    const saved = await this.upsertSet(
      session.id,
      dateISO,
      dto.exerciseName,
      s.setNumber,
      s.weight,
      s.reps,
      s.done,
      null,
    );

    // Return same shape as /prs for the FE code to find serverId by setNumber
    const sameExerciseRows = await this.sets.find({
      where: { session: { id: session.id }, exerciseName: dto.exerciseName },
      order: { setNumber: 'ASC' },
    });

    return {
      sessionId: session.id,
      exerciseName: dto.exerciseName,
      date: dateISO,
      records: sameExerciseRows.map((x) => ({
        id: x.id,
        setNumber: x.setNumber,
        weight: Number(x.weight),
        reps: x.reps,
        done: x.done,
        e1rm: x.e1rm,
        isPr: x.isPr,
      })),
    };
  }

  async getAttempts(userId: string, exerciseName: string) {
    // join through session → user
    const rows = await this.sets
      .createQueryBuilder('s')
      .innerJoin('s.session', 'sess')
      .where('sess.userId = :userId', { userId })
      .andWhere('s.exerciseName = :exerciseName', { exerciseName })
      .orderBy('s.date', 'DESC')
      .addOrderBy('s.setNumber', 'ASC')
      .getMany();

    return rows.map((r) => ({
      date: r.date,
      weight: Number(r.weight),
      reps: r.reps,
      e1rm: r.e1rm ?? 0,
      setIndex: r.setNumber,
      isPr: r.isPr,
    }));
  }

  async getTopSets(userId: string, exerciseName: string, top: number) {
    const qb = this.sets
      .createQueryBuilder('s')
      .innerJoin('s.session', 'sess')
      .where('sess.userId = :userId', { userId })
      .andWhere('s.exerciseName = :exerciseName', { exerciseName });

    const all = await qb.getMany();

    const byWeight = [...all]
      .sort((a, b) => Number(b.weight) - Number(a.weight) || b.reps - a.reps)
      .slice(0, top)
      .map((x) => ({ date: x.date, weight: Number(x.weight), reps: x.reps, e1rm: x.e1rm ?? 0 }));
    const byReps = [...all]
      .sort((a, b) => b.reps - a.reps || Number(b.weight) - Number(a.weight))
      .slice(0, top)
      .map((x) => ({ date: x.date, weight: Number(x.weight), reps: x.reps, e1rm: x.e1rm ?? 0 }));
    const byE1rm = [...all]
      .filter((x) => (x.e1rm ?? 0) > 0)
      .sort((a, b) => (b.e1rm ?? 0) - (a.e1rm ?? 0))
      .slice(0, top)
      .map((x) => ({ date: x.date, weight: Number(x.weight), reps: x.reps, e1rm: x.e1rm ?? 0 }));

    return { byWeight, byReps, byE1rm };
    }

  async getE1rmSeries(userId: string, exerciseName: string, bucket: 'day'|'week'|'month'|string, windowDays: number) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - windowDays);
    const sinceISO = since.toISOString().slice(0, 10);

    const rows = await this.sets
      .createQueryBuilder('s')
      .innerJoin('s.session', 'sess')
      .where('sess.userId = :userId', { userId })
      .andWhere('s.exerciseName = :exerciseName', { exerciseName })
      .andWhere('s.date >= :since', { since: sinceISO })
      .andWhere('s.e1rm IS NOT NULL')
      .getMany();

    // bucket by ISO week/month
    const keyFn =
      bucket === 'month'
        ? (d: string) => d.slice(0, 7) // YYYY-MM
        : bucket === 'day'
        ? (d: string) => d
        : (d: string) => {
            // week key: YYYY-Www
            const dt = new Date(d + 'T00:00:00Z');
            const firstJan = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
            const day = Math.floor((dt.getTime() - firstJan.getTime()) / 86400000) + firstJan.getUTCDay();
            const week = Math.ceil(day / 7).toString().padStart(2, '0');
            return `${dt.getUTCFullYear()}-W${week}`;
          };

    const map = new Map<string, number>();
    rows.forEach((r) => {
      const k = keyFn(r.date);
      const current = map.get(k) ?? 0;
      const val = r.e1rm ?? 0;
      if (val > current) map.set(k, val);
    });

    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([bucketKey, e1rm]) => ({ bucket: bucketKey, e1rm }));
  }

  async getOverview(userId: string, windowDays: number) {
    const today = new Date();
    const since = new Date(today);
    since.setUTCDate(since.getUTCDate() - windowDays);
    const sinceISO = since.toISOString().slice(0, 10);

    const sessions = await this.sessions.find({
      where: { user: { id: userId }, date: MoreThanOrEqual(sinceISO) },
      order: { date: 'DESC' },
      relations: { sets: true },
    });

    const attempts = await this.sets
      .createQueryBuilder('s')
      .innerJoin('s.session', 'sess')
      .where('sess.userId = :userId', { userId })
      .andWhere('s.date >= :since', { since: sinceISO })
      .getCount();

    const prs = await this.prs.count({ where: { user: { id: userId } } });

    // Compute streak (days with any session)
    const dates = new Set(sessions.map((s) => s.date));
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      if (dates.has(iso)) streak++;
      else break;
    }

    // bests (by ExercisePR)
    const bestRows = await this.prs.find({ where: { user: { id: userId } } });
    const bests = bestRows.map((b) => ({
      name: b.exerciseName,
      e1rm: b.bestE1rm,
      weight: Number(b.weightAtBest ?? 0),
      reps: b.repsAtBest ?? 0,
      date: b.dateOfBest ?? null,
    }));

    // session history table rows
    const history = sessions.map((s) => {
      const volume = (s.sets || []).reduce((acc, x) => acc + Number(x.weight) * (x.reps || 0), 0);
      const setsDone = (s.sets || []).filter((x) => x.done).length;
      return {
        date: s.date,
        name: s.name,
        volume,
        duration: s.durationSec ? `${Math.floor(s.durationSec / 60)}m` : '—',
        setsDone,
        setsTotal: s.sets?.length || 0,
      };
    });

    return {
      totals: {
        exercisesTracked: new Set((await this.sets.createQueryBuilder('s')
          .innerJoin('s.session', 'sess')
          .where('sess.userId = :userId', { userId })
          .select('s.exerciseName', 'name').getRawMany()).map(r => r.name)).size,
        attempts,
        allTimePrs: prs,
        currentStreakDays: streak,
      },
      bests,
      history,
    };
  }
}
