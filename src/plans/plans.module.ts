import { Module } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, Plan, PlanDay, PlanExercise } from 'entities/global.entity';

@Module({
    imports: [TypeOrmModule.forFeature([User, Plan, PlanDay, PlanExercise])],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
