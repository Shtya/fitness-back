// src/entities/global.entity.ts
import { Entity, Column, Index, ManyToOne, OneToMany, Unique, JoinColumn, JoinTable, ManyToMany } from 'typeorm';
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
export enum MealType {
  BREAKFAST = 'breakfast',
  LUNCH = 'lunch',
  DINNER = 'dinner',
  SNACK = 'snack',
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

@Entity('plans')
export class Plan extends CoreEntity {
  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Index()
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => PlanDay, d => d.plan, { cascade: true })
  days!: PlanDay[];

  // Who it’s assigned to
  @OneToMany(() => PlanAssignment, a => a.plan, { cascade: true })
  assignments!: PlanAssignment[];

  @OneToMany(() => User, u => u.activePlan)
  activeUsers!: User[];
}

@Entity('meal_plans')
export class MealPlan extends CoreEntity {
  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  desc?: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  // Who created this meal plan (coach)
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'coachId' })
  coach?: any | null;

  @Column({ type: 'uuid', nullable: true })
  coachId?: string | null;

  @OneToMany(() => MealPlanDay, d => d.mealPlan, { cascade: true })
  days!: MealPlanDay[];

  // Who it's assigned to
  @OneToMany(() => MealPlanAssignment, a => a.mealPlan, { cascade: true })
  assignments!: MealPlanAssignment[];

  // meal_plan.entity.ts (or same file)
  @OneToMany(() => User, u => u.activeMealPlan)
  activeUsers!: User[];
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
  gender?: string | null;

  @ManyToOne(() => User, u => u.athletes, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'coachId' })
  coach?: User | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  coachId?: string | null;

  @OneToMany(() => User, u => u.coach)
  athletes?: User[];

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

  @Column({ type: 'date', nullable: true })
  subscriptionStart!: string | null; // YYYY-MM-DD

  @Column({ type: 'date', nullable: true })
  subscriptionEnd!: string | null; // YYYY-MM-DD

  @Index()
  @Column({ type: 'uuid', nullable: true })
  activePlanId!: string | null;

  @ManyToOne(() => Plan, p => p.activeUsers, { nullable: true })
  @JoinColumn({ name: 'activePlanId' })
  activePlan!: Plan | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  activeMealPlanId!: string | null;

  @ManyToOne(() => MealPlan, mp => mp.activeUsers, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'activeMealPlanId' })
  activeMealPlan!: MealPlan | null;

  @OneToMany(() => PlanAssignment, a => a.athlete)
  planAssignments!: PlanAssignment[];

  @OneToMany(() => MealPlanAssignment, a => a.athlete)
  mealPlanAssignments!: MealPlanAssignment[];

  @OneToMany(() => Asset, upload => upload.user)
  uploads: Asset[];

  @OneToMany(() => ChatParticipant, participant => participant.user)
  chatParticipants: ChatParticipant[];

  @OneToMany(() => ChatMessage, message => message.sender)
  sentMessages: ChatMessage[];
}

export enum ExerciseStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

@Entity('plan_days')
@Index(['plan', 'day'], { unique: true })
export class PlanDay extends CoreEntity {
  @ManyToOne(() => Plan, p => p.days, { onDelete: 'CASCADE' })
  plan!: Plan;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'enum', enum: DayOfWeek })
  day!: DayOfWeek;

  @ManyToMany(() => PlanExercises, e => e.day, { cascade: false })
  @JoinTable({
    // IMPORTANT: use a **different** join-table name (NOT "plan_exercises")
    name: 'plan_day_exercise_links',
    joinColumn: { name: 'plan_day_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'plan_exercise_id', referencedColumnName: 'id' },
  })
  exercises!: PlanExercises[]; 
}


@Entity('plan_exercises')
export class PlanExercises extends CoreEntity {
  @ManyToMany(() => PlanDay, d => d.exercises)
  day!: PlanDay[];

  @Index()
  @Column({ type: 'varchar', length: 160 })
  name: string;

  // NEW: human-readable details (matches your "details")
  @Column({ type: 'text', nullable: true })
  details?: string | null;

  // NEW: "Back / Compound" etc.
  @Column({ type: 'varchar', length: 80, nullable: true })
  category?: string | null;

  // NEW: arrays of muscles (PostgreSQL)
  @Column('text', { array: true, default: '{}' })
  primaryMusclesWorked: string[];

  @Column('text', { array: true, default: '{}' })
  secondaryMusclesWorked: string[];

  @Column({ type: 'varchar', length: 50, default: '10' })
  targetReps: string;

  @Column({ type: 'int', default: 3 })
  targetSets: number;

  @Column({ type: 'int', default: 90 })
  rest: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  tempo?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  img?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  video?: string | null;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;
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

@Entity('exercise_videos')
export class ExerciseVideo extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 160 })
  exerciseName: string;

  @Column({ type: 'varchar', length: 512 })
  videoUrl: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status: string; // pending, reviewed, approved, needs_work

  @Column({ type: 'text', nullable: true })
  coachFeedback: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'coachId' })
  coach: User;

  @Column({ type: 'uuid', nullable: true })
  coachId: string;

  @Column({ type: 'date' })
  workoutDate: string;

  @Column({ type: 'int', nullable: true })
  setNumber: number;

  @Column({ type: 'decimal', precision: 7, scale: 2, nullable: true })
  weight: string;

  @Column({ type: 'int', nullable: true })
  reps: number;
}

