import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User, ExercisePlan, ExercisePlanDay, ExercisePlanDayExercise, MealPlan, MealPlanDay,
  MealPlanFood, Meal, MealItem, Supplement, MealPlanAssignment, MealLog, MealLogItem,
  ExtraFood, SupplementLog, ChatMessage, ChatConversation
} from 'entities/global.entity';
import { BodyMeasurement, ProgressPhoto } from 'entities/profile.entity';
import { AboutUserController } from './about-user.controller';
import { AboutUserService } from './about-user.service';
import { WeeklyReport } from 'entities/weekly-report.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      BodyMeasurement,
      ProgressPhoto,

      // workouts
      ExercisePlan,
      ExercisePlanDay,
      ExercisePlanDayExercise,

      // nutrition
      MealPlan,
      MealPlanDay,
      MealPlanFood,
      Meal,
      MealItem,
      Supplement,
      MealPlanAssignment,

      // logs / reports / activity
      MealLog,
      MealLogItem,
      ExtraFood,
      SupplementLog,
      WeeklyReport,
      ChatConversation,
      ChatMessage,
    ]),
  ],
  controllers: [AboutUserController],
  providers: [AboutUserService],
  exports: [AboutUserService],
})
export class AboutUserModule {}
