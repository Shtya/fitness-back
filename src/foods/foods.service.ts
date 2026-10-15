import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Food, FOOD_CATEGORIES } from '../../entities/foods.entity';
import { UserRole } from '../../entities/global.entity';
import { parsePagination } from '../../common/pagination';
import { CreateFoodDto, UpdateFoodDto } from './dto/food.dto';
import { foodSearchTokens, normalizeFoodText } from './food-search';

export type FoodActor = { id: string; role: UserRole | string; adminId?: string | null };

/** The team a user belongs to; `undefined` means "sees everything" (super admin). */
export function foodOwnerFor(user: FoodActor): string | null | undefined {
	if (user?.role === UserRole.SUPER_ADMIN) return undefined;
	if (user?.role === UserRole.ADMIN) return user.id;
	return user?.adminId ?? null;
}

const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

@Injectable()
export class FoodsService {
	private readonly logger = new Logger(FoodsService.name);
	private trigramAvailable: boolean | null = null;

	constructor(@InjectRepository(Food) private readonly repo: Repository<Food>) {}

	toView(f: any, user?: FoodActor) {
		const adminId = f.adminId ?? f.admin_id ?? null;
		return {
			id: f.id,
			nameAr: f.nameAr ?? f.name_ar ?? '',
			nameEn: f.nameEn ?? f.name_en ?? '',
			aliases: f.aliases ?? null,
			category: f.category,
			brand: f.brand ?? null,
			barcode: f.barcode ?? null,
			baseUnit: f.baseUnit ?? f.base_unit ?? 'g',
			kcal: n(f.kcal) ?? 0,
			protein: n(f.protein) ?? 0,
			carbs: n(f.carbs) ?? 0,
			fat: n(f.fat) ?? 0,
			fiber: n(f.fiber),
			sugar: n(f.sugar),
			saturatedFat: n(f.saturatedFat ?? f.saturated_fat),
			sodiumMg: n(f.sodiumMg ?? f.sodium_mg),
			pieceGrams: n(f.pieceGrams ?? f.piece_grams),
			pieceLabelAr: f.pieceLabelAr ?? f.piece_label_ar ?? null,
			pieceLabelEn: f.pieceLabelEn ?? f.piece_label_en ?? null,
			source: f.source,
			sourceRef: f.sourceRef ?? f.source_ref ?? null,
			verified: !!f.verified,
			scope: adminId ? 'team' : 'global',
			canEdit: user ? this.canEdit(user, adminId) : false,
			updatedAt: f.updated_at ?? null,
		};
	}

	private canEdit(user: FoodActor, foodAdminId: string | null) {
		if (user.role === UserRole.SUPER_ADMIN) return true;
		if (user.role !== UserRole.ADMIN && user.role !== UserRole.COACH) return false;
		const owner = foodOwnerFor(user);
		return !!owner && foodAdminId === owner;
	}

	private async hasTrigram(): Promise<boolean> {
		if (this.trigramAvailable !== null) return this.trigramAvailable;
		try {
			const rows = await this.repo.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
			this.trigramAvailable = rows.length > 0;
		} catch {
			this.trigramAvailable = false;
		}
		return this.trigramAvailable;
	}

