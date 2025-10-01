// src/entities/global.entity.ts
import { Entity, Column, Index, ManyToOne, OneToMany, Unique, JoinColumn } from 'typeorm';
import { Asset } from './assets.entity';

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
  FRIDAY = 'friday',
}

export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

export interface ProgramExercise {
  id: string; // client-side id
  name: string;
  desc?: string | null;
  targetSets: number; // e.g. 3
  targetReps: RepsPattern; // "8" | "12-15"
  restSeconds?: number | null; // if null use user's default
  img?: string | null; // URL
  video?: string | null; // URL
  gallery?: string[]; // extra media URLs
  sort?: number; // order inside the day (0..n)
}

export interface ProgramDay {
  id: string; // "saturday"
  dayOfWeek: DayOfWeek; // enum for consistency
  name: string; // "Push Day 1 (Chest & Triceps)"
  exercises: ProgramExercise[];
}

export type RepsPattern = string;

import { PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, BaseEntity, DeleteDateColumn } from 'typeorm';

export abstract class CoreEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}

@Entity('users')
@Unique(['email'])
export class User extends CoreEntity {
  @Index()
  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Index()
  @Column({ type: 'varchar', length: 190 })
  email!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  membership?: string | null; // 'Basic' | 'Gold' | 'Platinum' | '-'

  @Column()
  password: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.CLIENT })
  role!: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING })
  status!: UserStatus;

  @Column({ type: 'varchar', length: 16, nullable: true })
  gender?: string | null; // ← ADD (e.g. 'male' | 'female' | null)

  @ManyToOne(() => User, u => u.athletes, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'coachId' })
  coach?: User | null; // ← ADD (self-reference)

  @Index()
  @Column({ type: 'uuid', nullable: true })
  coachId?: string | null; // ← physical FK column for quick filtering

  @OneToMany(() => User, u => u.coach)
  athletes?: User[]; // ← reverse side

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

  // coach -> many plans (as coach)
  @OneToMany(() => Plan, p => p.coach)
  plansCoached: Plan[];

  @OneToMany(() => PlanAssignment, a => a.athlete)
  planAssignments!: PlanAssignment[];

  @OneToMany(() => WorkoutSession, s => s.user)
  sessions: WorkoutSession[];

  @OneToMany(() => ExercisePR, pr => pr.user)
  prs: ExercisePR[];

  @OneToMany(() => Asset, upload => upload.user)
  uploads: Asset[];
}

@Entity('plans')
export class Plan extends CoreEntity {
  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // Optional: template “on/off”. Assignments control athlete activity.
  @Index()
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @ManyToOne(() => User, u => u.plansCoached, { onDelete: 'SET NULL', nullable: true })
  coach!: User | null;

  // Program content (what you build once and reuse)
  @OneToMany(() => PlanDay, d => d.plan, { cascade: true })
  days!: PlanDay[];

  // Extra: meals / instructions (JSONB so you’re flexible)
  @Column({ type: 'jsonb', default: () => `'[]'` })
  meals!: any[]; // [{ time:'08:00', items:[...], kcals: ... }, ...]

  @Column({ type: 'jsonb', default: () => `'[]'` })
  instructions!: any[];

  // Who it’s assigned to
  @OneToMany(() => PlanAssignment, a => a.plan, { cascade: true })
  assignments!: PlanAssignment[];

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'athleteId' }) // optional: custom column name
  athlete: User;
}

@Entity('plan_assignments')
@Unique(['plan', 'athlete']) // same plan not assigned twice to same athlete
@Index('uq_one_active_plan_per_user', ['athlete'], { unique: true, where: 'is_active = true' }) // Postgres partial index
export class PlanAssignment extends CoreEntity {
  @ManyToOne(() => Plan, p => p.assignments, { onDelete: 'CASCADE' })
  plan!: Plan;

  @ManyToOne(() => User, u => u.planAssignments, { onDelete: 'CASCADE' })
  athlete!: User;

  @Index()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ type: 'date', nullable: true })
  endDate!: string | null;

  // Optional label or notes per athlete
  @Column({ type: 'varchar', length: 120, nullable: true })
  label!: string | null;
}

@Entity('plan_days')
@Index(['plan', 'day', 'orderIndex'], { unique: true }) 
export class PlanDay extends CoreEntity {
  @ManyToOne(() => Plan, p => p.days, { onDelete: 'CASCADE' })
  plan!: Plan;

  @Column({ type: 'varchar', length: 120 })
  name!: string; // "Push Day 1 (Chest & Triceps)"

  @Column({ type: 'enum', enum: DayOfWeek })
  day!: DayOfWeek;

