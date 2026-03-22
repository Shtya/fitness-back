import {
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsRelations, In, Repository } from 'typeorm';
import {
	Recipe,
	RecipeFavorite,
	RecipeIngredient,
	RecipeIngredientGroup,
	RecipeStep,
	RecipeTip,
} from 'entities/recipes.entity';

@Injectable()
export class RecipesService {
	constructor(
		@InjectRepository(Recipe)
		private readonly recipeRepo: Repository<Recipe>,

		@InjectRepository(RecipeIngredient)
		private readonly ingredientRepo: Repository<RecipeIngredient>,

		@InjectRepository(RecipeStep)
		private readonly stepRepo: Repository<RecipeStep>,

		@InjectRepository(RecipeTip)
		private readonly tipRepo: Repository<RecipeTip>,

		@InjectRepository(RecipeFavorite)
		private readonly favoriteRepo: Repository<RecipeFavorite>,
	) { }

	private recipeRelations: FindOptionsRelations<Recipe> = {
		ingredients: true,
		steps: true,
		tips: true,
	};

	private applyRecipeFilters(qb: any, query: any) {
		qb.where('recipe.deleted_at IS NULL');

		if (query.search) {
			qb.andWhere('recipe.title ILIKE :search', {
				search: `%${query.search}%`,
			});
		}

		if (query.satiety_index) {
			qb.andWhere('recipe.satietyIndex = :satietyIndex', {
				satietyIndex: query.satiety_index,
			});
		}

		if (query.meal_type) {
			qb.andWhere('recipe.mealType = :mealType', {
				mealType: query.meal_type,
			});
		}

		if (query.is_active !== undefined && query.is_active !== '') {
			const isActive =
				query.is_active === true ||
				query.is_active === 'true' ||
				query.is_active === 1 ||
				query.is_active === '1';

			qb.andWhere('recipe.isActive = :isActive', { isActive });
		}

		if (query.min_calories !== undefined && query.min_calories !== '') {
			qb.andWhere('recipe.calories >= :minCalories', {
				minCalories: Number(query.min_calories),
			});
		}

		if (query.max_calories !== undefined && query.max_calories !== '') {
			qb.andWhere('recipe.calories <= :maxCalories', {
				maxCalories: Number(query.max_calories),
			});
		}

		if (query.min_protein !== undefined && query.min_protein !== '') {
			qb.andWhere('recipe.proteinG >= :minProtein', {
				minProtein: Number(query.min_protein),
			});
		}

		if (query.max_protein !== undefined && query.max_protein !== '') {
			qb.andWhere('recipe.proteinG <= :maxProtein', {
				maxProtein: Number(query.max_protein),
			});
		}

		if (query.min_carbs !== undefined && query.min_carbs !== '') {
			qb.andWhere('recipe.carbsG >= :minCarbs', {
				minCarbs: Number(query.min_carbs),
			});
		}

		if (query.max_carbs !== undefined && query.max_carbs !== '') {
			qb.andWhere('recipe.carbsG <= :maxCarbs', {
				maxCarbs: Number(query.max_carbs),
			});
		}

		if (query.min_fat !== undefined && query.min_fat !== '') {
			qb.andWhere('recipe.fatG >= :minFat', {
				minFat: Number(query.min_fat),
			});
		}

		if (query.max_fat !== undefined && query.max_fat !== '') {
			qb.andWhere('recipe.fatG <= :maxFat', {
				maxFat: Number(query.max_fat),
			});
		}

		return qb;
	}


