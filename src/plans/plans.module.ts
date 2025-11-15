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
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [TypeOrmModule.forFeature([ExercisePlan, ExercisePlanDay, ExercisePlanDayExercise, Exercise, User]) , RedisModule],
  providers: [PlanService],
  controllers: [PlanController],
  exports: [PlanService],
})
export class PlansModule {}
