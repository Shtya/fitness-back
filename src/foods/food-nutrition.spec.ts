import { gramsFor, normalizeItemUnit, nutritionFor } from './food-nutrition';
import { foodSearchTokens, normalizeFoodText } from './food-search';
import { foodOwnerFor } from './foods.service';
import { UserRole } from '../../entities/global.entity';

const chicken = { kcal: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sugar: 0, pieceGrams: null };
const egg = { kcal: '144.00', protein: '12.60', carbs: '0.80', fat: '9.60', fiber: null, sugar: null, pieceGrams: '50.00' };

describe('food nutrition', () => {
	it('scales per-100 g values by grams', () => {
		expect(nutritionFor(chicken, 200, 'g')).toEqual({ grams: 200, kcal: 330, protein: 62, carbs: 0, fat: 7.2, fiber: 0, sugar: 0 });
	});

	it('converts pieces with the piece weight and keeps unknown fiber/sugar as null', () => {
		expect(nutritionFor(egg, 3, 'count')).toEqual({ grams: 150, kcal: 216, protein: 18.9, carbs: 1.2, fat: 14.4, fiber: null, sugar: null });
		expect(nutritionFor(egg, 2, 'piece')?.grams).toBe(100);
	});

	it('returns null when pieces cannot be converted or the quantity is missing', () => {
		expect(nutritionFor(chicken, 2, 'count')).toBeNull();
		expect(nutritionFor(chicken, null, 'g')).toBeNull();
		expect(nutritionFor(chicken, -5, 'g')).toBeNull();
	});

	it('handles mg and ml', () => {
		expect(gramsFor(chicken, 500, 'mg')).toBe(0.5);
		expect(gramsFor(chicken, 250, 'ml')).toBe(250);
		expect(normalizeItemUnit('pcs')).toBe('count');
		expect(normalizeItemUnit('weird')).toBe('g');
	});
});

describe('food search text', () => {
	it('folds Arabic letter variants and diacritics like the search_text column', () => {
		expect(normalizeFoodText('بيضة مسلوقة')).toBe('بيضه مسلوقه');
		expect(normalizeFoodText('أرز إيطالي آسيوي')).toBe('ارز ايطالي اسيوي');
		expect(normalizeFoodText('مُكَرَّرَة')).toBe('مكرره');
		expect(normalizeFoodText('  Chicken   BREAST ')).toBe('chicken breast');
	});

	it('drops the definite article and escapes LIKE wildcards', () => {
		expect(foodSearchTokens('الفراخ المشوية')).toEqual(['فراخ', 'مشويه']);
		expect(foodSearchTokens('لبن 2%')).toEqual(['لبن', '2\\%']);
		expect(foodSearchTokens('   ')).toEqual([]);
	});
});

describe('food owner scope', () => {
	it('maps each role to the team that owns its foods', () => {
		expect(foodOwnerFor({ id: 's', role: UserRole.SUPER_ADMIN })).toBeUndefined();
		expect(foodOwnerFor({ id: 'a', role: UserRole.ADMIN })).toBe('a');
		expect(foodOwnerFor({ id: 'c', role: UserRole.COACH, adminId: 'a' })).toBe('a');
		expect(foodOwnerFor({ id: 'x', role: UserRole.CLIENT, adminId: null })).toBeNull();
	});
});
