// src/entities/global.entity.ts
import { Entity, Column, Index, ManyToOne, OneToMany, Unique, JoinColumn, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, BaseEntity } from 'typeorm';
import { Asset } from './assets.entity';

/* =========================================================
 * Enums & Shared Types
 * ======================================================= */
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

export type RepsPattern = string;

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

export enum ExerciseStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

/* =========================================================
 * CoreEntity
 * ======================================================= */
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

@Entity('exercises')
export class Exercise extends CoreEntity {
  @Index()
  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  details?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  category?: string | null;

  // PostgreSQL arrays
  @Column('text', { array: true, default: '{}' })
  primaryMusclesWorked!: string[];

  @Column('text', { array: true, default: '{}' })
  secondaryMusclesWorked!: string[];

  // Defaults (مرجعية فقط)
  @Column({ type: 'varchar', length: 50, default: '10' })
  targetReps!: string;

  @Column({ type: 'int', default: 3 })
  targetSets!: number;

  @Column({ type: 'int', default: 90 })
  rest!: number; // seconds

  @Column({ type: 'varchar', length: 32, nullable: true })
  tempo?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  img?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  video?: string | null;
}

@Entity('exercise_plans')
export class ExercisePlan extends CoreEntity {
  @Index()
  @Column({ type: 'varchar', length: 180 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  desc?: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => ExercisePlanDay, d => d.plan, { cascade: true })
  days!: ExercisePlanDay[];
}

@Entity('exercise_plan_days')
@Unique(['plan', 'day'])
export class ExercisePlanDay extends CoreEntity {
  @ManyToOne(() => ExercisePlan, p => p.days, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan!: ExercisePlan;

  @Column({ type: 'enum', enum: DayOfWeek })
  day!: DayOfWeek;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name?: string | null;

  @OneToMany(() => ExercisePlanDayExercise, pde => pde.day, { cascade: true })
  items!: ExercisePlanDayExercise[];
}

@Entity('exercise_plan_day_exercises')
@Unique(['day', 'exercise'])
export class ExercisePlanDayExercise extends CoreEntity {
  @ManyToOne(() => ExercisePlanDay, d => d.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'day_id' })
  day!: ExercisePlanDay;

  @ManyToOne(() => Exercise, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'exercise_id' })
  exercise!: Exercise;

  @Index()
  @Column({ name: 'order_index', type: 'int', default: 0 })
  orderIndex!: number;
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

  @Column({ type: 'text', nullable: true })
  notes!: string | null; // Bullet points notes

  @Column({ type: 'boolean', default: false })
  customizeDays!: boolean; // Enable day overrides

  // Who it's assigned to
  @OneToMany(() => MealPlanAssignment, a => a.mealPlan, { cascade: true })
  assignments!: MealPlanAssignment[];

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

  /* password reset OTP/token + expiry */
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

  // NEW: active exercise plan linkage (replaces old activePlanId/activePlan->Plan)
  @Index()
  @Column({ type: 'uuid', nullable: true })
  activeExercisePlanId!: string | null;

  @ManyToOne(() => ExercisePlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'activeExercisePlanId' })
  activeExercisePlan!: ExercisePlan | null;

  // MealPlan linkage (unchanged)
  @Index()
  @Column({ type: 'uuid', nullable: true })
  activeMealPlanId!: string | null;

  @ManyToOne(() => MealPlan, mp => mp.activeUsers, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'activeMealPlanId' })
  activeMealPlan!: MealPlan | null;

  @OneToMany(() => MealPlanAssignment, a => a.athlete)
  mealPlanAssignments!: MealPlanAssignment[];

  @OneToMany(() => Asset, upload => upload.user)
  uploads: Asset[];

  @OneToMany(() => ChatParticipant, participant => participant.user)
  chatParticipants: ChatParticipant[];

  @OneToMany(() => ChatMessage, message => message.sender)
  sentMessages: ChatMessage[];
}

/* =========================================================
 * Exercise Video & Records
 * ======================================================= */
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

@Entity('meal_plan_days')
export class MealPlanDay extends CoreEntity {
  @ManyToOne(() => MealPlan, mp => mp.days, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meal_plan_id' })
  mealPlan!: MealPlan;

  @Column({ type: 'enum', enum: DayOfWeek })
  day!: DayOfWeek;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @OneToMany(() => Meal, meal => meal.day, { cascade: true })
  meals!: Meal[];

  @OneToMany(() => Supplement, supplement => supplement.day, { cascade: true })
  supplements!: Supplement[];

  // Keep existing foods for backward compatibility
  @OneToMany(() => MealPlanFood, f => f.day, { cascade: true })
  foods!: MealPlanFood[];
}

@Entity('meal_plan_foods')
export class MealPlanFood extends CoreEntity {
  @ManyToOne(() => MealPlanDay, d => d.foods, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'day_id' })
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

  // Vitamin and mineral fields
  @Column({ type: 'varchar', length: 200, nullable: true })
  vitamin?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  mineral?: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  timing?: string | null; // 'before', 'after', 'with'

  @Column({ type: 'varchar', length: 200, nullable: true })
  bestWith?: string | null; // what to take it with

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  fiber!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  sodium!: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  sugar!: number;
}

@Entity('meal_plan_assignments')
@Unique(['mealPlan', 'athlete'])
export class MealPlanAssignment extends CoreEntity {
  @ManyToOne(() => MealPlan, mp => mp.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meal_plan_id' })
  mealPlan!: MealPlan;

  @ManyToOne(() => User, u => u.mealPlanAssignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'athlete_id' })
  athlete!: User;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ type: 'date', nullable: true })
  endDate!: string | null;
}

