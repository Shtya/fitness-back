// src/entities/global.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, ManyToOne, OneToMany, OneToOne, JoinColumn, Unique } from 'typeorm';
import { Asset } from './assets.entity';
import { CoreEntity } from './core.entity';

export enum UserRole {
  CLIENT = 'client',
  COACH = 'coach',
  ADMIN = 'admin',
}

export enum DayOfWeek {
  SATURDAY = 'saturday',
  SUNDAY = 'sunday',
  MONDAY = 'monday',
  TUESDAY = 'tuesday',
  WEDNESDAY = 'wednesday',
  THURSDAY = 'thursday',
}

export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

export type RepsPattern = string; // e.g. "8", "12-15", "1 minute"

@Entity('users')
@Unique(['email'])
export class User extends CoreEntity {
  @Index()
  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Index()
  @Column({ type: 'varchar', length: 190 })
  email!: string;

  @Column()
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.CLIENT })
  role!: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING })
  status!: UserStatus;

  /* Optional but useful for audit */
  @Column({ type: 'timestamptz', nullable: true })
  lastLogin!: Date | null;

  /* NEW: password reset OTP/token + expiry */
  @Column({ type: 'varchar', nullable: true })
  resetPasswordToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resetPasswordExpires!: Date | null;

  @Column({ type: 'int', default: 0 })
  points!: number;

  @Column({ type: 'int', default: 90 })
  defaultRestSeconds!: number;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  activePlanId!: string | null;

  @OneToMany(() => WorkoutPlan, plan => plan.user, { cascade: ['insert', 'update'] })
  plans!: WorkoutPlan[];

  @OneToMany(() => UserCoach, uc => uc.client, { cascade: ['insert', 'update'] })
  coaches!: UserCoach[];

  @OneToMany(() => UserCoach, uc => uc.coach, { cascade: ['insert', 'update'] })
  clients!: UserCoach[];

  @OneToMany(() => PersonalRecord, pr => pr.user, { cascade: ['insert', 'update'] })
  prs!: PersonalRecord[];

  @OneToMany(() => WorkoutSession, s => s.user, { cascade: ['insert', 'update'] })
  sessions!: WorkoutSession[];

  @OneToMany(() => Asset, upload => upload.user)
  uploads: Asset[];
}

@Entity('user_coach')
@Unique(['coach', 'client'])
export class UserCoach {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coachId' })
  coach!: User;

  @Index()
  @Column('uuid')
  coachId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client!: User;

  @Index()
  @Column('uuid')
  clientId!: string;

  @Column({ type: 'jsonb', default: {} })
  meta!: Record<string, any>;

  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity('exercise_catalog')
@Unique(['name'])
export class Exercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  desc!: string | null;

  // Default media (your UI also shows per-plan overrides)
  @Column({ type: 'text', nullable: true })
  img!: string | null;

  @Column({ type: 'text', nullable: true })
  video!: string | null;

  // Additional images/videos if you want (URLs)
  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  gallery!: string[];

  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity('workout_plans')
export class WorkoutPlan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 180 })
  name!: string; // e.g., "6-week Push/Pull/Legs"

  @ManyToOne(() => User, u => u.plans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column('uuid')
  userId!: string;

  // Owner/editor coach — this is your authorization anchor
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'coachId' })
  coach!: User | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  coachId!: string | null;

  @Column({ type: 'boolean', default: false })
  isActive!: boolean;

  // e.g., {"goal":"hypertrophy","phase":1}
  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, any>;

  @OneToMany(() => WorkoutDay, d => d.plan, {
    cascade: ['insert', 'update'],
    eager: true,
  })
  days!: WorkoutDay[];

  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity('workout_days')
@Unique(['plan', 'dayOfWeek'])
export class WorkoutDay {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => WorkoutPlan, p => p.days, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'planId' })
  plan!: WorkoutPlan;

  @Index()
  @Column('uuid')
  planId!: string;

  @Index()
  @Column({ type: 'enum', enum: DayOfWeek })
  dayOfWeek!: DayOfWeek;

  @Column({ type: 'varchar', length: 200 })
  name!: string; // e.g., "Push Day 1 (Chest & Triceps)"

  @OneToMany(() => WorkoutExercise, ex => ex.day, {
    cascade: ['insert', 'update'],
    eager: true,
  })
  exercises!: WorkoutExercise[];

  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity('workout_day_exercises')
export class WorkoutExercise {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => WorkoutDay, d => d.exercises, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dayId' })
  day!: WorkoutDay;

  @Index()
  @Column('uuid')
  dayId!: string;

  // (Optional) link to global catalog item; can be null for ad-hoc custom exercises
  @ManyToOne(() => Exercise, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'exerciseId' })
  exercise!: Exercise | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  exerciseId!: string | null;

  // Inline name/desc/media — copied from catalog or customized by coach
  @Index()
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  desc!: string | null;

  @Column({ type: 'int', default: 3 })
  targetSets!: number;

  @Column({ type: 'varchar', length: 40, default: '10' })
  targetReps!: RepsPattern;

  @Column({ type: 'int', nullable: true })
  restSeconds!: number | null; // if null, fall back to user's defaultRestSeconds

  @Column({ type: 'text', nullable: true })
  img!: string | null;

  @Column({ type: 'text', nullable: true })
  video!: string | null;

  // Optional extra media (URLs). Postgres text[] is simple and fast.
  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  gallery!: string[];

  // Sort order within the day
  @Column({ type: 'int', default: 0 })
  sort!: number;

  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity('workout_sessions')
