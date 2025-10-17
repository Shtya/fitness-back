/**
 * put the today is active and also and if he swtich to another day save it in the localstorge to get it if exist
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan, MoreThanOrEqual } from 'typeorm';
import { ExerciseRecord, User } from 'entities/global.entity';

@Injectable()
export class PrsService {
  constructor(
    @InjectRepository(ExerciseRecord)
    private readonly exerciseRecordRepo: Repository<ExerciseRecord>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  private ymd(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  // 1) rich progress using ONLY exercise_records
  async getProgress(windowDays: number, exerciseWindowDays: number, userId: string) {
    if (!userId) throw new NotFoundException('User ID is required');

    const start = new Date();
    start.setDate(start.getDate() - (windowDays || 30));
    const startStr = this.ymd(start);

    const recent = await this.exerciseRecordRepo.find({
      where: { userId, date: MoreThanOrEqual(startStr) },
      order: { date: 'ASC' },
    });

    // group by date (sessions)
    const byDate = new Map<string, typeof recent>();
    for (const r of recent) {
      if (!byDate.has(r.date)) byDate.set(r.date, [] as any);
      byDate.get(r.date)!.push(r);
    }
    const sessions = Array.from(byDate.entries())
      .map(([date, list]) => {
        const volume = list.reduce((s, x) => s + (x.totalVolume || 0), 0);
        const sets = list.reduce((s, x) => s + (x.workoutSets?.length || 0), 0);
        const done = list.reduce((s, x) => s + (x.workoutSets?.filter(s => s.done).length || 0), 0);
        return {
          date,
          volume,
          setsTotal: sets,
          setsDone: done,
          exercises: Array.from(new Set(list.map(x => x.exerciseName))),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const sessionsCount = sessions.length;
    const totalVolume = sessions.reduce((s, x) => s + x.volume, 0);
    const avgVolumePerSession = sessionsCount ? Math.round(totalVolume / sessionsCount) : 0;
    const avgSetsPerSession = sessionsCount ? Math.round(sessions.reduce((s, x) => s + x.setsTotal, 0) / sessionsCount) : 0;

    // adherence & streaks (days trained / window)
    const adherencePct = Math.round((sessionsCount / Math.max(1, windowDays)) * 100);
    const lastWorkoutDate = sessionsCount ? sessions[sessionsCount - 1].date : null;
    const currentStreakDays = await this.calculateCurrentStreak(userId);

    // top exercises by attempts & volume
    const attempts = new Map<string, number>();
    const volumes = new Map<string, number>();
    for (const r of recent) {
      attempts.set(r.exerciseName, (attempts.get(r.exerciseName) || 0) + 1);
      volumes.set(r.exerciseName, (volumes.get(r.exerciseName) || 0) + (r.totalVolume || 0));
    }
    const topByAttempts = Array.from(attempts.entries())
      .map(([name, attempts]) => ({ name, attempts }))
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 8);
    const topByVolume = Array.from(volumes.entries())
      .map(([name, volume]) => ({ name, volume }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 8);

    // recent PRs
    const recentPRs = await this.exerciseRecordRepo.find({
      where: { userId, isPersonalRecord: true },
      order: { date: 'DESC' },
      take: 10,
    });
    const prs = {
      count: recentPRs.length,
      top: recentPRs.slice(0, 5).map(r => ({
        exercise: r.exerciseName,
        e1rm: r.bestE1rm,
        weight: r.maxWeight,
        reps: r.maxReps,
        date: r.date,
      })),
    };

    // e1RM trends for the 3 most frequent exercises (weekly buckets)
    const trendNames = topByAttempts.slice(0, 3).map(x => x.name);
    const e1rmTrends: Record<string, Array<{ date: string; e1rm: number }>> = {};
    for (const name of trendNames) {
      const series = await this.getE1rmSeries(userId, name, 'week', exerciseWindowDays || 90);
      e1rmTrends[name] = series.map(s => ({ date: s.bucket, e1rm: s.e1rm }));
    }

    return {
      adherence: { pct: adherencePct, daysTrained: sessionsCount, currentStreakDays, lastWorkoutDate },
      volume: { total: totalVolume, avgPerSession: avgVolumePerSession },
      sessions: { count: sessionsCount, avgSetsPerSession, last8: sessions.slice(-8) },
      exercises: { topByAttempts, topByVolume },
      prs,
      e1rmTrends,
      // for simple UI drill-downs
      meta: { windowDays, exerciseWindowDays, timestamp: new Date().toISOString() },
    };
  }

  // 2) weights used ON A CHOSEN DAY (per exercise + per-set summary)
  async getDayStats(userId: string, date: string) {
    if (!userId || !date) throw new NotFoundException('userId & date are required');

    const records = await this.exerciseRecordRepo.find({
      where: { userId, date },
      order: { exerciseName: 'ASC' },
    });

    // group by exercise
    const byName = new Map<string, typeof records>();
    for (const r of records) {
      if (!byName.has(r.exerciseName)) byName.set(r.exerciseName, [] as any);
      byName.get(r.exerciseName)!.push(r);
    }

    const exercises = Array.from(byName.entries()).map(([name, list]) => {
      const allSets = list.flatMap(x => x.workoutSets || []);
      const doneSets = allSets.filter(s => s.done && s.weight > 0 && s.reps > 0);
      const bestWeight = doneSets.length ? Math.max(...doneSets.map(s => s.weight)) : 0;
      const bestReps = doneSets.length ? Math.max(...doneSets.map(s => s.reps)) : 0;
      const bestE1rm = doneSets.length ? Math.max(...doneSets.map(s => s.e1rm || 0)) : 0;
      const totalVolume = list.reduce((sum, x) => sum + (x.totalVolume || 0), 0);

      return {
        exerciseName: name,
        totalVolume,
        bestWeight,
        bestReps,
        bestE1rm,
        sets: doneSets.sort((a, b) => a.setNumber - b.setNumber).map(s => ({ setNumber: s.setNumber, weight: s.weight, reps: s.reps, e1rm: s.e1rm, isPr: !!s.isPr })),
      };
    });

    const totals = {
      exercisesCount: exercises.length,
      totalVolume: exercises.reduce((s, x) => s + x.totalVolume, 0),
      totalSets: exercises.reduce((s, x) => s + x.sets.length, 0),
    };

    return { date, totals, exercises };
  }

  // 3) per-exercise deltas (زاد/نقص بين الجلسات)
  async getExerciseDeltas(userId: string, exerciseName: string, limit = 50) {
    if (!userId || !exerciseName) throw new NotFoundException('userId & exerciseName are required');
    const exerciseId = this.generateExerciseId(exerciseName);

    const rows = await this.exerciseRecordRepo.find({
      where: { userId, exerciseId },
      order: { date: 'ASC' },
    });

    const items = rows.map(r => ({
      date: r.date,
      weight: r.maxWeight || 0,
      reps: r.maxReps || 0,
      e1rm: r.bestE1rm || 0,
    }));

    const withDeltas = items.map((cur, i) => {
      if (i === 0) return { ...cur, delta: { weight: 0, reps: 0, e1rm: 0 }, trend: '—' };
      const prev = items[i - 1];
      const dw = cur.weight - prev.weight;
      const dr = cur.reps - prev.reps;
      const de = cur.e1rm - prev.e1rm;
      const trend = dw > 0 || de > 0 || dr > 0 ? 'up' : dw < 0 || de < 0 || dr < 0 ? 'down' : 'same';
      return { ...cur, delta: { weight: dw, reps: dr, e1rm: de }, trend };
    });

    const lastChange = withDeltas.length >= 2 ? withDeltas[withDeltas.length - 1] : null;

    return {
      exerciseName,
      count: withDeltas.length,
      lastChange, // e.g. {date, weight, reps, e1rm, delta:{...}, trend:'up|down|same'}
      sessions: withDeltas.slice(-limit),
    };
  }

  // 4) quick comparison for one exercise between two dates
  async compareExerciseBetweenDates(userId: string, exerciseName: string, fromDate: string, toDate: string) {
    if (!userId || !exerciseName || !fromDate || !toDate) {
      throw new NotFoundException('userId, exerciseName, from, to are required');
    }
    const exerciseId = this.generateExerciseId(exerciseName);

    const [from, to] = await Promise.all([this.exerciseRecordRepo.findOne({ where: { userId, exerciseId, date: fromDate } }), this.exerciseRecordRepo.findOne({ where: { userId, exerciseId, date: toDate } })]);

    const A = from ? { weight: from.maxWeight || 0, reps: from.maxReps || 0, e1rm: from.bestE1rm || 0 } : { weight: 0, reps: 0, e1rm: 0 };
    const B = to ? { weight: to.maxWeight || 0, reps: to.maxReps || 0, e1rm: to.bestE1rm || 0 } : { weight: 0, reps: 0, e1rm: 0 };

    const delta = { weight: B.weight - A.weight, reps: B.reps - A.reps, e1rm: B.e1rm - A.e1rm };
    const trend = delta.weight > 0 || delta.reps > 0 || delta.e1rm > 0 ? 'up' : delta.weight < 0 || delta.reps < 0 || delta.e1rm < 0 ? 'down' : 'same';

    return {
      exerciseName,
      from: { date: fromDate, ...A },
      to: { date: toDate, ...B },
      delta,
      trend,
    };
  }
  async getProgressSummary(userId: string, windowDays: number = 30) {
    if (!userId) throw new NotFoundException('User ID is required');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Safe window start (YYYY-MM-DD)
    const now = Date.now();
    const start = new Date(now - windowDays * 24 * 60 * 60 * 1000);
    if (isNaN(start.getTime())) {
      const f = new Date();
      f.setDate(f.getDate() - 30);
      start.setTime(f.getTime());
    }
    const y = start.getFullYear();
    const m = String(start.getMonth() + 1).padStart(2, '0');
    const d = String(start.getDate()).padStart(2, '0');
    const startStr = `${y}-${m}-${d}`;

    // Pull all recent records once
    const records = await this.exerciseRecordRepo.find({
      where: { userId, date: MoreThanOrEqual(startStr) },
      order: { date: 'ASC' },
    });

    // Build sessions by date
    const byDate = new Map<
      string,
      {
        date: string;
        totalVolume: number;
        totalSets: number;
        doneSets: number;
        exercises: Set<string>;
      }
    >();
    for (const r of records) {
      if (!byDate.has(r.date)) {
        byDate.set(r.date, { date: r.date, totalVolume: 0, totalSets: 0, doneSets: 0, exercises: new Set() });
      }
      const sess = byDate.get(r.date)!;
      sess.totalVolume += r.totalVolume || 0;
      sess.totalSets += r.workoutSets?.length || 0;
      sess.doneSets += r.workoutSets?.filter(s => s.done).length || 0;
      sess.exercises.add(r.exerciseName);
    }

    const sessions = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    const daysTrained = sessions.length;
    const adherencePct = windowDays > 0 ? Math.round((daysTrained / windowDays) * 100) : 0;
    const totalVolume = sessions.reduce((t, s) => t + s.totalVolume, 0);
    const totalSets = sessions.reduce((t, s) => t + s.totalSets, 0);
    const avgSetsPerSession = sessions.length ? +(totalSets / sessions.length).toFixed(1) : 0;
    const avgVolumePerSession = sessions.length ? Math.round(totalVolume / sessions.length) : 0;
    const lastWorkoutDate = sessions.length ? sessions[sessions.length - 1].date : null;

    // Streak (reuses your existing function)
    const currentStreakDays = await this.calculateCurrentStreak(userId);

    // Recent PRs (top 3 by bestE1rm within window or all-time fallback)
    const windowPrs = await this.exerciseRecordRepo.find({
      where: { userId, isPersonalRecord: true, date: MoreThanOrEqual(startStr) },
      order: { bestE1rm: 'DESC' },
    });
    let topPrs = windowPrs.slice(0, 3);
    if (topPrs.length < 3) {
      const allPrs = await this.exerciseRecordRepo.find({
        where: { userId, isPersonalRecord: true },
        order: { bestE1rm: 'DESC' },
        take: 3,
      });
      topPrs = allPrs;
    }
    const prs = {
      count: await this.exerciseRecordRepo.createQueryBuilder('r').where('r.userId = :userId AND r.isPersonalRecord = true', { userId }).getCount(),
      top: topPrs.map(pr => ({
        exercise: pr.exerciseName,
        e1rm: pr.bestE1rm,
        weight: pr.maxWeight,
        reps: pr.maxReps,
        date: pr.date,
      })),
    };

    // Most-trained exercises (by attempts count in window)
    const attemptsByExercise = new Map<string, number>();
    for (const r of records) {
      attemptsByExercise.set(r.exerciseName, (attemptsByExercise.get(r.exerciseName) || 0) + 1);
    }
    const topExercises = Array.from(attemptsByExercise.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, attempts]) => ({ name, attempts }));

    // Tiny e1RM trends for up to 3 most frequent lifts (weekly)
    const trendTargets = topExercises.slice(0, 3).map(x => x.name);
    const e1rmTrendsEntries = await Promise.all(
      trendTargets.map(async name => {
        const series = await this.getE1rmSeries(userId, name, 'week', Math.max(windowDays, 90));
        return [name, series] as const;
      }),
    );
    const e1rmTrends: Record<string, Array<{ bucket: string; e1rm: number }>> = Object.fromEntries(e1rmTrendsEntries);

    return {
      adherence: {
        daysTrained,
        windowDays,
        pct: adherencePct,
        currentStreakDays,
        lastWorkoutDate,
      },
      volume: {
        total: totalVolume,
        byDay: sessions.map(s => ({ date: s.date, volume: s.totalVolume })),
        avgPerSession: avgVolumePerSession,
      },
      sessions: {
        count: sessions.length,
        avgSetsPerSession,
      },
      prs,
      exercises: {
        topByAttempts: topExercises,
      },
      e1rmTrends,
      timestamp: new Date().toISOString(),
    };
  }

  async getAllStats(userId: string, windowDays: number = 30, exerciseWindowDays: number = 90) {
    if (!userId) {
      throw new NotFoundException('User ID is required');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get all data in parallel for better performance
    const [overview, personalRecords, uniqueExercises, totalAttempts, currentStreak, recentHistory] = await Promise.all([this.getOverviewData(userId, windowDays), this.getPersonalRecords(userId), this.getUniqueExercisesCount(userId), this.getTotalAttemptsCount(userId), this.calculateCurrentStreak(userId), this.getRecentHistory(userId, windowDays)]);

    // Get exercise names for drilldown
    const exerciseNames = await this.getExerciseNamesForDrilldown(userId);

    // Get stats for each exercise
    const exerciseDrilldown = await Promise.all(
      exerciseNames.map(async exerciseName => {
        return await this.getExerciseDrilldownStats(userId, exerciseName, exerciseWindowDays);
      }),
    );

    return {
      // Overview stats
      overview: {
        exercisesTracked: uniqueExercises,
        totalAttempts,
        allTimePrs: personalRecords.length,
        currentStreakDays: currentStreak,
      },

      // All-time bests
      allTimeBests: personalRecords.map(pr => ({
        name: pr.exerciseName,
        e1rm: pr.bestE1rm,
        weight: pr.maxWeight,
        reps: pr.maxReps,
        date: pr.date,
      })),

      // Exercise drilldown for each exercise
      exerciseDrilldown: exerciseDrilldown.reduce((acc, stats) => {
        if (stats) {
          acc[stats.exerciseName] = stats;
        }
        return acc;
      }, {}),

      // Session history
      sessionHistory: {
        totalWorkouts: recentHistory.length,
        workouts: recentHistory,
      },

      // Timestamp
      timestamp: new Date().toISOString(),
    };
  }

  private async getOverviewData(userId: string, windowDays: number) {
    // Safe date creation
    const now = Date.now();
    const startDate = new Date(now - windowDays * 24 * 60 * 60 * 1000);

    // Validate the date
    if (isNaN(startDate.getTime())) {
      const fallbackDate = new Date();
      fallbackDate.setDate(fallbackDate.getDate() - 30);
      startDate.setTime(fallbackDate.getTime());
    }

    // Safe date formatting
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, '0');
    const day = String(startDate.getDate()).padStart(2, '0');
    const startDateString = `${year}-${month}-${day}`;

    const recentRecords = await this.exerciseRecordRepo.find({
      where: {
        userId,
        date: MoreThanOrEqual(startDateString),
      },
    });

    return {
      history: recentRecords.map(record => ({
        date: record.date,
        name: record.exerciseName,
        volume: record.totalVolume,
        duration: null,
        setsDone: record.workoutSets.filter(set => set.done).length,
        setsTotal: record.workoutSets.length,
      })),
    };
  }

  private async getPersonalRecords(userId: string) {
    return await this.exerciseRecordRepo.find({
      where: { userId, isPersonalRecord: true },
    });
  }

  private async getUniqueExercisesCount(userId: string) {
    const result = await this.exerciseRecordRepo.createQueryBuilder('record').select('DISTINCT record.exerciseId', 'exerciseId').where('record.userId = :userId', { userId }).getRawMany();

    return result.length;
  }

  private async getTotalAttemptsCount(userId: string) {
    return await this.exerciseRecordRepo.createQueryBuilder('record').where('record.userId = :userId', { userId }).getCount();
  }

  private async getRecentHistory(userId: string, windowDays: number) {
    // Safe date creation - create from current timestamp
    const now = Date.now();
    const startDate = new Date(now - windowDays * 24 * 60 * 60 * 1000);

    // Validate the date
    if (isNaN(startDate.getTime())) {
      // Fallback: use a fixed date 30 days ago
      const fallbackDate = new Date();
      fallbackDate.setDate(fallbackDate.getDate() - 30);
      startDate.setTime(fallbackDate.getTime());
    }

    // Safe date formatting without toISOString()
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, '0');
    const day = String(startDate.getDate()).padStart(2, '0');
    const startDateString = `${year}-${month}-${day}`;

    const records = await this.exerciseRecordRepo.find({
      where: {
        userId,
        date: MoreThanOrEqual(startDateString),
      },
      order: { date: 'DESC' },
    });

    // Group by date to get sessions
    const sessionsByDate = records.reduce((acc, record) => {
      if (!acc[record.date]) {
        acc[record.date] = {
          date: record.date,
          exercises: [],
          totalVolume: 0,
          totalSets: 0,
          completedSets: 0,
        };
      }

      acc[record.date].exercises.push(record.exerciseName);
      acc[record.date].totalVolume += record.totalVolume;
      acc[record.date].totalSets += record.workoutSets.length;
      acc[record.date].completedSets += record.workoutSets.filter(set => set.done).length;

      return acc;
    }, {});

    return Object.values(sessionsByDate).map((session: any) => ({
      date: session.date,
      name: session.exercises.join(', '),
      volume: session.totalVolume,
      duration: null,
      setsDone: session.completedSets,
      setsTotal: session.totalSets,
    }));
  }

  private async getExerciseNamesForDrilldown(userId: string, limit: number = 10) {
    const records = await this.exerciseRecordRepo.createQueryBuilder('record').select('DISTINCT record.exerciseName', 'exerciseName').where('record.userId = :userId', { userId }).orderBy('record.exerciseName', 'ASC').limit(limit).getRawMany();

    return records.map(r => r.exerciseName);
  }

  private async getExerciseDrilldownStats(userId: string, exerciseName: string, windowDays: number = 90) {
    try {
      const exerciseId = this.generateExerciseId(exerciseName);

      const [series, topSets, attempts] = await Promise.all([this.getE1rmSeries(userId, exerciseName, 'week', windowDays), this.getTopSets(userId, exerciseName, 5), this.getExerciseHistory(userId, exerciseName)]);

      return {
        exerciseName,
        series: series || [],
        topSets: topSets || { byWeight: [], byReps: [], byE1rm: [] },
        attempts: attempts || [],
        hasData: series.length > 0 || topSets.byWeight.length > 0 || attempts.length > 0,
      };
    } catch (error) {
      console.error(`Error getting stats for ${exerciseName}:`, error);
      return {
        exerciseName,
        series: [],
        topSets: { byWeight: [], byReps: [], byE1rm: [] },
        attempts: [],
        hasData: false,
      };
    }
  }

  async getLastWorkoutSets(userId: string, exerciseNames: string[]) {
    if (!userId || !exerciseNames || exerciseNames.length === 0) {
      throw new NotFoundException('User ID and exercises array are required');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get last sets for each exercise
    const results = await Promise.all(
      exerciseNames.map(async exerciseName => {
        const exerciseId = this.generateExerciseId(exerciseName);

        // Find the most recent record (closest date to today)
        const lastRecord = await this.exerciseRecordRepo.findOne({
          where: {
            userId,
            exerciseId,
          },
          order: { date: 'DESC' }, // This gets the most recent date
        });

        console.log(lastRecord);

        if (!lastRecord) {
          return {
            exerciseName,
            date: null,
            records: [], // No previous workout found
          };
        }

        // Get only the completed sets
        const completedSets = lastRecord.workoutSets
          .filter(set => set.done && set.weight > 0 && set.reps > 0)
          .sort((a, b) => a.setNumber - b.setNumber)
          .map(set => ({
            weight: set.weight,
            reps: set.reps,
            done: true, // Since we filtered for done sets
            setNumber: set.setNumber,
          }));

        return {
          exerciseName,
          date: lastRecord.date, // Include the date
          records: completedSets,
        };
      }),
    );

    return {
      userId,
      exercises: results,
    };
  }

  // Keep the same endpoint but use ExerciseRecord
  async upsertDailyPR(
    userId: string,
    exerciseName: string,
    date: string,
    records: Array<{
      id?: string;
      weight: number;
      reps: number;
      done: boolean;
      setNumber: number;
    }>,
  ) {
    if (!userId || !exerciseName) {
      throw new NotFoundException('User ID and exercise name are required');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // FIXED: Generate database-safe exerciseId
    const exerciseId = this.generateExerciseId(exerciseName);

    // Calculate current workout metrics
    const workoutSets = records.map(record => ({
      setNumber: record.setNumber,
      weight: record.weight,
      reps: record.reps,
      done: record.done,
      e1rm: this.calculateE1rm(record.weight, record.reps),
      isPr: false,
    }));

    const doneSets = workoutSets.filter(set => set.done && set.weight > 0 && set.reps > 0);
    const totalVolume = doneSets.reduce((total, set) => total + set.weight * set.reps, 0);
    const maxWeight = doneSets.length > 0 ? Math.max(...doneSets.map(set => set.weight)) : 0;
    const maxReps = doneSets.length > 0 ? Math.max(...doneSets.map(set => set.reps)) : 0;
    const bestE1rm = doneSets.length > 0 ? Math.max(...doneSets.map(set => set.e1rm)) : 0;

    // Get previous best for progressive overload
    const previousBestSets = await this.getPreviousBestSets(userId, exerciseId, date);

    // Check for personal record
    const { isPersonalRecord, prHistory } = await this.checkPersonalRecord(userId, exerciseId, date, bestE1rm, maxWeight, maxReps, workoutSets);

    // Get day of week from date
    const day = this.getDayOfWeek(date);

    // FIRST: Check if record already exists for this user, exercise, and date
    const existingRecord = await this.exerciseRecordRepo.findOne({
      where: {
        userId,
        exerciseId,
        date,
      },
    });

    let exerciseRecord: ExerciseRecord;

    if (existingRecord) {
      // UPDATE existing record
      exerciseRecord = await this.exerciseRecordRepo.save({
        ...existingRecord,
        workoutSets,
        previousBestSets,
        totalVolume,
        maxWeight,
        maxReps,
        bestE1rm,
        isPersonalRecord,
        prHistory,
        day, // Update day in case it changed
      });
    } else {
      // INSERT new record
      exerciseRecord = await this.exerciseRecordRepo.save({
        userId,
        exerciseId,
        exerciseName,
        day,
        date,
        workoutSets,
        previousBestSets,
        totalVolume,
        maxWeight,
        maxReps,
        bestE1rm,
        isPersonalRecord,
        prHistory,
      });
    }

    return {
      success: true,
      records: exerciseRecord.workoutSets.map(set => ({
        id: `${exerciseRecord.id}-set-${set.setNumber}`,
        weight: set.weight,
        reps: set.reps,
        done: set.done,
        setNumber: set.setNumber,
      })),
      newPR: isPersonalRecord
        ? {
            exerciseName,
            e1rm: bestE1rm,
            weight: maxWeight,
            reps: maxReps,
          }
        : null,
      operation: existingRecord ? 'updated' : 'created',
    };
  }

  // FIXED: Generate database-safe exerciseId
  private generateExerciseId(exerciseName: string): string {
    let hash = 0;
    for (let i = 0; i < exerciseName.length; i++) {
      const char = exerciseName.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `ex-${Math.abs(hash)}`;
  }

  private calculateE1rm(weight: number, reps: number): number {
    return Math.round(weight * (1 + reps / 30));
  }

  private getDayOfWeek(dateString: string): string {
    const date = new Date(dateString);
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getDay()];
  }

  private async getPreviousBestSets(userId: string, exerciseId: string, currentDate: string) {
    const previousRecord = await this.exerciseRecordRepo.findOne({
      where: {
        userId,
        exerciseId,
        date: LessThan(currentDate),
      },
      order: { date: 'DESC' },
    });

    if (!previousRecord) return [];

    return previousRecord.workoutSets
      .filter(set => set.done && set.weight > 0 && set.reps > 0)
      .map(set => ({
        setNumber: set.setNumber,
        weight: set.weight,
        reps: set.reps,
        date: previousRecord.date,
        totalVolume: set.weight * set.reps,
      }));
  }

  private async checkPersonalRecord(userId: string, exerciseId: string, date: string, bestE1rm: number, maxWeight: number, maxReps: number, workoutSets: any[]) {
    const currentPR = await this.exerciseRecordRepo.findOne({
      where: {
        userId,
        exerciseId,
        isPersonalRecord: true,
      },
      order: { bestE1rm: 'DESC' },
    });

    let isPersonalRecord = false;
    let prHistory = [];

    if (!currentPR || bestE1rm > currentPR.bestE1rm) {
      isPersonalRecord = true;

      if (currentPR) {
        await this.exerciseRecordRepo.update({ userId, exerciseId, isPersonalRecord: true }, { isPersonalRecord: false });
      }

      // Mark PR sets in current workout
      workoutSets.forEach(set => {
        if (set.e1rm === bestE1rm) {
          set.isPr = true;
        }
      });

      // Build PR history
      const previousPRs = await this.exerciseRecordRepo.find({
        where: {
          userId,
          exerciseId,
          isPersonalRecord: false,
        },
        order: { date: 'DESC' },
        take: 5,
      });

      prHistory = [
        { date, bestE1rm, weight: maxWeight, reps: maxReps },
        ...previousPRs.map(pr => ({
          date: pr.date,
          bestE1rm: pr.bestE1rm,
          weight: pr.maxWeight,
          reps: pr.maxReps,
        })),
      ].slice(0, 10);
    }

    return { isPersonalRecord, prHistory };
  }

  // Keep same endpoint for overview
  async getOverview(userId: string, windowDays: number = 30) {
    if (!userId) throw new NotFoundException('User ID is required');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - windowDays);
    const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;

    const recentRecords = await this.exerciseRecordRepo.find({
      where: { userId, date: MoreThanOrEqual(startStr) }, // <-- was exact equality
      order: { date: 'ASC' },
    });

    const personalRecords = await this.exerciseRecordRepo.find({ where: { userId, isPersonalRecord: true } });

    const totalExercises = await this.exerciseRecordRepo.createQueryBuilder('record').select('DISTINCT record.exerciseId', 'exerciseId').where('record.userId = :userId', { userId }).getRawMany();

    const totalAttempts = await this.exerciseRecordRepo.createQueryBuilder('record').where('record.userId = :userId', { userId }).getCount();

    const currentStreak = await this.calculateCurrentStreak(userId);

    return {
      totals: {
        exercisesTracked: totalExercises.length,
        attempts: totalAttempts,
        allTimePrs: personalRecords.length,
        currentStreakDays: currentStreak,
      },
      bests: personalRecords.map(pr => ({
        name: pr.exerciseName,
        e1rm: pr.bestE1rm,
        weight: pr.maxWeight,
        reps: pr.maxReps,
        date: pr.date,
      })),
      history: recentRecords.map(record => ({
        date: record.date,
        name: record.exerciseName,
        volume: record.totalVolume,
        duration: null,
        setsDone: record.workoutSets.filter(set => set.done).length,
        setsTotal: record.workoutSets.length,
      })),
    };
  }

  // Keep same endpoint for e1rm series
  async getE1rmSeries(userId: string, exerciseName: string, bucket: string = 'week', windowDays: number = 90) {
    if (!userId || !exerciseName) {
      throw new NotFoundException('User ID and exercise name are required');
    }

    const exerciseId = this.generateExerciseId(exerciseName);

    // Safe date creation
    const now = Date.now();
    const startDate = new Date(now - windowDays * 24 * 60 * 60 * 1000);

    // Validate and format date safely
    if (isNaN(startDate.getTime())) {
      const fallbackDate = new Date();
      fallbackDate.setDate(fallbackDate.getDate() - 90);
      startDate.setTime(fallbackDate.getTime());
    }

    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, '0');
    const day = String(startDate.getDate()).padStart(2, '0');
    const startDateString = `${year}-${month}-${day}`;

    let groupBy: string;
    switch (bucket) {
      case 'day':
        groupBy = 'DATE(record.date)';
        break;
      case 'week':
        groupBy = `DATE_TRUNC('week', record.date::date)`;
        break;
      case 'month':
        groupBy = `DATE_TRUNC('month', record.date::date)`;
        break;
      default:
        groupBy = `DATE_TRUNC('week', record.date::date)`;
    }

    const series = await this.exerciseRecordRepo.createQueryBuilder('record').select(`${groupBy} as bucket`).addSelect('MAX(record.bestE1rm)', 'e1rm').where('record.userId = :userId', { userId }).andWhere('record.exerciseId = :exerciseId', { exerciseId }).andWhere('record.date >= :startDate', { startDate: startDateString }).andWhere('record.bestE1rm > 0').groupBy('bucket').orderBy('bucket', 'ASC').getRawMany();

    // Safe date formatting for response
    return series.map(item => {
      let bucketDate: string;
      try {
        if (item.bucket && !isNaN(new Date(item.bucket).getTime())) {
          const date = new Date(item.bucket);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          bucketDate = `${year}-${month}-${day}`;
        } else {
          bucketDate = '1970-01-01'; // Fallback date
        }
      } catch (error) {
        bucketDate = '1970-01-01'; // Fallback date
      }

      return {
        bucket: bucketDate,
        e1rm: Math.round(parseFloat(item.e1rm)),
      };
    });
  }

  // Keep same endpoint for top sets
  async getTopSets(userId: string, exerciseName: string, top: number = 5) {
    if (!userId || !exerciseName) {
      throw new NotFoundException('User ID and exercise name are required');
    }

    const exerciseId = this.generateExerciseId(exerciseName);

    const records = await this.exerciseRecordRepo.find({
      where: { userId, exerciseId },
      order: { bestE1rm: 'DESC' },
      take: top,
    });

    const byWeight = records
      .sort((a, b) => b.maxWeight - a.maxWeight)
      .slice(0, top)
      .map(record => ({
        weight: record.maxWeight,
        reps: record.maxReps,
        e1rm: record.bestE1rm,
        date: record.date,
      }));

    const byReps = records
      .sort((a, b) => b.maxReps - a.maxReps)
      .slice(0, top)
      .map(record => ({
        weight: record.maxWeight,
        reps: record.maxReps,
        e1rm: record.bestE1rm,
        date: record.date,
      }));

    const byE1rm = records.slice(0, top).map(record => ({
      weight: record.maxWeight,
      reps: record.maxReps,
      e1rm: record.bestE1rm,
      date: record.date,
    }));

    return {
      byWeight,
      byReps,
      byE1rm,
    };
  }

  // Keep same endpoint for exercise history
  async getExerciseHistory(userId: string, exerciseName: string) {
    if (!userId || !exerciseName) {
      throw new NotFoundException('User ID and exercise name are required');
    }

    const exerciseId = this.generateExerciseId(exerciseName);

    const records = await this.exerciseRecordRepo.find({
      where: { userId, exerciseId },
      order: { date: 'DESC' },
    });

    const attempts = [];
    records.forEach(record => {
      record.workoutSets.forEach(set => {
        if (set.done && set.weight > 0 && set.reps > 0) {
          attempts.push({
            date: record.date,
            weight: set.weight,
            reps: set.reps,
            e1rm: set.e1rm,
            setIndex: set.setNumber,
            isPr: set.isPr,
          });
        }
      });
    });

    return attempts;
  }

  // Keep same endpoint for last day by name
  async getLastDayByName(userId: string, day: string, onOrBefore: string) {
    if (!userId || !day) {
      throw new NotFoundException('User ID and day are required');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const lastRecord = await this.exerciseRecordRepo.findOne({
      where: {
        userId,
        day: day.toLowerCase(),
        date: LessThan(onOrBefore),
      },
      order: { date: 'DESC' },
    });

    if (!lastRecord) {
      return {
        date: null,
        day: day,
        exercises: [],
      };
    }

    return {
      date: lastRecord.date,
      day: lastRecord.day,
      exercises: [
        {
          exerciseName: lastRecord.exerciseName,
          records: lastRecord.workoutSets
            .filter(set => set.done)
            .map(set => ({
              setNumber: set.setNumber,
              weight: set.weight,
              reps: set.reps,
              done: set.done,
              e1rm: set.e1rm,
            })),
        },
      ],
    };
  }

  private async calculateCurrentStreak(userId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    let currentDate = new Date(today);
    let streak = 0;
    let foundWorkout = true;

    while (foundWorkout) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const workout = await this.exerciseRecordRepo.findOne({
        where: {
          userId,
          date: dateStr,
        },
      });

      if (workout) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        foundWorkout = false;
      }

      if (streak > 365) break;
    }

    return streak;
  }
}
