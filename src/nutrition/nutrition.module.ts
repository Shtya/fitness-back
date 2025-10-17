// --- File: nutrition/nutrition.module.ts ---
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NutritionController } from './nutrition.controller';
import { NutritionService } from './nutrition.service';
import {
  MealPlan,
  MealPlanDay,
  MealPlanFood,
  MealPlanAssignment,
  User,
  Meal,
  MealItem,
  Supplement,
  MealLog,
  MealLogItem,
  ExtraFood,
  SupplementLog,
  FoodSuggestion,
  NutritionStats,
  Notification as NotificationEntity, // <-- add notifications repo
} from 'entities/global.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MealPlan,
      MealPlanDay,
      MealPlanFood,
      MealPlanAssignment,
      User,
      Meal,
      MealItem,
      Supplement,
      MealLog,
      MealLogItem,
      ExtraFood,
      SupplementLog,
      FoodSuggestion,
      NutritionStats,
      NotificationEntity,  
    ]),
  ],
  controllers: [NutritionController],
  providers: [NutritionService],
  exports: [NutritionService],
})
export class NutritionModule {}