export class WorkoutSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, u => u.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column('uuid')
  userId!: string;

  @ManyToOne(() => WorkoutPlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'planId' })
  plan!: WorkoutPlan | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  planId!: string | null;

  @Column({ type: 'date' })
  date!: string; // 'YYYY-MM-DD' (matches your UI)

  @Column({ type: 'varchar', length: 120 })
  name!: string; // e.g., "Upper Push (W3•D2)"

  @Column({ type: 'int', default: 0 })
  volume!: number; // e.g., kg·reps

  @Column({ type: 'varchar', length: 10, default: '00:00' })
  duration!: string; // "HH:MM" or "MM:SS"

  @Column({ type: 'int', default: 0 })
  setsDone!: number;

  @Column({ type: 'int', default: 0 })
  setsTotal!: number;

  // Snapshot of what was done (per-set details)
  @Column({ type: 'jsonb', default: [] })
  performedSets!: Array<{
    exName: string;
    set: number;
    weight: number;
    reps: number;
    pr: boolean;
  }>;

  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

export type PersonalSetRecord = {
  id: string; // uuid you generate per set client- or server-side
  weight: number; // kg
  reps: number; // reps count
  done: boolean; // whether the set was completed
  setNumber: number; // 1-based ordering within the day
};

@Entity('personal_records')
@Unique(['user', 'exerciseName', 'date'])
export class PersonalRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, u => u.prs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column('uuid')
  userId!: string;

  // We store by exercise name to avoid strict coupling to catalog ids
  @Index()
  @Column({ type: 'varchar', length: 200 })
  exerciseName!: string;

  @Column({ type: 'jsonb', default: [] })
  records!: PersonalSetRecord[];

  @Index()
  @Column({ type: 'date' })
  date!: string; // 'YYYY-MM-DD'

  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity('personal_record_attempts')
@Index(['userId', 'exerciseName', 'date'])
@Index(['userId', 'exerciseName', 'date', 'setIndex'])
export class PersonalRecordAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Index()
  @Column('uuid')
  userId!: string;

  @Index()
  @Column({ type: 'varchar', length: 200 })
  exerciseName!: string;

  /** FK to the daily multi-sets row in personal_records */
  @ManyToOne(() => PersonalRecord, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'recordId' })
  record!: PersonalRecord | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  recordId!: string | null;

  /** Mirrors records[].id so we can identify the exact set inside the JSON array */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  recordSetId!: string | null;

  /** 1-based set order within the day */
  @Column({ type: 'int', nullable: true })
  setIndex!: number | null;

  @Column({ type: 'int' })
  weight!: number;

  @Column({ type: 'int' })
  reps!: number;

  @Column({ type: 'float' })
  e1rm!: number; // Epley 1RM

  @Column({ type: 'date' })
  date!: string; // 'YYYY-MM-DD'

  @Column({ type: 'boolean', default: false })
  isPr!: boolean; // true if this set updated the all-time best

  // Optionally link back to a session if you have it
  @Column({ type: 'uuid', nullable: true })
  sessionId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}

export type WeeklyProgramSeed = {
  [k in DayOfWeek]?: {
    id: string; // not stored, just for mapping
    name: string;
    exercises: Array<{
      id: string;
      name: string;
      targetSets: number;
      targetReps: RepsPattern;
      rest: number | null; // seconds
      img?: string;
      video?: string;
      desc?: string;
      gallery?: string[];
    }>;
  };
};

export function buildPlanFromSeed(opts: { planName: string; userId: string; coachId?: string | null; weekly: WeeklyProgramSeed; active?: boolean }): WorkoutPlan {
  const plan = new WorkoutPlan();
  plan.name = opts.planName;
  plan.userId = opts.userId;
  plan.coachId = opts.coachId ?? null;
  plan.isActive = !!opts.active;
  plan.metadata = {};
  plan.days = [];

  const order: DayOfWeek[] = [DayOfWeek.SATURDAY, DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY];

  for (const dow of order) {
    const d = opts.weekly[dow];
    if (!d) continue;

    const day = new WorkoutDay();
    day.dayOfWeek = dow;
    day.name = d.name;
    day.exercises = d.exercises.map((ex, i) => {
      const wex = new WorkoutExercise();
      wex.name = ex.name;
      wex.desc = ex.desc ?? null;
      wex.targetSets = ex.targetSets ?? 3;
      wex.targetReps = ex.targetReps ?? '10';
      wex.restSeconds = Number.isFinite(ex.rest as any) ? (ex.rest as number) : null;
      wex.img = ex.img ?? null;
      wex.video = ex.video ?? null;
      wex.gallery = ex.gallery ?? [];
      wex.sort = i;
      wex.exerciseId = null; // if you map to catalog later, set this
      return wex;
    });

    plan.days.push(day);
  }

  return plan;
}
