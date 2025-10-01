// src/plan-exercises/plan-exercises.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm'; 
import { PlanDay, PlanExercises } from 'entities/global.entity';
import { PlanExercisesController } from './exercises.controller';
import { PlanExercisesService } from './exercises.service';

@Module({
  imports: [TypeOrmModule.forFeature([ PlanDay , PlanExercises])],
  controllers: [PlanExercisesController],
  providers: [PlanExercisesService],
  exports: [PlanExercisesService],
})
export class PlanExercisesModule {}
