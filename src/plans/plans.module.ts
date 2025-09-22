import { Module } from '@nestjs/common';
import { PlanService } from './plans.service';
import { PlanController } from './plans.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, Plan, PlanDay, PlanExercise, PlanAssignment } from 'entities/global.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Plan, PlanDay, PlanExercise, PlanAssignment, User])],
  providers: [PlanService],
  controllers: [PlanController],
  exports: [PlanService],
})
export class PlansModule {}