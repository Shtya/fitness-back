function positiveInt(value: unknown, fallback: number): number {
	const parsed = Math.floor(Number(value));
	return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

/**
 * Query-string pagination that always yields a usable page/limit. `page=abc`
 * or `page=0` used to reach TypeORM as NaN / a negative OFFSET and 500.
 */
export function parsePagination(
	page: unknown,
	limit: unknown,
	options: { defaultLimit?: number; maxLimit?: number } = {},
) {
	const defaultLimit = options.defaultLimit ?? 20;
	const maxLimit = options.maxLimit ?? 100;
	const safePage = positiveInt(page, 1);
	const take = Math.min(maxLimit, positiveInt(limit, defaultLimit));
	return { page: safePage, limit: take, take, skip: (safePage - 1) * take };
}