@Entity('exercise_records')
@Unique('uq_user_exercise_date', ['userId', 'exerciseId', 'date'])
@Index(['userId', 'exerciseId', 'date'])
@Index(['userId', 'date'])
@Index(['exerciseId', 'date'])
export class ExerciseRecord extends CoreEntity {
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 50 })
  exerciseId: string;

  @Column({ type: 'varchar', length: 160 })
  exerciseName: string;

  @Column({ type: 'varchar', length: 20 })
  day: string;

  @Column({ type: 'date' })
  date: string;

  // Today's workout sets
  @Column({ type: 'jsonb' })
  workoutSets: Array<{
    setNumber: number;
    weight: number;
    reps: number;
    done: boolean;
    e1rm: number;
    isPr: boolean;
  }>;

  // Last successful sets for progressive overload
  @Column({ type: 'jsonb', nullable: true })
  previousBestSets: Array<{
    setNumber: number;
    weight: number;
    reps: number;
    date: string;
    totalVolume: number;
  }>;

  // Calculated metrics
  @Column({ type: 'int', default: 0 })
  totalVolume: number;

  @Column({ type: 'int', default: 0 })
  maxWeight: number;

  @Column({ type: 'int', default: 0 })
  maxReps: number;

  @Column({ type: 'int', default: 0 })
  bestE1rm: number;

  @Column({ type: 'boolean', default: false })
  isPersonalRecord: boolean;

  // Store personal record history in the same record
  @Column({ type: 'jsonb', nullable: true })
  prHistory: Array<{
    date: string;
    bestE1rm: number;
    weight: number;
    reps: number;
  }>;
}

//============== Food

@Entity('foods')
export class Food extends CoreEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  category?: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  calories!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  protein!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  carbs!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  fat!: number;

  @Column({ type: 'varchar', length: 50, default: 'g' })
  unit!: string;
}

@Entity('meal_plan_days')
export class MealPlanDay extends CoreEntity {
  @ManyToOne(() => MealPlan, mp => mp.days, { onDelete: 'CASCADE' })
  mealPlan!: MealPlan;

  @Column({ type: 'enum', enum: DayOfWeek })
  day!: DayOfWeek;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @OneToMany(() => MealPlanFood, f => f.day, { cascade: true })
  foods!: MealPlanFood[];
}

@Entity('meal_plan_foods')
export class MealPlanFood extends CoreEntity {
  @ManyToOne(() => MealPlanDay, d => d.foods, { onDelete: 'CASCADE' })
  day!: MealPlanDay;

  // inline food details (no FK to another module)
  @Column({ type: 'varchar', length: 200, nullable: true })
  name!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  category?: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  calories!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  protein!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  carbs!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  fat!: number;

  @Column({ type: 'varchar', length: 50, default: 'g' })
  unit!: string;

  // per-plan quantity & classification
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  quantity!: number;

  @Column({ type: 'enum', enum: MealType, default: MealType.BREAKFAST })
  mealType!: MealType;

  @Column({ type: 'int', default: 0 })
  orderIndex: number;
}

@Entity('meal_plan_assignments')
@Unique(['mealPlan', 'athlete'])
export class MealPlanAssignment extends CoreEntity {
  @ManyToOne(() => MealPlan, mp => mp.assignments, { onDelete: 'CASCADE' })
  mealPlan!: MealPlan;

  @ManyToOne(() => User, u => u.mealPlanAssignments, { onDelete: 'CASCADE' })
  athlete!: User;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ type: 'date', nullable: true })
  endDate!: string | null;
}

// logs a user's action on a single meal item (or a free-text item)
@Entity('meal_intake_logs')
@Unique(['userId', 'date', 'mealType', 'itemName'])
export class MealIntakeLog extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;
  @Column({ type: 'uuid' }) userId!: string;

  // optional: link to assignment for reporting
  @ManyToOne(() => MealPlanAssignment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignmentId' })
  assignment?: MealPlanAssignment | null;
  @Column({ type: 'uuid', nullable: true }) assignmentId?: string | null;

  // optional: link to a concrete plan item (kept nullable to allow ad-hoc foods)
  @ManyToOne(() => MealPlanFood, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'planFoodId' })
  planFood?: MealPlanFood | null;
  @Column({ type: 'uuid', nullable: true }) planFoodId?: string | null;

  @Column({ type: 'date' })
  date!: string; // YYYY-MM-DD

  @Column({ type: 'enum', enum: DayOfWeek })
  day!: DayOfWeek;

  @Column({ type: 'enum', enum: MealType })
  mealType!: MealType;

  // denormalized for convenience + to support custom items
  @Column({ type: 'varchar', length: 200 })
  itemName!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  quantity!: number;

  // actions
  @Column({ type: 'boolean', default: false })
  taken!: boolean;

  @Column({ type: 'timestamp with time zone', nullable: true })
  takenAt?: Date | null;

  @Column({ type: 'varchar', length: 240, nullable: true })
  notes?: string | null; // problem / feedback

  @Column({ type: 'varchar', length: 240, nullable: true })
  suggestedAlternative?: string | null; // “what I have at home”
}

