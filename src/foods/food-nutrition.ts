/** Quantity units a plan item can use. */
export const ITEM_UNITS = ['g', 'mg', 'ml', 'count'] as const;
export type ItemUnit = (typeof ITEM_UNITS)[number];

export type FoodNutritionSource = {
	kcal: number | string;
	protein: number | string;
	carbs: number | string;
	fat: number | string;
	fiber?: number | string | null;
	sugar?: number | string | null;
	pieceGrams?: number | string | null;
};

export type ItemNutrition = {
	grams: number;
	kcal: number;
	protein: number;
	carbs: number;
	fat: number;
	fiber: number | null;
	sugar: number | null;
};

const num = (v: unknown): number | null => {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function normalizeItemUnit(unit: unknown): ItemUnit {
	const u = String(unit ?? '').toLowerCase();
	if (u === 'mg') return 'mg';
	if (u === 'ml') return 'ml';
	if (u === 'count' || u === 'pcs' || u === 'piece') return 'count';
	return 'g';
}

/**
 * Weight in grams for a quantity of a food. ml is treated as 1 g/ml.
 * Returns null when the amount cannot be converted (e.g. pieces of a food with no piece weight).
 */
export function gramsFor(food: Pick<FoodNutritionSource, 'pieceGrams'>, quantity: unknown, unit: unknown): number | null {
	const qty = num(quantity);
	if (qty === null || qty < 0) return null;
	switch (normalizeItemUnit(unit)) {
		case 'mg':
			return qty / 1000;
		case 'count': {
			const piece = num(food.pieceGrams);
			return piece && piece > 0 ? qty * piece : null;
		}
		default:
			return qty;
	}
}

/** Nutrition for a quantity of a food whose values are stored per 100 g (or 100 ml). */
export function nutritionFor(food: FoodNutritionSource, quantity: unknown, unit: unknown): ItemNutrition | null {
	const grams = gramsFor(food, quantity, unit);
	if (grams === null) return null;
	const factor = grams / 100;
	const scale = (v: unknown) => round1((num(v) ?? 0) * factor);
	const scaleOptional = (v: unknown) => (num(v) === null ? null : round1((num(v) as number) * factor));
	return {
		grams: round1(grams),
		kcal: Math.round((num(food.kcal) ?? 0) * factor),
		protein: scale(food.protein),
		carbs: scale(food.carbs),
		fat: scale(food.fat),
		fiber: scaleOptional(food.fiber),
		sugar: scaleOptional(food.sugar),
	};
}
