// src/entities/recipes.entity.ts
import {
	Entity,
	Column,
	Index,
	ManyToOne,
	OneToMany,
	JoinColumn,
	Unique,
} from 'typeorm';
import { CoreEntity } from './core.entity';
import { User } from './global.entity';



export enum RecipeIngredientGroup {
	MAIN = 'main',
	CREAM = 'cream',
	SAUCE = 'sauce',
	TOPPING = 'topping',
	OPTIONAL = 'optional',
}

@Entity('recipes')
export class Recipe extends CoreEntity {
	@Index()
	@Column({ type: 'varchar', length: 200 })
	title!: string;

	@Column({ type: 'varchar', length: 512, nullable: true })
	imageUrl?: string | null;

	@Column({ type: 'varchar', length: 512, nullable: true })
	videoUrl?: string | null;

	@Column({ type: 'varchar', length: 512, nullable: true })
	satietyIndex!: any;

	@Column({ type: 'int', default: 0 })
	calories!: number;

	@Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
	carbsG!: number;

	@Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
	proteinG!: number;

	@Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
	fatG!: number;

	@Column({ type: 'boolean', default: true })
	isActive!: boolean;

	@Column({ type: 'text', nullable: true })
	mealType?: string | null;

	@Column({ type: 'text', nullable: true })
	notes?: string | null;

	// optional: who created this recipe
	@ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'adminId' })
	admin?: User | null;

	@Index()
	@Column({ type: 'uuid', nullable: true })
	adminId?: string | null;

	@OneToMany(() => RecipeIngredient, (ingredient) => ingredient.recipe, {
		cascade: true,
	})
	ingredients!: RecipeIngredient[];

	@OneToMany(() => RecipeStep, (step) => step.recipe, {
		cascade: true,
	})
	steps!: RecipeStep[];

	@OneToMany(() => RecipeTip, (tip) => tip.recipe, {
		cascade: true,
	})
	tips!: RecipeTip[];
}

@Entity('recipe_ingredients')
@Unique(['recipe', 'group', 'orderIndex'])
export class RecipeIngredient extends CoreEntity {
	@ManyToOne(() => Recipe, (recipe) => recipe.ingredients, {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'recipe_id' })
	recipe!: Recipe;

	@Column({
		type: 'enum',
		enum: RecipeIngredientGroup,
		default: RecipeIngredientGroup.MAIN,
	})
	group!: RecipeIngredientGroup;

	@Column({ name: 'order_index', type: 'int', default: 0 })
	orderIndex!: number;

	@Column({ type: 'varchar', length: 255 })
	text!: string;
}

@Entity('recipe_steps')
@Unique(['recipe', 'stepNumber'])
export class RecipeStep extends CoreEntity {
	@ManyToOne(() => Recipe, (recipe) => recipe.steps, {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'recipe_id' })
	recipe!: Recipe;

	@Column({ name: 'step_number', type: 'int' })
	stepNumber!: number;

	@Column({ type: 'text' })
	instruction!: string;
}

@Entity('recipe_tips')
@Unique(['recipe', 'orderIndex'])
export class RecipeTip extends CoreEntity {
	@ManyToOne(() => Recipe, (recipe) => recipe.tips, {
		onDelete: 'CASCADE',
	})
	@JoinColumn({ name: 'recipe_id' })
	recipe!: Recipe;

	@Column({ name: 'order_index', type: 'int', default: 0 })
	orderIndex!: number;

	@Column({ type: 'text' })
	text!: string;
}