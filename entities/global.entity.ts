// src/entities/global.entity.ts
import { Entity, Column, Index, ManyToOne, OneToMany, Unique } from 'typeorm';
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

  // coach -> many plans (as coach)
  @OneToMany(() => Plan, p => p.coach)
  plansCoached: Plan[];

  // client -> many plans assigned to this user
  @OneToMany(() => Plan, p => p.athlete)
  plansAssigned: Plan[];

  @OneToMany(() => WorkoutSession, s => s.user)
  sessions: WorkoutSession[];

  @OneToMany(() => ExercisePR, pr => pr.user)
  prs: ExercisePR[];

  @OneToMany(() => Asset, upload => upload.user)
  uploads: Asset[];
}

@Entity('plans')
@Unique('uq_active_plan_per_user', ['athlete', 'isActive'])
export class Plan extends CoreEntity {
  @Column({ type: 'varchar', length: 180 })
  name: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Index()
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'date', nullable: true })
  startDate?: string | null;

  @Column({ type: 'date', nullable: true })
  endDate?: string | null;

  // coach who owns this plan
  @ManyToOne(() => User, u => u.plansCoached, { onDelete: 'SET NULL', nullable: true })
  coach?: User | null;

  // athlete assigned
  @Index()
  @ManyToOne(() => User, u => u.plansAssigned, { onDelete: 'CASCADE' })
  athlete: User;

  @OneToMany(() => PlanDay, d => d.plan, { cascade: true })
  days: PlanDay[];
}

@Entity('plan_days')
@Index(['plan', 'day'], { unique: true })
export class PlanDay extends CoreEntity {
  @ManyToOne(() => Plan, p => p.days, { onDelete: 'CASCADE' })
  plan: Plan;

  // UI label e.g. "Push A", "Legs", etc.
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'enum', enum: DayOfWeek })
  day: DayOfWeek;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;

  @OneToMany(() => PlanExercise, e => e.day, { cascade: true })
  exercises: PlanExercise[];
}

@Entity('plan_exercises')
@Index(['day', 'orderIndex'])
export class PlanExercise extends CoreEntity {
  @ManyToOne(() => PlanDay, d => d.exercises, { onDelete: 'CASCADE' })
  day: PlanDay;

  @Index()
  @Column({ type: 'varchar', length: 160 })
  name: string;

  // same field your UI expects
  @Column({ type: 'varchar', length: 50, default: '10' })
  targetReps: string;

  // optional media shown in the UI
  @Column({ type: 'varchar', length: 512, nullable: true })
  img?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  video?: string | null;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;
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
