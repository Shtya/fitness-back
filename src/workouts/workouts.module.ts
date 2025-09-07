// src/workouts/workouts.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkoutPlan, WorkoutDay, WorkoutExercise, User } from 'entities/global.entity';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';
import { CoachingModule } from 'src/conaching/conaching.module';


@Module({
  imports: [TypeOrmModule.forFeature([WorkoutPlan, WorkoutDay, WorkoutExercise, User]), CoachingModule],
  controllers: [WorkoutsController],
  providers: [WorkoutsService],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