  @Column({ type: 'int', default: 0 })
  orderIndex!: number;

  @OneToMany(() => PlanExercises, e => e.day, { cascade: true })
  exercises!: PlanExercises[];
}

export enum ExerciseStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

@Entity('plan_exercises')
@Index(['day', 'orderIndex'])
export class PlanExercises extends CoreEntity {
  @ManyToOne(() => PlanDay, d => d.exercises, { nullable: true, onDelete: 'CASCADE' })
  day: PlanDay;

  @Index()
  @Column({ type: 'varchar', length: 160 })
  name: string;

  // same field your UI expects
  @Column({ type: 'varchar', length: 50, default: '10' })
  targetReps: string;

  @Column({ type: 'int', default: 3 })
  targetSets: number;

  @Column({ type: 'int', default: 90 })
  rest: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  tempo?: string | null;

  // optional media shown in the UI
  @Column({ type: 'varchar', length: 512, nullable: true })
  img?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  video?: string | null;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  // description
  @Column({ type: 'text', nullable: true })
  desc?: string | null;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  primaryMuscles: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  secondaryMuscles: string[];

  // equipment (simple text is enough)
  @Column({ type: 'varchar', length: 64, nullable: true })
  equipment?: string | null;

  @Column({ type: 'int', default: 90 })
  restSeconds: number;

  @Column('varchar', { array: true, default: '{}' })
  alternatives: string[];

  // status
  @Column({ type: 'enum', enum: ExerciseStatus, default: ExerciseStatus.ACTIVE })
  status: ExerciseStatus;
}

@Entity('workout_sessions')
@Index(['user', 'date'], { unique: false })
export class WorkoutSession extends CoreEntity {
  @ManyToOne(() => User, u => u.sessions, { onDelete: 'CASCADE' })
  user: User;

  // optional pointer to originating plan
  @ManyToOne(() => Plan, p => p.id, { onDelete: 'SET NULL', nullable: true })
  plan?: Plan | null;

  // snapshot fields
  @Column({ type: 'varchar', length: 160 })
  name: string; // e.g., "Push A", "Legs", etc.

  @Column({ type: 'enum', enum: DayOfWeek })
  day: DayOfWeek;

  // logical workout date (YYYY-MM-DD)
  @Index()
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt?: Date | null;

  // convenience: duration in seconds (compute when closing)
  @Column({ type: 'int', nullable: true })
  durationSec?: number | null;

  @OneToMany(() => SessionSet, s => s.session, { cascade: true })
  sets: SessionSet[];
}

@Entity('session_sets')
@Index(['session', 'exerciseName', 'setNumber'])
@Index(['exerciseName', 'date']) // for exercise history queries
export class SessionSet extends CoreEntity {
  @ManyToOne(() => WorkoutSession, s => s.sets, { onDelete: 'CASCADE' })
  session: WorkoutSession;

  // denormalize: keep date for fast per-exercise history
  @Column({ type: 'date' })
  date: string; // matches session.date

  // denormalize: text exercise key for stats (not tied to plan)
  @Column({ type: 'varchar', length: 160 })
  exerciseName: string;

  // optional link to plan exercise (if session created from plan)
  @Column({ type: 'uuid', nullable: true })
  planExerciseId?: string | null;

  @Column({ type: 'int', default: 1 })
  setNumber: number;

  @Column({ type: 'numeric', precision: 7, scale: 2, default: 0 })
  weight: string; // use string for numeric columns in TypeORM

  @Column({ type: 'int', default: 0 })
  reps: number;

  @Column({ type: 'boolean', default: false })
  done: boolean;

  @Column({ type: 'int', nullable: true })
  restSeconds?: number | null;

  // optional perceived effort (RPE/RIR)
  @Column({ type: 'varchar', length: 20, nullable: true })
  effort?: string | null;

  // computed/stored e1RM for fast stats
  @Column({ type: 'int', nullable: true })
  e1rm?: number | null;

  // flagged when this set created a PR for the exercise
  @Column({ type: 'boolean', default: false })
  isPr: boolean;
}

@Entity('exercise_prs')
@Unique('uq_user_exercise', ['user', 'exerciseName'])
@Index(['user', 'exerciseName'])
export class ExercisePR extends CoreEntity {
  @ManyToOne(() => User, u => u.prs, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 160 })
  exerciseName: string;

  @Column({ type: 'int' })
  bestE1rm: number;

  @Column({ type: 'numeric', precision: 7, scale: 2, nullable: true })
  weightAtBest?: string | null;

  @Column({ type: 'int', nullable: true })
  repsAtBest?: number | null;

  @Column({ type: 'date', nullable: true })
  dateOfBest?: string | null;
}
