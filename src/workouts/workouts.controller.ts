// src/workouts/workouts.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { CurrentUser } from 'common/decorators/current-user.decorator';
import { Roles } from 'common/decorators/roles.decorator';
import { RolesGuard } from 'common/guards/roles.guard';
import { SeedPlanDto , UpdateExerciseDto ,ActivatePlanDto } from './workouts.dto'; 
@Controller('workouts')
@UseGuards(RolesGuard)
export class WorkoutsController {
  constructor(private readonly workouts: WorkoutsService) {}

  // للفرونت (العميل): هات الخطة الفعالة
  @Get('active-plan')
  getMyActivePlan(@CurrentUser() user: any) {
    return this.workouts.getActivePlanForUser(user.id);
  }

  // للمدرب: هات خطط عميل
  @Get('plans/of/:clientId')
  @Roles('coach', 'admin')
  getPlansOfClient(@CurrentUser() user: any, @Param('clientId') clientId: string) {
    return this.workouts.getPlanByUserIdForCoach(user.id, clientId);
  }

  // للمدرب/الأدمن: بناء خطة من seed (زي weeklyProgram)
  @Post('plan/seed')
  @Roles('coach', 'admin')
  seedPlan(@CurrentUser() user: any, @Body() dto: SeedPlanDto) {
    return this.workouts.seedPlan(dto, user.id);
  }

  // تفعيل/تعطيل خطة
  @Patch('plan/:planId/activate')
  @Roles('coach', 'admin')
  activate(@CurrentUser() user: any, @Param('planId') planId: string, @Body() dto: ActivatePlanDto) {
    return this.workouts.activatePlan(planId, dto, user.id);
  }

  // تعديل تمرين داخل الخطة
  @Patch('exercise/:exerciseId')
  @Roles('coach', 'admin')
  updateExercise(@CurrentUser() user: any, @Param('exerciseId') exerciseId: string, @Body() dto: UpdateExerciseDto) {
    return this.workouts.updateExercise(exerciseId, dto, user.id);
  }
}
