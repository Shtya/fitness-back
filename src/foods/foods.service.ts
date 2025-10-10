import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Food } from 'entities/global.entity';

@Injectable()
export class FoodsService {
  constructor(
    @InjectRepository(Food) public readonly repo: Repository<Food>, 
    private readonly dataSource: DataSource,
  ) {}

  async bulkCreate(items: any[]) {
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(Food);
			console.log(items);
      const entities = (items || []).map(i =>
        repo.create({
          name: i.name,
          category: i.category ?? null, // NEW
          calories: i.calories || 0,
          protein: i.protein || 0,
          carbs: i.carbs || 0,
          fat: i.fat || 0,
          unit: i.unit || 'g',
        }),
      );
      const saved = await repo.save(entities);
      return saved;
    });
  }

  async stats(q: any) {
    const totals = await this.repo.createQueryBuilder('f').select(['COUNT(*)::int AS total', `SUM(CASE WHEN f.created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::int AS created_7d`, `SUM(CASE WHEN f.created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::int AS created_30d`, `COALESCE(AVG(f.calories),0)::float AS avg_calories`, `COALESCE(AVG(f.protein),0)::float AS avg_protein`]).getRawOne<{
      total: number;
      created_7d: number;
      created_30d: number;
      avg_calories: number;
      avg_protein: number;
    }>();

    return {
      totals: {
        total: totals?.total ?? 0,
        created7d: totals?.created_7d ?? 0,
        created30d: totals?.created_30d ?? 0,
        avgCalories: Math.round(totals?.avg_calories ?? 0),
        avgProtein: Number((totals?.avg_protein ?? 0).toFixed(1)),
      },
    };
  }

  // NEW: list unique categories (non-null / non-empty), sorted A→Z
  async getCategories(): Promise<string[]> {
    const rows = await this.repo.createQueryBuilder('f').select('DISTINCT f.category', 'category').where('f.category IS NOT NULL').andWhere("TRIM(f.category) <> ''").orderBy('LOWER(f.category)', 'ASC').getRawMany<{ category: string }>();

    return rows.map(r => r.category);
  }

  async list(q: any) {
    const page = Math.max(1, parseInt(q?.page ?? '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(q?.limit ?? '12', 10)));
    const search = String(q?.search ?? '').trim();
    const category = String(q?.category ?? '').trim();

    const qb = this.repo.createQueryBuilder('f');

    if (search) qb.andWhere('f.name ILIKE :s', { s: `%${search}%` });

    // NEW: exact category filter (ignore if 'all' or empty)
    if (category && category.toLowerCase() !== 'all') {
      qb.andWhere('f.category = :cat', { cat: category });
    }

    qb.orderBy('f.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      total_records: total,
      current_page: page,
      per_page: limit,
      records: rows,
    };
  }

  async get(id: string) {
    const food = await this.repo.findOne({ where: { id } });
    if (!food) throw new NotFoundException('Food not found');
    return food;
  }

  async create(dto: any) {
    const food = this.repo.create({
      name: dto.name,
      category: dto.category ?? null, // NEW
      calories: dto.calories || 0,
      protein: dto.protein || 0,
      carbs: dto.carbs || 0,
      fat: dto.fat || 0,
      unit: dto.unit || 'g',
    });
    return await this.repo.save(food);
  }

  async update(id: string, dto: any) {
    const food = await this.repo.findOne({ where: { id } });
    if (!food) throw new NotFoundException('Food not found');

    if (dto.name !== undefined) food.name = dto.name;
    if (dto.category !== undefined) food.category = dto.category ?? null; // NEW
    if (dto.calories !== undefined) food.calories = dto.calories;
    if (dto.protein !== undefined) food.protein = dto.protein;
    if (dto.carbs !== undefined) food.carbs = dto.carbs;
    if (dto.fat !== undefined) food.fat = dto.fat;
    if (dto.unit !== undefined) food.unit = dto.unit;

    return await this.repo.save(food);
  }

  async remove(id: string) {
    const food = await this.repo.findOne({ where: { id } });
    if (!food) throw new NotFoundException('Food not found');
    await this.repo.remove(food);
    return { deleted: true, id };
  }

  // Food logging
  async logFood(userId: string, dto: any) {
    // const log = this.logRepo.create({
    //   user: { id: userId } as any,
    //   food: { id: dto.foodId } as any,
    //   date: dto.date || new Date().toISOString().split('T')[0],
    //   mealType: dto.mealType,
    //   quantity: dto.quantity,
    //   notes: dto.notes,
    // });
    // return await this.logRepo.save(log);
  }

  async getFoodLogs(userId: string, date?: string) {
    // const qb = this.logRepo.createQueryBuilder('log').leftJoinAndSelect('log.food', 'food').where('log.userId = :userId', { userId });

    // if (date) qb.andWhere('log.date = :date', { date });

    // return qb.orderBy('log.mealType', 'ASC').getMany();
  }
}
