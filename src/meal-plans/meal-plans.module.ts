import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MealPlan, MealPlanDay, MealPlanFood, MealPlanAssignment, Food } from 'entities/global.entity';
import { MealPlansController } from './meal-plans.controller';
import { MealPlansService } from './meal-plans.service';

@Module({
  imports: [TypeOrmModule.forFeature([MealPlan, MealPlanDay, MealPlanFood, MealPlanAssignment, Food])],
  controllers: [MealPlansController],
  providers: [MealPlansService],
  exports: [MealPlansService],
})
export class MealPlansModule {}