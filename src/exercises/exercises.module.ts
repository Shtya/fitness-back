// src/exercises/exercises.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Exercise, ExerciseVideo } from 'entities/global.entity';
import { PlanExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';

@Module({
  imports: [TypeOrmModule.forFeature([Exercise, ExerciseVideo])],
  controllers: [PlanExercisesController],
  providers: [ExercisesService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
