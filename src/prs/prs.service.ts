import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  WorkoutSession,
  SessionSet,
  ExercisePR,
  User,
  DayOfWeek,
} from 'entities/global.entity';
import { Repository } from 'typeorm';

function epley(weight: number, reps: number) {
  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  return Math.round(w * (1 + r / 30));
}

function jsDateToDayOfWeekEnum(dateISO: string): DayOfWeek {
  const d = new Date(dateISO);
  const n = d.getDay(); // 0 Sun .. 6 Sat
  const map: DayOfWeek[] = [
    DayOfWeek.SUNDAY,
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.SATURDAY, // temp placeholder
    DayOfWeek.SATURDAY,
  ];
  // fix Thursday/Friday/Saturday mapping:
  map[4] = DayOfWeek.THURSDAY;
  map[5] = DayOfWeek.SATURDAY; // your enum doesn't have Friday; your week is Sa..Th in UI
  map[6] = DayOfWeek.SATURDAY;
  return map[n] || DayOfWeek.SATURDAY;
}

@Injectable()
export class PrsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(WorkoutSession) private readonly sessions: Repository<WorkoutSession>,
    @InjectRepository(SessionSet) private readonly sets: Repository<SessionSet>,
    @InjectRepository(ExercisePR) private readonly prs: Repository<ExercisePR>,
  ) {}

  async ensureUser(userId: string) {
    const u = await this.users.findOne({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  async findOrCreateSession(userId: string, dateISO: string) {
    const user = await this.ensureUser(userId);
    const existing = await this.sessions.findOne({
      where: { user, date: dateISO },
      relations: ['user'],
    });
    if (existing) return existing;

    const s = this.sessions.create({
      user,
      plan: null,
      name: 'Auto',
      day: jsDateToDayOfWeekEnum(dateISO),
      date: dateISO,
      startedAt: null,
      endedAt: null,
      durationSec: null,
    });
    return await this.sessions.save(s);
  }

  async upsertDay(
    userId: string,
    exerciseName: string,
    dateISO: string,
    records: Array<{ id?: string; setNumber: number; weight: number; reps: number; done: boolean }>,
  ) {
    const session = await this.findOrCreateSession(userId, dateISO);

    const saved: Array<{
      id: string;
      setNumber: number;
      weight: number;
      reps: number;
      done: boolean;
      e1rm: number | null;
      isPr: boolean;
    }> = [];

    for (const r of records) {
      const weightNum = Number(r.weight) || 0;
      const repsNum = Number(r.reps) || 0;

      let entity: SessionSet | undefined;

      if (r.id) {
        entity = await this.sets.findOne({ where: { id: r.id } });
      }
      if (!entity) {
        entity = await this.sets.findOne({
          where: {
            session: { id: session.id },
            exerciseName,
            setNumber: r.setNumber,
            date: dateISO,
          },
          relations: ['session'],
        });
      }

      if (!entity) {
        entity = this.sets.create({
          session,
          date: dateISO,
          exerciseName,
          planExerciseId: null,
          setNumber: r.setNumber,
          weight: String(weightNum.toFixed(2)),
          reps: repsNum,
          done: !!r.done,
          restSeconds: null,
          effort: null,
          e1rm: null,
          isPr: false,
        });
      } else {
        entity.weight = String(weightNum.toFixed(2));
        entity.reps = repsNum;
        entity.done = !!r.done;
      }

      // compute e1rm
      const e1 = (weightNum > 0 && repsNum > 0) ? epley(weightNum, repsNum) : null;
      entity.e1rm = e1;

      const savedEntity = await this.sets.save(entity);
      saved.push({
        id: savedEntity.id,
        setNumber: savedEntity.setNumber,
        weight: Number(savedEntity.weight),
        reps: savedEntity.reps,
        done: savedEntity.done,
        e1rm: savedEntity.e1rm,
        isPr: false, // will update after PR check
      });
    }

    // Update PRs after all records written
    await this.recomputeExercisePr(userId, exerciseName);

    // mark which of the saved are PRs (by re-reading the best)
    const pr = await this.prs.findOne({
      where: { user: { id: userId }, exerciseName },
      relations: ['user'],
    });
    if (pr) {
      for (const r of saved) {
        r.isPr = r.e1rm != null && r.e1rm >= (pr.bestE1rm || 0) &&
                 r.weight > 0 && r.reps > 0;
      }
    }

    // return normalized shape for the FE
    return saved
      .sort((a, b) => a.setNumber - b.setNumber)
      .map(r => ({
        id: r.id,
        setNumber: r.setNumber,
        weight: r.weight,
        reps: r.reps,
        done: r.done,
        e1rm: r.e1rm,
        isPr: r.isPr,
      }));
  }

  async getDay(userId: string, exerciseName: string, dateISO: string) {
    await this.ensureUser(userId);
    const rows = await this.sets.find({
      where: { date: dateISO, exerciseName, session: { user: { id: userId } } },
      relations: ['session', 'session.user'],
      order: { setNumber: 'ASC' as const },
    });

    return rows.map(r => ({
      id: r.id,
      setNumber: r.setNumber,
      weight: Number(r.weight),
      reps: r.reps,
      done: r.done,
      e1rm: r.e1rm,
      isPr: r.isPr,
    }));
  }

  private async recomputeExercisePr(userId: string, exerciseName: string) {
    // compute best e1rm across all time for this user + exercise
    const rows = await this.sets.find({
      where: { exerciseName, session: { user: { id: userId } } },
      relations: ['session', 'session.user'],
    });

    let best = 0;
    let bestRow: SessionSet | null = null;
    for (const r of rows) {
      const e = r.e1rm ?? epley(Number(r.weight), r.reps);
      if (e > best) {
        best = e;
        bestRow = r;
      }
    }

    // upsert ExercisePR
    const existing = await this.prs.findOne({
      where: { user: { id: userId }, exerciseName },
      relations: ['user'],
    });
    if (bestRow) {
      const user = await this.ensureUser(userId);
      if (!existing) {
        const created = this.prs.create({
          user,
          exerciseName,
          bestE1rm: best,
          weightAtBest: bestRow.weight,
          repsAtBest: bestRow.reps,
          dateOfBest: bestRow.date,
        });
        await this.prs.save(created);
      } else {
        existing.bestE1rm = best;
        existing.weightAtBest = bestRow.weight;
        existing.repsAtBest = bestRow.reps;
        existing.dateOfBest = bestRow.date;
        await this.prs.save(existing);
      }
    }

    // mark PR flags per set (true if matches best)
    for (const r of rows) {
      const e = r.e1rm ?? epley(Number(r.weight), r.reps);
      const flag = e === best && e > 0;
      if (r.isPr !== flag) {
        r.isPr = flag;
        await this.sets.save(r);
      }
    }
  }
}
