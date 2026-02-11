// backend/entities/meal_plans.entity.ts
import {
	Entity,
	Column,
	Index,
	ManyToOne,
	OneToMany,
	Unique,
	JoinColumn,
	PrimaryGeneratedColumn,
	CreateDateColumn,
	UpdateDateColumn,
	DeleteDateColumn,
	BaseEntity,
} from 'typeorm';
import { User } from './global.entity';

/** ========= shared enums for this module ========= */
export enum DayOfWeek {
	SATURDAY = 'saturday',
	SUNDAY = 'sunday',
	MONDAY = 'monday',
	TUESDAY = 'tuesday',
	WEDNESDAY = 'wednesday',
	THURSDAY = 'thursday',
	FRIDAY = 'friday',
}

export enum MealType {
	BREAKFAST = 'breakfast',
	LUNCH = 'lunch',
	DINNER = 'dinner',
	SNACK = 'snack',
}


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

/* ==================== Meal Plans ==================== */

@Entity('meal_plans')
export class MealPlan extends CoreEntity {
	@Index()
	@Column({ type: 'varchar', length: 180 })
	name!: string;

	@Column({ type: 'text', nullable: true })
	desc?: string | null;

	@Column({ type: 'boolean', default: true })
	isActive!: boolean;

	// Who created this meal plan (coach)
	@ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'coachId' })
	coach?: User | null;

	@OneToMany(() => User, (u) => u.activeMealPlan)
	activeUsers!: User[];


	@Index()
	@Column({ type: 'uuid', nullable: true })
	coachId?: string | null;

	@OneToMany(() => MealPlanDay, (d) => d.mealPlan, { cascade: true })
	days!: MealPlanDay[];

	@Column({ type: 'text', nullable: true })
	notes!: string | null;

	@Column({ type: 'boolean', default: false })
	customizeDays!: boolean;

	@OneToMany(() => MealPlanAssignment, (a) => a.mealPlan, { cascade: true })
	assignments!: MealPlanAssignment[];


	/** multi-tenant */
	@Index()
	@Column({ type: 'uuid', nullable: true })
	adminId?: string | null;
}

@Entity('meal_plan_days')
@Unique(['mealPlan', 'day'])
export class MealPlanDay extends CoreEntity {
	@ManyToOne(() => MealPlan, (mp) => mp.days, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'meal_plan_id' })
	mealPlan!: MealPlan;

	@Index()
	@Column({ type: 'enum', enum: DayOfWeek })
	day!: DayOfWeek;

	@Column({ type: 'varchar', length: 120 })
	name!: string;

	@OneToMany(() => Meal, (meal) => meal.day, { cascade: true })
	meals!: Meal[];

	@OneToMany(() => Supplement, (supplement) => supplement.day, { cascade: true })
	supplements!: Supplement[];

	// legacy (keep if you already have data)
	@OneToMany(() => MealPlanFood, (f) => f.day, { cascade: true })
	foods!: MealPlanFood[];
}

@Entity('meals')
@Index(['day', 'orderIndex'])
export class Meal extends CoreEntity {
	@Column({ type: 'varchar', length: 200 })
	title!: string;

	@Column({ type: 'varchar', length: 5, nullable: true }) // HH:MM
	time!: string | null;

	@ManyToOne(() => MealPlanDay, (day) => day.meals, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'day_id' })
	day!: MealPlanDay;

	@OneToMany(() => MealItem, (item) => item.meal, { cascade: true })
	items!: MealItem[];

	@OneToMany(() => Supplement, (supp) => supp.meal, { cascade: true })
	supplements!: Supplement[];

	@Index()
	@Column({ name: 'order_index', type: 'int', default: 0 })
	orderIndex!: number;
}

@Entity('meal_items')
@Index(['meal', 'orderIndex'])
export class MealItem extends CoreEntity {
	@Column({ type: 'varchar', length: 200 })
	name!: string;

	@Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
	quantity!: number | null;

	@Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
	calories!: number;

	@Column({ type: 'varchar', length: 20, default: 'g' })
	unit!: string;


	@ManyToOne(() => Meal, (meal) => meal.items, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'meal_id' })
	meal!: Meal;

	@Index()
	@Column({ name: 'order_index', type: 'int', default: 0 })
	orderIndex!: number;
}

@Entity('supplements')
@Index(['day', 'orderIndex'])
@Index(['meal', 'orderIndex'])
export class Supplement extends CoreEntity {
	@Column({ type: 'varchar', length: 200 })
	name!: string;

	@Column({ type: 'varchar', length: 5, nullable: true })
	time!: string | null;

