// src/training/training.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExercisePR, Plan, PlanDay, SessionSet, User, WorkoutSession } from 'entities/global.entity';
import { TrainingController } from './training.controller';
import { TrainingService } from './training.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Plan, PlanDay, WorkoutSession, SessionSet, ExercisePR])],
  controllers: [TrainingController],
  providers: [TrainingService],
})
export class TrainingModule {}