//============= chat

@Entity('chat_conversations')
export class ChatConversation extends CoreEntity {
  @Column({ type: 'varchar', length: 200, nullable: true })
  name: string | null;

  @Column({ type: 'boolean', default: false })
  isGroup: boolean;

  @Column({ type: 'varchar', length: 512, nullable: true })
  avatar: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @OneToMany(() => ChatParticipant, participant => participant.conversation)
  chatParticipants: ChatParticipant[];

  @OneToMany(() => ChatMessage, message => message.conversation)
  messages: ChatMessage[];

  @Column({ type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  get participants(): User[] {
    if (!this.chatParticipants) return [];
    return this.chatParticipants
      .filter(p => p.isActive)
      .map(p => p.user)
      .filter(user => user !== null && user !== undefined);
  }
}

// In your ChatParticipant entity
@Entity('chat_participants')
@Unique(['conversation', 'user'])
export class ChatParticipant extends CoreEntity {
  @ManyToOne(() => ChatConversation, conversation => conversation.chatParticipants, { onDelete: 'CASCADE' })
  conversation: ChatConversation;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nickname: string | null;

  // FIX: Make isAdmin nullable or set default
  @Column({ type: 'boolean', default: false })
  isAdmin: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastReadAt: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}

// In your ChatMessage entity in global.entity.ts
@Entity('chat_messages')
export class ChatMessage extends CoreEntity {
  @ManyToOne(() => ChatConversation, conversation => conversation.messages, { onDelete: 'CASCADE' })
  conversation: ChatConversation;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  sender: User;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'varchar', length: 50, default: 'text' })
  messageType: string; // 'text', 'image', 'file', 'system'

  @Column({ type: 'jsonb', nullable: true })
  attachments: {
    name: string;
    type: string;
    size: number;
    url: string;
  }[]; // Array of attachment objects

  @Column({ type: 'boolean', default: false })
  isEdited: boolean;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @ManyToOne(() => ChatMessage, { nullable: true })
  @JoinColumn({ name: 'replyToId' })
  replyTo: ChatMessage | null;

  @Column({ type: 'uuid', nullable: true })
  replyToId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  reactions: any;

  @Column({ type: 'timestamptz', nullable: true })
  readBy: Date | null;
}

// INTAKE

@Entity()
export class Form {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @OneToMany(() => FormField, field => field.form, { cascade: true })
  fields: FormField[];

  @OneToMany(() => FormSubmission, submission => submission.form)
  submissions: FormSubmission[];

  @CreateDateColumn()
  created_at: Date;
}

export enum FieldType {
  TEXT = 'text',
  NUMBER = 'number',
  PHONE = 'phone',
  DATE = 'date',
  SELECT = 'select',
  RADIO = 'radio',
  CHECKBOX = 'checkbox',
  TEXTAREA = 'textarea',
  EMAIL = 'email',
  FILE = 'file',
  CHECKLIST = 'checklist',
}

@Entity()
export class FormField {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  label: string;

  @Column()
  key: string;

  @Column({ nullable: true })
  placeholder: string;

  @Column({ type: 'enum', enum: FieldType })
  type: FieldType;

  @Column({ default: false })
  required: boolean;

  @Column({ type: 'jsonb', nullable: true })
  options: string[];

  @Column()
  order: number;

  @ManyToOne(() => Form, form => form.fields, { onDelete: 'CASCADE' })
  @JoinColumn()
  form: Form;
}

@Entity()
export class FormSubmission {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Form, form => form.submissions, { onDelete: 'CASCADE' })
  @JoinColumn()
  form: Form;

  @Column()
  email: string;

  @Column()
  phone: string;

  @Column()
  ipAddress: string;

  @Column('jsonb')
  answers: Record<string, any>;

  @CreateDateColumn()
  created_at: Date;
}

// --- Notifications -----------------------------------------------------------
export enum NotificationAudience {
  ADMIN = 'ADMIN',
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

export enum NotificationType {
  FORM_SUBMISSION = 'FORM_SUBMISSION',
  SUBSCRIPTION_EXPIRED_LOGIN = 'SUBSCRIPTION_EXPIRED_LOGIN',
  // add more types later...
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  data?: Record<string, any> | null;

  // optional: attach to a user if you want per-user inbox (safe to keep nullable)
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  // audience hint (useful if you don’t pass a specific user)
  @Column({ type: 'enum', enum: NotificationAudience, default: NotificationAudience.ADMIN })
  audience: NotificationAudience;

  @Column({ default: false })
  isRead: boolean;

  @CreateDateColumn()
  created_at: Date;
}