	/**
	 * Smart search for the picker. Exact and prefix matches first, then foods
	 * containing every word, then similar names (trigram or any-word match).
	 */
	async search(q: unknown, user: FoodActor, rawLimit?: unknown) {
		const full = normalizeFoodText(q);
		const tokens = foodSearchTokens(q);
		if (!full || !tokens.length) return { items: [] };
		const limit = Math.min(30, Math.max(1, Number(rawLimit) || 12));
		const trigram = await this.hasTrigram();

		const params: any[] = [];
		const p = (v: unknown) => {
			params.push(v);
			return `$${params.length}`;
		};

		const fullLike = full.replace(/[%_\\]/g, ch => `\\${ch}`);
		const prefix = p(`${fullLike}%`);
		const wordPrefix = p(`% ${fullLike}%`);
		// Tokens must start a word (optionally after "ال") so "رز" does not hit "كرز".
		const words = `(' ' || translate(f.search_text, '()-,/.', '      '))`;
		const wordMatch = (t: string) => `(${words} LIKE ${p(`% ${t}%`)} OR ${words} LIKE ${p(`% ال${t}%`)})`;
		const allTokens = tokens.map(wordMatch).join(' AND ');
		const anyTokens = tokens.length > 1 ? tokens.map(wordMatch).join(' OR ') : null;
		const fullParam = p(full);
		const similarity = trigram ? `word_similarity(${fullParam}, f.search_text)` : '0';

		const owner = foodOwnerFor(user);
		const scope = owner === undefined ? 'TRUE' : owner ? `(f.admin_id IS NULL OR f.admin_id = ${p(owner)})` : 'f.admin_id IS NULL';

		// Short words share many trigrams with unrelated names, so they need a closer match.
		const minSimilarity = full.length <= 5 ? 0.6 : 0.4;
		const matchers = [`(${allTokens})`];
		if (anyTokens) matchers.push(`(${anyTokens})`);
		if (trigram) matchers.push(`${similarity} >= ${minSimilarity}`);

		const sql = `
			SELECT f.*,
				CASE
					WHEN f.search_text LIKE ${prefix} THEN 0
					WHEN f.search_text LIKE ${wordPrefix} THEN 1
					WHEN ${allTokens} THEN 2
					ELSE 3
				END AS match_rank,
				${similarity} AS match_score
			FROM foods f
			WHERE f.deleted_at IS NULL AND ${scope} AND (${matchers.join(' OR ')})
			ORDER BY match_rank ASC, match_score DESC, f.verified DESC, length(f.name_ar) ASC
			LIMIT ${p(limit)}`;

		const rows = await this.repo.query(sql, params);
		return {
			items: rows.map((r: any) => ({ ...this.toView(r, user), match: Number(r.match_rank) <= 2 ? 'exact' : 'similar' })),
		};
	}

	async list(query: any, user: FoodActor) {
		const { page, limit, skip } = parsePagination(query?.page, query?.limit, { defaultLimit: 25, maxLimit: 200 });
		const qb = this.repo.createQueryBuilder('f');

		const owner = foodOwnerFor(user);
		const scope = String(query?.scope || 'all');
		if (scope === 'global') qb.andWhere('f.admin_id IS NULL');
		else if (scope === 'mine') {
			if (owner) qb.andWhere('f.admin_id = :owner', { owner });
			else if (owner === undefined) qb.andWhere('f.admin_id IS NOT NULL');
			else qb.andWhere('1 = 0');
		} else if (owner !== undefined) {
			if (owner) qb.andWhere('(f.admin_id IS NULL OR f.admin_id = :owner)', { owner });
			else qb.andWhere('f.admin_id IS NULL');
		}

		if (query?.category && FOOD_CATEGORIES.includes(query.category)) qb.andWhere('f.category = :category', { category: query.category });
		if (query?.source) qb.andWhere('f.source = :source', { source: String(query.source) });
		if (query?.verified === 'true' || query?.verified === 'false') qb.andWhere('f.verified = :verified', { verified: query.verified === 'true' });
		if (query?.missing === 'fiber') qb.andWhere('f.fiber IS NULL');
		if (query?.missing === 'sugar') qb.andWhere('f.sugar IS NULL');

		const tokens = foodSearchTokens(query?.q);
		tokens.forEach((t, i) => qb.andWhere(`f.search_text LIKE :t${i}`, { [`t${i}`]: `%${t}%` }));

		qb.orderBy('f.verified', 'DESC').addOrderBy('f.nameAr', 'ASC').skip(skip).take(limit);
		const [rows, total] = await qb.getManyAndCount();
		return { items: rows.map(r => this.toView(r, user)), total, page, limit };
	}

	async categories(user: FoodActor) {
		const owner = foodOwnerFor(user);
		const qb = this.repo.createQueryBuilder('f').select('f.category', 'category').addSelect('COUNT(*)', 'count');
		if (owner !== undefined) {
			if (owner) qb.where('(f.admin_id IS NULL OR f.admin_id = :owner)', { owner });
			else qb.where('f.admin_id IS NULL');
		}
		const rows = await qb.groupBy('f.category').getRawMany<{ category: string; count: string }>();
		const counts = new Map(rows.map(r => [r.category, Number(r.count)]));
		return { items: FOOD_CATEGORIES.map(key => ({ key, count: counts.get(key) ?? 0 })) };
	}

	async findOne(id: string, user: FoodActor) {
		const food = await this.repo.findOne({ where: { id } });
		if (!food || !this.isVisible(user, food.adminId)) throw new NotFoundException('Food not found');
		return this.toView(food, user);
	}

	private isVisible(user: FoodActor, foodAdminId: string | null) {
		const owner = foodOwnerFor(user);
		return owner === undefined || !foodAdminId || foodAdminId === owner;
	}

