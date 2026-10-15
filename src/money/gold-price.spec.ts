import { goldValue, gramPrices, isGoldKarat } from './gold-price';

describe('gold price', () => {
	it('converts USD per troy ounce to EGP per gram for each karat', () => {
		// 3110.34768 USD/oz = 100 USD/g pure; at 50 EGP/USD = 5000 EGP/g for 24K.
		const prices = gramPrices(3110.34768, 50);
		expect(prices[24]).toBe(5000);
		expect(prices[22]).toBe(4583.33);
		expect(prices[21]).toBe(4375);
		expect(prices[18]).toBe(3750);
	});

	it('values grams at the karat price', () => {
		const prices = gramPrices(3110.34768, 50);
		expect(goldValue(12.5, 21, prices)).toBe(54687.5);
		expect(goldValue(1.234, 18, prices)).toBe(4627.5);
	});

	it('has no value without a quote or with an unknown karat', () => {
		expect(goldValue(10, 21, null)).toBeNull();
		expect(goldValue(10, 14, gramPrices(3000, 50))).toBeNull();
		expect(isGoldKarat(21)).toBe(true);
		expect(isGoldKarat('18')).toBe(true);
		expect(isGoldKarat(9)).toBe(false);
	});
});
