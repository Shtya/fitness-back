// src/plans/plans.module.ts
import { Module } from '@nestjs/common';
import { PlanService } from './plans.service';
import { PlanController } from './plans.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User,
  Exercise,
  ExercisePlan,
  ExercisePlanDay,
  ExercisePlanDayExercise,
} from 'entities/global.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ExercisePlan, ExercisePlanDay, ExercisePlanDayExercise, Exercise, User])],
  providers: [PlanService],
  controllers: [PlanController],
  exports: [PlanService],
})
export class PlansModule {}
