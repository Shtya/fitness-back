import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateCalorieCalculationDto } from './calorie-calculation.dto';
import { CalorieCalculation } from './calorie-calculation.entity';

@Injectable()
export class CalorieCalculationService {
	constructor(
		@InjectRepository(CalorieCalculation)
		private readonly calculations: Repository<CalorieCalculation>,
	) {}

	list(ownerId: string) {
		return this.calculations.find({
			where: { ownerId },
			order: { createdAt: 'DESC' },
			take: 100,
		});
	}

	create(ownerId: string, dto: CreateCalorieCalculationDto) {
		return this.calculations.save(
			this.calculations.create({
				ownerId,
				name: dto.name.trim(),
				sex: dto.sex,
				age: dto.age,
				height: String(dto.height),
				weight: String(dto.weight),
				bodyFat: dto.bodyFat == null ? null : String(dto.bodyFat),
				activity: dto.activity,
				goal: dto.goal,
				targets: {
					caloriesTarget: dto.targets.caloriesTarget,
					proteinPerDay: dto.targets.proteinPerDay,
					carbsPerDay: dto.targets.carbsPerDay,
					fatsPerDay: dto.targets.fatsPerDay,
					FiberTarget: dto.targets.FiberTarget,
					activityLevel: dto.targets.activityLevel,
				},
			}),
		);
	}
}
