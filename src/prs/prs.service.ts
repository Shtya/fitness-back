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
    if (!userId) {
      throw new NotFoundException('User ID is required');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - windowDays);

    // Get data from ExerciseRecord
    const recentRecords = await this.exerciseRecordRepo.find({
      where: {
        userId,
        date: startDate.toISOString().split('T')[0],
      },
    });

    const personalRecords = await this.exerciseRecordRepo.find({
      where: { userId, isPersonalRecord: true },
    });

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
        duration: null, // Not stored in ExerciseRecord
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
