// src/planning/planning.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan, PlanDay, PlanExercise, User } from 'entities/global.entity';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Plan, PlanDay, PlanExercise])],
  controllers: [PlanningController],
  providers: [PlanningService],
})
export class PlanningModule {}
