import { Column, Entity, Index } from 'typeorm';
import { CoreEntity } from './core.entity';

export const FOOD_BASE_UNITS = ['g', 'ml'] as const;
export type FoodBaseUnit = (typeof FOOD_BASE_UNITS)[number];

export const FOOD_SOURCES = ['manual', 'seed', 'usda', 'openfoodfacts', 'ai'] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

export const FOOD_CATEGORIES = [
	'meat', 'seafood', 'dairy', 'grains', 'fruits', 'vegetables', 'legumes', 'nuts', 'fats', 'sweets',
	'beverages', 'fast_food', 'arabic', 'condiments', 'supplements', 'international', 'canned', 'breakfast',
	'soups', 'other',
] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

/** Must match the generated column in migrations/20261015_foods_database.sql. */
export const FOOD_SEARCH_TEXT_SQL = `lower(regexp_replace(translate(coalesce(name_ar, '') || ' ' || coalesce(name_en, '') || ' ' || coalesce(aliases, '') || ' ' || coalesce(brand, ''), 'أإآٱىةؤئ', 'اااايهوي'), '[\\u064B-\\u065F\\u0670\\u0640]', '', 'g'))`;

const decimal = { type: 'decimal' as const, precision: 8, scale: 2, transformer: { to: (v: any) => v, from: (v: any) => (v == null ? null : Number(v)) } };

/** One product in the nutrition catalog. Nutrients are per 100 of `baseUnit`. */
@Entity('foods')
export class Food extends CoreEntity {
	@Column({ name: 'name_ar', type: 'varchar', length: 200, default: '' })
	nameAr!: string;

	@Column({ name: 'name_en', type: 'varchar', length: 200, default: '' })
	nameEn!: string;

	@Column({ type: 'text', nullable: true })
	aliases!: string | null;

	@Index()
	@Column({ type: 'varchar', length: 40, default: 'other' })
	category!: string;

	@Column({ type: 'varchar', length: 120, nullable: true })
	brand!: string | null;

	@Column({ type: 'varchar', length: 64, nullable: true })
	barcode!: string | null;

	@Column({ name: 'base_unit', type: 'varchar', length: 4, default: 'g' })
	baseUnit!: FoodBaseUnit;

	@Column({ ...decimal, default: 0 })
	kcal!: number;

	@Column({ ...decimal, default: 0 })
	protein!: number;

	@Column({ ...decimal, default: 0 })
	carbs!: number;

	@Column({ ...decimal, default: 0 })
	fat!: number;

	@Column({ ...decimal, nullable: true })
	fiber!: number | null;

	@Column({ ...decimal, nullable: true })
	sugar!: number | null;

	@Column({ ...decimal, name: 'saturated_fat', nullable: true })
	saturatedFat!: number | null;

	@Column({ ...decimal, name: 'sodium_mg', precision: 10, nullable: true })
	sodiumMg!: number | null;

	@Column({ ...decimal, name: 'piece_grams', nullable: true })
	pieceGrams!: number | null;

	@Column({ name: 'piece_label_ar', type: 'varchar', length: 80, nullable: true })
	pieceLabelAr!: string | null;

	@Column({ name: 'piece_label_en', type: 'varchar', length: 80, nullable: true })
	pieceLabelEn!: string | null;

	/** NULL = global catalog; otherwise private to this admin's team. */
	@Index()
	@Column({ name: 'admin_id', type: 'uuid', nullable: true })
	adminId!: string | null;

	@Column({ name: 'created_by_id', type: 'uuid', nullable: true })
	createdById!: string | null;

	@Column({ type: 'varchar', length: 20, default: 'manual' })
	source!: FoodSource;

	@Column({ name: 'source_ref', type: 'varchar', length: 120, nullable: true })
	sourceRef!: string | null;

	@Column({ type: 'boolean', default: false })
	verified!: boolean;

	@Column({ name: 'seed_key', type: 'varchar', length: 80, nullable: true, select: false })
	seedKey!: string | null;

	@Column({
		name: 'search_text',
		type: 'text',
		select: false,
		insert: false,
		update: false,
		generatedType: 'STORED',
		asExpression: FOOD_SEARCH_TEXT_SQL,
	})
	searchText!: string;
}
