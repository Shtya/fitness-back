// --- File: plans/plans.module.ts ---
import { Module } from '@nestjs/common';
import { PlanService } from './plans.service';
import { PlanController } from './plans.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, Plan, PlanDay, PlanExercises, PlanAssignment } from 'entities/global.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Plan, PlanDay, PlanExercises, PlanAssignment, User])],
  providers: [PlanService],
  controllers: [PlanController],
  exports: [PlanService],
})
export class PlansModule {}
