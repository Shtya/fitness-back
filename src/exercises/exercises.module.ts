// src/plan-exercises/plan-exercises.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm'; 
import { PlanDay, PlanExercise } from 'entities/global.entity';
import { PlanExercisesController } from './exercises.controller';
import { PlanExercisesService } from './exercises.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlanExercise, PlanDay])],
  controllers: [PlanExercisesController],
  providers: [PlanExercisesService],
  exports: [PlanExercisesService],
})
export class PlanExercisesModule {}
