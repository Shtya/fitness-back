import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MealPlan, MealPlanDay, MealPlanFood, MealPlanAssignment, Food, User, MealIntakeLog } from 'entities/global.entity';
import { NutritionController } from './meal-plans.controller';
import { NutritionService } from './meal-plans.service';

@Module({
imports: [
    TypeOrmModule.forFeature([
      MealPlan,
      MealPlanDay,
      MealPlanFood,
      MealPlanAssignment,
      MealIntakeLog,
    ]),
  ],  controllers: [NutritionController],
  providers: [NutritionService],
  exports: [NutritionService],
})
export class MealPlansModule {}