/* ==================== Meals & Supplements ==================== */
@Entity('meals')
export class Meal extends CoreEntity {
  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 5, nullable: true }) // HH:MM format
  time!: string | null;

  @ManyToOne(() => MealPlanDay, day => day.meals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'day_id' })
  day!: MealPlanDay;

  @OneToMany(() => MealItem, item => item.meal, { cascade: true })
  items!: MealItem[];

  @OneToMany(() => Supplement, supp => supp.meal, { cascade: true })
  supplements!: Supplement[];

  @Column({ type: 'int', default: 0 })
  orderIndex!: number;
}

@Entity('meal_items')
export class MealItem extends CoreEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  // REMOVED: description, protein, carbs, fat
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  quantity!: number | null; // grams

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  calories!: number;

  @ManyToOne(() => Meal, meal => meal.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meal_id' })
  meal!: Meal;

  @Column({ type: 'int', default: 0 })
  orderIndex!: number;
}

@Entity('supplements')
export class Supplement extends CoreEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 5, nullable: true }) // HH:MM format
  time!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  bestWith!: string | null;

  // e.g. before / after / with / empty-stomach
  @Column({ type: 'varchar', length: 100, nullable: true })
  timing!: string | null;

  @ManyToOne(() => MealPlanDay, day => day.supplements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'day_id' })
  day!: MealPlanDay;

  @ManyToOne(() => Meal, meal => meal.supplements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meal_id' })
  meal!: Meal;

  @Column({ type: 'int', default: 0 })
  orderIndex!: number;
}

/* =========================================================
 * Meal Logs / Food Suggestions / Nutrition Stats
 * ======================================================= */
@Entity('meal_logs')
export class MealLog extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => MealPlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'planId' })
  plan!: MealPlan | null;

  @Column({ type: 'uuid', nullable: true })
  planId!: string | null;

  @Column({ type: 'varchar', length: 20 })
  day!: string;

  @Column({ type: 'varchar', length: 100 })
  dayName!: string;

  @Column({ type: 'int' })
  mealIndex!: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  mealTitle!: string | null;

  @Column({ type: 'timestamptz' })
  eatenAt!: Date;

  @Column({ type: 'int' })
  adherence!: number; // 1-5 scale

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'boolean', default: false })
  notifyCoach!: boolean;

  @OneToMany(() => MealLogItem, item => item.mealLog, { cascade: true })
  items!: MealLogItem[];

  @OneToMany(() => ExtraFood, food => food.mealLog, { cascade: true })
  extraFoods!: ExtraFood[];

  @OneToMany(() => SupplementLog, supplement => supplement.mealLog, { cascade: true })
  supplementsTaken!: SupplementLog[];
}

@Entity('meal_log_items')
export class MealLogItem extends CoreEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'boolean', default: false })
  taken!: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  quantity!: number | null;

  @ManyToOne(() => MealLog, mealLog => mealLog.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meal_log_id' })
  mealLog!: MealLog;
}

@Entity('extra_foods')
export class ExtraFood extends CoreEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  quantity!: number | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  calories!: number | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  protein!: number | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  carbs!: number | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  fat!: number | null;

  @ManyToOne(() => MealLog, mealLog => mealLog.extraFoods, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meal_log_id' })
  mealLog!: MealLog;
}

@Entity('supplement_logs')
export class SupplementLog extends CoreEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'boolean', default: false })
  taken!: boolean;

  @ManyToOne(() => MealLog, mealLog => mealLog.supplementsTaken, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meal_log_id' })
  mealLog!: MealLog;
}

@Entity('food_suggestions')
export class FoodSuggestion extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  day!: string;

  @Column({ type: 'int' })
  mealIndex!: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  mealTitle!: string | null;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'boolean', default: true })
  wantsAlternative!: boolean;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  coachFeedback!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewedById' })
  reviewedBy!: User | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedById!: string | null;
}

@Entity('nutrition_stats')
export class NutritionStats extends CoreEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'int', default: 0 })
  streak!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  avgAdherence!: number;

  @Column({ type: 'int', default: 0 })
  totalCalories!: number;

  @Column({ type: 'int', default: 0 })
  totalProtein!: number;

  @Column({ type: 'int', default: 0 })
  totalCarbs!: number;

  @Column({ type: 'int', default: 0 })
  totalFat!: number;

  @Column({ type: 'int', default: 0 })
  mealsLogged!: number;

  @Column({ type: 'int', default: 0 })
  supplementsTaken!: number;

  @Column({ type: 'int', default: 0 })
  extrasCount!: number;

  @Column({ type: 'jsonb', nullable: true })
  dailyBreakdown!: {
    adherence: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meals: number;
    supplements: number;
    extras: number;
  } | null;
}

/* =========================================================
 * Chat
 * ======================================================= */
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

@Entity('chat_participants')
@Unique(['conversation', 'user'])
export class ChatParticipant extends CoreEntity {
  @ManyToOne(() => ChatConversation, conversation => conversation.chatParticipants, { onDelete: 'CASCADE' })
  conversation: ChatConversation;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nickname: string | null;

  @Column({ type: 'boolean', default: false })
  isAdmin: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastReadAt: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}

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

/* =========================================================
 * Intake (Forms)
 * ======================================================= */
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

/* =========================================================
 * Notifications
 * ======================================================= */
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