	/** Foods referenced by plan items, limited to what the user may see. */
	async findForNutrition(ids: string[], user: FoodActor): Promise<Map<string, Food>> {
		const unique = Array.from(new Set(ids.filter(id => /^[0-9a-f-]{36}$/i.test(id))));
		if (!unique.length) return new Map();
		try {
			const rows = await this.repo.find({ where: { id: In(unique) } });
			return new Map(rows.filter(f => this.isVisible(user, f.adminId)).map(f => [f.id, f]));
		} catch (err) {
			this.logger.warn(`Food lookup failed (has the foods migration run?): ${(err as Error).message}`);
			return new Map();
		}
	}

	private applyDto(food: Food, dto: UpdateFoodDto, user: FoodActor) {
		const text = (v: unknown) => (v === undefined ? undefined : String(v ?? '').trim());
		const optionalText = (v: unknown) => (v === undefined ? undefined : String(v ?? '').trim() || null);
		const optionalNum = (v: unknown) => (v === undefined ? undefined : n(v));

		const assign = <K extends keyof Food>(key: K, value: Food[K] | undefined) => {
			if (value !== undefined) food[key] = value;
		};
		assign('nameAr', text(dto.nameAr));
		assign('nameEn', text(dto.nameEn));
		assign('aliases', optionalText(dto.aliases));
		assign('category', dto.category);
		assign('brand', optionalText(dto.brand));
		assign('barcode', optionalText(dto.barcode));
		assign('baseUnit', dto.baseUnit);
		assign('kcal', optionalNum(dto.kcal) as number | undefined);
		assign('protein', optionalNum(dto.protein) as number | undefined);
		assign('carbs', optionalNum(dto.carbs) as number | undefined);
		assign('fat', optionalNum(dto.fat) as number | undefined);
		assign('fiber', optionalNum(dto.fiber));
		assign('sugar', optionalNum(dto.sugar));
		assign('saturatedFat', optionalNum(dto.saturatedFat));
		assign('sodiumMg', optionalNum(dto.sodiumMg));
		assign('pieceGrams', optionalNum(dto.pieceGrams));
		assign('pieceLabelAr', optionalText(dto.pieceLabelAr));
		assign('pieceLabelEn', optionalText(dto.pieceLabelEn));
		assign('source', dto.source as Food['source'] | undefined);
		assign('sourceRef', optionalText(dto.sourceRef));
		if (dto.verified !== undefined && user.role === UserRole.SUPER_ADMIN) food.verified = !!dto.verified;

		if (!food.nameAr && !food.nameEn) throw new BadRequestException('Food name is required');
		const macros = Number(food.protein || 0) + Number(food.carbs || 0) + Number(food.fat || 0);
		if (macros > (food.baseUnit === 'ml' ? 105 : 100.5)) throw new BadRequestException('Protein + carbs + fat cannot exceed 100 per 100 g');
	}

	async create(dto: CreateFoodDto, user: FoodActor) {
		if (![UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.COACH].includes(user.role as UserRole)) {
			throw new ForbiddenException('Not allowed to add foods');
		}
		const owner = foodOwnerFor(user);
		if (owner === null) throw new ForbiddenException('Your account is not linked to an admin');
		const food = this.repo.create({
			adminId: owner === undefined ? null : owner,
			createdById: user.id,
			source: 'manual',
			verified: user.role === UserRole.SUPER_ADMIN,
			category: 'other',
			baseUnit: 'g',
		});
		this.applyDto(food, dto, user);
		const saved = await this.repo.save(food);
		return this.toView(saved, user);
	}

	async update(id: string, dto: UpdateFoodDto, user: FoodActor) {
		const food = await this.repo.findOne({ where: { id } });
		if (!food || !this.isVisible(user, food.adminId)) throw new NotFoundException('Food not found');
		if (!this.canEdit(user, food.adminId)) throw new ForbiddenException('Only the super admin can edit global foods');
		this.applyDto(food, dto, user);
		const saved = await this.repo.save(food);
		return this.toView(saved, user);
	}

	async remove(id: string, user: FoodActor) {
		const food = await this.repo.findOne({ where: { id } });
		if (!food || !this.isVisible(user, food.adminId)) throw new NotFoundException('Food not found');
		if (!this.canEdit(user, food.adminId)) throw new ForbiddenException('Only the super admin can delete global foods');
		await this.repo.softRemove(food);
		return { success: true };
	}
}