	async getStats(query: any) {
		const qb = this.recipeRepo.createQueryBuilder('recipe');
		this.applyRecipeFilters(qb, query);

		const raw = await qb
			.select('COUNT(recipe.id)', 'total_recipes')
			.addSelect(
				'SUM(CASE WHEN recipe.isActive = true THEN 1 ELSE 0 END)',
				'active_recipes',
			)
			.addSelect(
				'SUM(CASE WHEN recipe.isActive = false THEN 1 ELSE 0 END)',
				'inactive_recipes',
			)
			.addSelect('COALESCE(AVG(recipe.calories), 0)', 'avg_calories')
			.addSelect('COALESCE(AVG(recipe.proteinG), 0)', 'avg_protein')
			.addSelect('COALESCE(AVG(recipe.carbsG), 0)', 'avg_carbs')
			.addSelect('COALESCE(AVG(recipe.fatG), 0)', 'avg_fat')
			.getRawOne();

		const categoryRows = await this.recipeRepo
			.createQueryBuilder('recipe')
			.select('recipe.mealType', 'value')
			.addSelect('COUNT(recipe.id)', 'count')
			.where('recipe.deleted_at IS NULL')
			.andWhere('recipe.mealType IS NOT NULL')
			.groupBy('recipe.mealType')
			.orderBy('recipe.mealType', 'ASC')
			.getRawMany();

		const satietyRows = await this.recipeRepo
			.createQueryBuilder('recipe')
			.select('recipe.satietyIndex', 'value')
			.addSelect('COUNT(recipe.id)', 'count')
			.where('recipe.deleted_at IS NULL')
			.andWhere('recipe.satietyIndex IS NOT NULL')
			.groupBy('recipe.satietyIndex')
			.orderBy('recipe.satietyIndex', 'ASC')
			.getRawMany();

		return {
			summary: {
				total_recipes: Number(raw?.total_recipes ?? 0),
				active_recipes: Number(raw?.active_recipes ?? 0),
				inactive_recipes: Number(raw?.inactive_recipes ?? 0),
				avg_calories: Number(raw?.avg_calories ?? 0),
				avg_protein: Number(raw?.avg_protein ?? 0),
				avg_carbs: Number(raw?.avg_carbs ?? 0),
				avg_fat: Number(raw?.avg_fat ?? 0),
			},
			breakdowns: {
				meal_types: categoryRows.map((row) => ({
					value: row.value,
					count: Number(row.count),
				})),
				satiety_indexes: satietyRows.map((row) => ({
					value: row.value,
					count: Number(row.count),
				})),
			},
		};
	}

	private toResponse(recipe: Recipe, favoritedByUserId?: string | null) {
		const ingredients = [...(recipe.ingredients || [])].sort(
			(a, b) => a.orderIndex - b.orderIndex,
		);
		const steps = [...(recipe.steps || [])].sort(
			(a, b) => a.stepNumber - b.stepNumber,
		);
		const tips = [...(recipe.tips || [])].sort(
			(a, b) => a.orderIndex - b.orderIndex,
		);

		return {
			id: recipe.id,
			is_favorited: favoritedByUserId
				? (recipe as any).__is_favorited ?? false
				: undefined,
			title: recipe.title,
			image_url: recipe.imageUrl || null,
			video_url: recipe.videoUrl || null,
			satiety_index: recipe.satietyIndex,
			meal_type: recipe.mealType || null,
			is_active: recipe.isActive,
			notes: recipe.notes || null,
			adminId: recipe.adminId || null,
			nutrition: {
				calories: recipe.calories,
				carbs_g: Number(recipe.carbsG),
				protein_g: Number(recipe.proteinG),
				fat_g: Number(recipe.fatG),
			},
			ingredients: ingredients
				.filter((i) => i.group === RecipeIngredientGroup.MAIN)
				.map((i) => i.text),
			cream_ingredients: ingredients
				.filter((i) => i.group === RecipeIngredientGroup.CREAM)
				.map((i) => i.text),
			sauce_ingredients: ingredients
				.filter((i) => i.group === RecipeIngredientGroup.SAUCE)
				.map((i) => i.text),
			directions: steps.map((s) => s.instruction),
			tips: tips.map((t) => t.text),
			created_at: recipe.created_at,
			updated_at: recipe.updated_at,
		};
	}

	private parseJsonField<T = any>(value: any, fallback: T): T {
		if (value === undefined || value === null || value === '') return fallback;
		if (typeof value === 'object') return value as T;

		try {
			return JSON.parse(value);
		} catch {
			return fallback;
		}
	}

	private parseBoolean(value: any, fallback = true): boolean {
		if (value === undefined || value === null || value === '') return fallback;
		if (typeof value === 'boolean') return value;
		if (typeof value === 'string') {
			return value.toLowerCase() === 'true';
		}
		return fallback;
	}

	private parseNumber(value: any, fallback = 0): number {
		if (value === undefined || value === null || value === '') return fallback;
		const n = Number(value);
		return Number.isNaN(n) ? fallback : n;
	}