	@Column({ type: 'varchar', length: 200, nullable: true })
	bestWith!: string | null;

	@Column({ type: 'varchar', length: 100, nullable: true })
	timing!: string | null;

	/** ✅ FIX: allow supplement to be day-level OR meal-level */
	@ManyToOne(() => MealPlanDay, (day) => day.supplements, { onDelete: 'CASCADE', nullable: true })
	@JoinColumn({ name: 'day_id' })
	day!: MealPlanDay | null;

	@ManyToOne(() => Meal, (meal) => meal.supplements, { onDelete: 'CASCADE', nullable: true })
	@JoinColumn({ name: 'meal_id' })
	meal!: Meal | null;

	@Index()
	@Column({ name: 'order_index', type: 'int', default: 0 })
	orderIndex!: number;
}

/** legacy foods (keep if you need backward compatibility) */
@Entity('meal_plan_foods')
export class MealPlanFood extends CoreEntity {
	@ManyToOne(() => MealPlanDay, (d) => d.foods, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'day_id' })
	day!: MealPlanDay;

	@Column({ type: 'varchar', length: 200, nullable: true })
	name!: string;

	@Column({ type: 'varchar', length: 80, nullable: true })
	category?: string | null;

	@Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
	calories!: number;

	@Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
	quantity!: number;

	@Column({ type: 'enum', enum: MealType, default: MealType.BREAKFAST })
	mealType!: MealType;

	@Index()
	@Column({ type: 'int', default: 0 })
	orderIndex: number;

	@Column({ type: 'varchar', length: 50, default: 'g' })
	unit!: string;

	@Column({ type: 'varchar', length: 50, nullable: true })
	timing?: string | null;

	@Column({ type: 'varchar', length: 200, nullable: true })
	bestWith?: string | null;

	@Column({ type: 'text', nullable: true })
	description?: string | null;
}

@Entity('meal_plan_assignments')
@Unique(['mealPlan', 'athlete'])
export class MealPlanAssignment extends CoreEntity {
	@ManyToOne(() => MealPlan, (mp) => mp.assignments, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'meal_plan_id' })
	mealPlan!: MealPlan;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'athlete_id' })
	athlete!: User;


	@Column({ type: 'boolean', default: true })
	isActive!: boolean;

	@Column({ type: 'date', nullable: true })
	startDate!: string | null;

	@Column({ type: 'date', nullable: true })
	endDate!: string | null;
}

/* ==================== Meal Logs / Suggestions / Stats ==================== */

@Entity('meal_logs')
@Index(['userId', 'eatenAt'])
@Index(['planId', 'day', 'mealIndex'])
export class MealLog extends CoreEntity {
	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId' })
	user!: User;

	@Index()
	@Column({ type: 'uuid' })
	userId!: string;

	@ManyToOne(() => MealPlan, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'planId' })
	plan!: MealPlan | null;

	@Index()
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
	adherence!: number;

	@Column({ type: 'text', nullable: true })
	notes!: string | null;

	@Column({ type: 'boolean', default: false })
	notifyCoach!: boolean;

	@OneToMany(() => MealLogItem, (item) => item.mealLog, { cascade: true })
	items!: MealLogItem[];

	@OneToMany(() => ExtraFood, (food) => food.mealLog, { cascade: true })
	extraFoods!: ExtraFood[];

	@OneToMany(() => SupplementLog, (supplement) => supplement.mealLog, { cascade: true })
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

	@ManyToOne(() => MealLog, (mealLog) => mealLog.items, { onDelete: 'CASCADE' })
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

	@ManyToOne(() => MealLog, (mealLog) => mealLog.extraFoods, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'meal_log_id' })
	mealLog!: MealLog;
}

@Entity('supplement_logs')
export class SupplementLog extends CoreEntity {
	@Column({ type: 'varchar', length: 200 })
	name!: string;

	@Column({ type: 'boolean', default: false })
	taken!: boolean;

	@ManyToOne(() => MealLog, (mealLog) => mealLog.supplementsTaken, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'meal_log_id' })
	mealLog!: MealLog;
}

@Entity('food_suggestions')
export class FoodSuggestion extends CoreEntity {
	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId' })
	user!: User;

	@Index()
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
@Index(['userId', 'date'])
export class NutritionStats extends CoreEntity {
	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId' })
	user!: User;

	@Index()
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
	mealsLogged!: number;

	@Column({ type: 'int', default: 0 })
	supplementsTaken!: number;

	@Column({ type: 'int', default: 0 })
	extrasCount!: number;

	@Column({ type: 'jsonb', nullable: true })
	dailyBreakdown!: any | null;
}
