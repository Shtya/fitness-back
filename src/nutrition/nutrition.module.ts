import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NutritionController } from './nutrition.controller';
import { NutritionService } from './nutrition.service';

import {
  MealPlan,
  MealPlanDay,
  MealPlanFood,
  MealPlanAssignment,
  Meal,
  MealItem,
  Supplement,
  MealLog,
  MealLogItem,
  ExtraFood,
  SupplementLog,
  FoodSuggestion,
  NutritionStats,
} from '../../entities/meal_plans.entity';

import { User, Notification as NotificationEntity } from 'entities/global.entity'; // ✅ خلي User/Notification من global

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MealPlan,
      MealPlanDay,
      MealPlanFood,
      MealPlanAssignment,
      Meal,
      MealItem,
      Supplement,
      MealLog,
      MealLogItem,
      ExtraFood,
      SupplementLog,
      FoodSuggestion,
      NutritionStats,
      User,
      NotificationEntity,
    ]),
  ],
  controllers: [NutritionController],
  providers: [NutritionService],
  exports: [NutritionService],
})
export class NutritionModule {}