	private normalizeRecipeInput(body: any, file?: any) {
		const nutrition = this.parseJsonField(body.nutrition, {
			calories: 0,
			carbs_g: 0,
			protein_g: 0,
			fat_g: 0,
		});

		const dto = {
			title: body.title,
			image_url: file
				? `/uploads/recipes/${file.filename}`
				: body.image_url || null,
			video_url: body.video_url || null,
			satiety_index: body.satiety_index || null,
			meal_type: body.meal_type || null,
			is_active: this.parseBoolean(body.is_active, true),
			notes: body.notes ?? null,
			adminId: body.adminId ?? null,

			nutrition: {
				calories: this.parseNumber(nutrition.calories, 0),
				carbs_g: this.parseNumber(nutrition.carbs_g, 0),
				protein_g: this.parseNumber(nutrition.protein_g, 0),
				fat_g: this.parseNumber(nutrition.fat_g, 0),
			},

			ingredients: this.parseJsonField<string[]>(body.ingredients, []),
			cream_ingredients: this.parseJsonField<string[]>(body.cream_ingredients, []),
			sauce_ingredients: this.parseJsonField<string[]>(body.sauce_ingredients, []),
			directions: this.parseJsonField<string[]>(body.directions, []),
			tips: this.parseJsonField<string[]>(body.tips, []),
		};

		return dto;
	}

	private buildIngredientEntities(recipe: Recipe, dto: any): RecipeIngredient[] {
		const rows: RecipeIngredient[] = [];

		const pushGroup = (items: string[] | undefined, group: RecipeIngredientGroup) => {
			(items || []).forEach((text, index) => {
				rows.push(
					this.ingredientRepo.create({
						recipe,
						group,
						orderIndex: index,
						text,
					}),
				);
			});
		};

		pushGroup(dto.ingredients, RecipeIngredientGroup.MAIN);
		pushGroup(dto.cream_ingredients, RecipeIngredientGroup.CREAM);
		pushGroup(dto.sauce_ingredients, RecipeIngredientGroup.SAUCE);

		return rows;
	}

	private buildStepEntities(recipe: Recipe, directions?: string[]): RecipeStep[] {
		return (directions || []).map((instruction, index) =>
			this.stepRepo.create({
				recipe,
				stepNumber: index + 1,
				instruction,
			}),
		);
	}

	private buildTipEntities(recipe: Recipe, tips?: string[]): RecipeTip[] {
		return (tips || []).map((text, index) =>
			this.tipRepo.create({
				recipe,
				orderIndex: index,
				text,
			}),
		);
	}

	async create(dto: any) {
		const recipe = this.recipeRepo.create({
			title: dto.title,
			imageUrl: dto.image_url || null,
			videoUrl: dto.video_url || null,
			satietyIndex: dto.satiety_index,
			mealType: dto.meal_type || null,
			calories: dto.nutrition?.calories ?? 0,
			carbsG: dto.nutrition?.carbs_g ?? 0,
			proteinG: dto.nutrition?.protein_g ?? 0,
			fatG: dto.nutrition?.fat_g ?? 0,
			isActive: dto.is_active ?? true,
			notes: dto.notes ?? null,
			adminId: dto.adminId ?? null,
		} as any);

		const saved: any = await this.recipeRepo.save(recipe);

		const ingredients = this.buildIngredientEntities(saved, dto);
		const steps = this.buildStepEntities(saved, dto.directions);
		const tips = this.buildTipEntities(saved, dto.tips);

		if (ingredients.length) await this.ingredientRepo.save(ingredients);
		if (steps.length) await this.stepRepo.save(steps);
		if (tips.length) await this.tipRepo.save(tips);

		const full = await this.recipeRepo.findOne({
			where: { id: saved.id },
			relations: this.recipeRelations,
		});

		return this.toResponse(full!);
	}

	async createFromFormData(body: any, file?: any) {
		const dto = this.normalizeRecipeInput(body, file);
		return this.create(dto);
	}

	async bulkCreate(dto: any) {
		const results = [];

		for (const item of dto.recipes || []) {
			const normalized = {
				title: item.title,
				image_url: item.image_url || null,
				video_url: item.video_url || null,
				satiety_index: item.satiety_index || null,
				meal_type: item.meal_type || null,
				is_active: item.is_active ?? true,
				notes: item.notes ?? null,
				adminId: item.adminId ?? null,
				nutrition: {
					calories: Number(item?.nutrition?.calories ?? 0),
					carbs_g: Number(item?.nutrition?.carbs_g ?? 0),
					protein_g: Number(item?.nutrition?.protein_g ?? 0),
					fat_g: Number(item?.nutrition?.fat_g ?? 0),
				},
				ingredients: item.ingredients || [],
				cream_ingredients: item.cream_ingredients || [],
				sauce_ingredients: item.sauce_ingredients || [],
				directions: item.directions || [],
				tips: item.tips || [],
			};

			const created = await this.create(normalized);
			results.push(created);
		}

		return {
			count: results.length,
			items: results,
		};
	}



