// src/stats/stats.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { User, ExerciseRecord,  ExercisePlan, Notification } from 'entities/global.entity';
import { AuthModule } from 'src/auth/auth.module';
import { NutritionModule } from 'src/nutrition/nutrition.module';
import { PlansModule } from 'src/plans/plans.module';
import { ProfileModule } from 'src/profile/profile.module';
import { PrsModule } from 'src/prs/prs.module';
import { BodyMeasurement, ProgressPhoto } from 'entities/profile.entity';
import { WeeklyReport } from 'entities/weekly-report.entity';
import { FoodSuggestion, MealLog, MealPlan } from '../../entities/meal_plans.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, ExerciseRecord, MealLog, ProgressPhoto, BodyMeasurement, ExercisePlan, MealPlan, WeeklyReport, Notification, FoodSuggestion]), AuthModule, NutritionModule, PlansModule, ProfileModule, PrsModule],
  controllers: [StatsController],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