	async findAll(query: any) {
		const page = Number(query.page || 1);
		const limit = Number(query.limit || 20);

		const baseQb = this.recipeRepo.createQueryBuilder('recipe');
		this.applyRecipeFilters(baseQb, query);

		const total = await baseQb.getCount();

		const sortColumnMap: Record<string, string> = {
			created_at: 'recipe.created_at',
			calories: 'recipe.calories',
			protein: 'recipe.proteinG',
			carbs: 'recipe.carbsG',
			fat: 'recipe.fatG',
			title: 'recipe.title',
		};
		const sortCol = sortColumnMap[query.sort_by] ?? 'recipe.created_at';
		const sortDir: 'ASC' | 'DESC' = query.sort_dir === 'ASC' ? 'ASC' : 'DESC';

		const pagedRecipes = await baseQb
			.clone()
			.orderBy(sortCol, sortDir)
			.skip((page - 1) * limit)
			.take(limit)
			.select(['recipe.id'])
			.getMany();

		const ids = pagedRecipes.map((r) => r.id);

		if (!ids.length) {
			return {
				total,
				page,
				limit,
				items: [],
			};
		}

		const items = await this.recipeRepo.find({
			where: { id: In(ids) },
			relations: {
				ingredients: true,
				steps: true,
				tips: true,
			},
		});

		const orderedItems = ids
			.map((id) => items.find((item) => item.id === id))
			.filter(Boolean);

		return {
			total,
			page,
			limit,
			items: orderedItems.map((item) => this.toResponse(item!)),
		};
	}

	async getFilterMeta() {
		const mealTypesRaw = await this.recipeRepo
			.createQueryBuilder('recipe')
			.select('DISTINCT recipe.mealType', 'value')
			.where('recipe.deleted_at IS NULL')
			.andWhere('recipe.mealType IS NOT NULL')
			.orderBy('value', 'ASC')
			.getRawMany();

		const satietyRaw = await this.recipeRepo
			.createQueryBuilder('recipe')
			.select('DISTINCT recipe.satietyIndex', 'value')
			.where('recipe.deleted_at IS NULL')
			.andWhere('recipe.satietyIndex IS NOT NULL')
			.orderBy('value', 'ASC')
			.getRawMany();

		const nutritionRaw = await this.recipeRepo
			.createQueryBuilder('recipe')
			.select('MIN(recipe.calories)', 'min_calories')
			.addSelect('MAX(recipe.calories)', 'max_calories')
			.addSelect('MIN(recipe.proteinG)', 'min_protein')
			.addSelect('MAX(recipe.proteinG)', 'max_protein')
			.addSelect('MIN(recipe.carbsG)', 'min_carbs')
			.addSelect('MAX(recipe.carbsG)', 'max_carbs')
			.addSelect('MIN(recipe.fatG)', 'min_fat')
			.addSelect('MAX(recipe.fatG)', 'max_fat')
			.where('recipe.deleted_at IS NULL')
			.getRawOne();

		return {
			filters: {
				satiety_index: satietyRaw
					.map((x) => x.value)
					.filter(Boolean),

				meal_type: mealTypesRaw
					.map((x) => x.value)
					.filter(Boolean),

				is_active: [true, false],

				nutrition_ranges: {
					calories: {
						min: Number(nutritionRaw?.min_calories ?? 0),
						max: Number(nutritionRaw?.max_calories ?? 0),
					},
					protein: {
						min: Number(nutritionRaw?.min_protein ?? 0),
						max: Number(nutritionRaw?.max_protein ?? 0),
					},
					carbs: {
						min: Number(nutritionRaw?.min_carbs ?? 0),
						max: Number(nutritionRaw?.max_carbs ?? 0),
					},
					fat: {
						min: Number(nutritionRaw?.min_fat ?? 0),
						max: Number(nutritionRaw?.max_fat ?? 0),
					},
				},
			},
			sort_by: ['created_at', 'calories', 'protein', 'carbs', 'fat', 'title'],
		};
	}

	async findOne(id: string) {
		const recipe = await this.recipeRepo.findOne({
			where: { id },
			relations: this.recipeRelations,
		});

		if (!recipe) throw new NotFoundException('Recipe not found');

		return this.toResponse(recipe);
	}

	async update(id: string, dto: any) {
		const recipe: any = await this.recipeRepo.findOne({
			where: { id },
			relations: this.recipeRelations,
		});

		if (!recipe) throw new NotFoundException('Recipe not found');

		if (dto.title !== undefined) recipe.title = dto.title;
		if (dto.image_url !== undefined) recipe.imageUrl = dto.image_url || null;
		if (dto.video_url !== undefined) recipe.videoUrl = dto.video_url || null;
		if (dto.satiety_index !== undefined) recipe.satietyIndex = dto.satiety_index;
		if (dto.meal_type !== undefined) recipe.mealType = dto.meal_type || null;
		if (dto.is_active !== undefined) recipe.isActive = dto.is_active;
		if (dto.notes !== undefined) recipe.notes = dto.notes ?? null;
		if (dto.adminId !== undefined) recipe.adminId = dto.adminId ?? null;

		if (dto.nutrition) {
			recipe.calories = dto.nutrition.calories;
			recipe.carbsG = dto.nutrition.carbs_g;
			recipe.proteinG = dto.nutrition.protein_g;
			recipe.fatG = dto.nutrition.fat_g;
		}

		await this.recipeRepo.save(recipe);

		const hasIngredientPayload =
			dto.ingredients !== undefined ||
			dto.cream_ingredients !== undefined ||
			dto.sauce_ingredients !== undefined;

		if (hasIngredientPayload) {
			await this.ingredientRepo.delete({ recipe: { id: recipe.id } as any });
			const ingredients = this.buildIngredientEntities(recipe, dto);
			if (ingredients.length) await this.ingredientRepo.save(ingredients);
		}

		if (dto.directions !== undefined) {
			await this.stepRepo.delete({ recipe: { id: recipe.id } as any });
			const steps = this.buildStepEntities(recipe, dto.directions);
			if (steps.length) await this.stepRepo.save(steps);
		}

		if (dto.tips !== undefined) {
			await this.tipRepo.delete({ recipe: { id: recipe.id } as any });
			const tips = this.buildTipEntities(recipe, dto.tips);
			if (tips.length) await this.tipRepo.save(tips);
		}

		return this.findOne(id);
	}

	async updateFromFormData(id: string, body: any, file?: any) {
		const dto = this.normalizeRecipeInput(body, file);
		return this.update(id, dto);
	}

	async remove(id: string) {
		const recipe = await this.recipeRepo.findOne({ where: { id } });
		if (!recipe) throw new NotFoundException('Recipe not found');

		await this.recipeRepo.remove(recipe);

		return {
			message: 'Recipe deleted successfully',
			id,
		};
	}

	async updateImage(id: string, imageUrl: string | null) {
		const recipe = await this.recipeRepo.findOne({ where: { id } });
		if (!recipe) throw new NotFoundException('Recipe not found');

		recipe.imageUrl = imageUrl;
		await this.recipeRepo.save(recipe);

		return this.findOne(id);
	}

	async removeImage(id: string) {
		return this.updateImage(id, null);
	}





	async addFavorite(userId: string, recipeId: string) {
		// تأكد الـ recipe موجودة
		const recipe = await this.recipeRepo.findOne({ where: { id: recipeId } });
		if (!recipe) throw new NotFoundException('Recipe not found');

		// upsert — لو موجودة خليها، لو مش موجودة عملها
		await this.favoriteRepo
			.createQueryBuilder()
			.insert()
			.into(RecipeFavorite)
			.values({ userId, recipeId })
			.orIgnore()  // UNIQUE constraint → ignore duplicate
			.execute();

		return { favorited: true, recipeId };
	}

	async removeFavorite(userId: string, recipeId: string) {
		await this.favoriteRepo.delete({ userId, recipeId });
		return { favorited: false, recipeId };
	}

	async getUserFavorites(userId: string, query: any) {
		const page = Number(query.page ?? 1);
		const limit = Number(query.limit ?? 20);

		// Step 1: جيب الـ IDs بس مع pagination
		const [favs, total] = await this.favoriteRepo.findAndCount({
			where: { userId },
			order: { created_at: 'DESC' },
			skip: (page - 1) * limit,
			take: limit,
		});

		const recipeIds = favs.map(f => f.recipeId).filter(Boolean);

		if (!recipeIds.length) {
			return { total, page, limit, items: [] };
		}

		// Step 2: جيب الـ recipes الكاملة بالـ relations
		const recipes = await this.recipeRepo.find({
			where: { id: In(recipeIds) },
			relations: {
				ingredients: true,
				steps: true,
				tips: true,
			},
		});

		// Step 3: رتبهم بنفس ترتيب الـ favorites
		const ordered = recipeIds
			.map(id => recipes.find(r => r.id === id))
			.filter(Boolean);

		return {
			total,
			page,
			limit,
			items: ordered.map(r => this.toResponse(r!)),
		};
	}
}