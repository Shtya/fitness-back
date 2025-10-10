// src/nutrition/nutrition.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole, DayOfWeek, MealType } from 'entities/global.entity';
import { NutritionService } from './meal-plans.service';

// --- DTOs ---
type SaveMealPlanDto = {
  name: string;
  desc?: string | null;
  days: Array<{
    day: DayOfWeek | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
    name: string;
    foods: Array<{
      name: string;
      category?: string | null;
      calories?: number;
      protein?: number;
      carbs?: number;
      fat?: number;
      unit?: string;
      quantity?: number;
      mealType?: MealType;
      orderIndex?: number;
    }>;
  }>;
};

type MealLogUpsertDto = {
  date: string; // 'YYYY-MM-DD'
  day: DayOfWeek;
  mealType: MealType;
  itemName: string;
  quantity?: number;
  taken?: boolean;
  notes?: string | null;
  suggestedAlternative?: string | null;
  planFoodId?: string | null;
  assignmentId?: string | null;
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('nutrition')
export class NutritionController {
  constructor(private readonly svc: NutritionService) {}

  // ---------------- MEAL PLANS ----------------
  @Get('meal-plans')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  listPlans(@Query() q: any) {
    return this.svc.listPlans(q);
  }

  @Get('meal-plans/stats')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  stats(@Query() q: any) {
    return this.svc.stats(q);
  }

  @Post('meal-plans')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  createPlan(@Body() dto: SaveMealPlanDto) {
    return this.svc.createPlan(dto);
  }

  @Get('meal-plans/:id')
  getPlan(@Param('id') id: string) {
    return this.svc.getPlanDeep(id);
  }

  @Put('meal-plans/:id')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  updatePlan(@Param('id') id: string, @Body() dto: SaveMealPlanDto & { isActive?: boolean }) {
    return this.svc.updatePlan(id, dto);
  }

  @Delete('meal-plans/:id')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  removePlan(@Param('id') id: string) {
    return this.svc.removePlan(id);
  }

  @Post('meal-plans/:id/assign')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  assignPlan(@Param('id') planId: string, @Body() body: { userId: string }) {
    return this.svc.assignToUser(planId, body.userId);
  }

  @Post('meal-plans/:id/assign-bulk')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  bulkAssign(@Param('id') planId: string, @Body() dto: { athleteIds: string[] }) {
    return this.svc.bulkAssign(planId, dto);
  }

  @Get('meal-plans/:id/assignees')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  assignees(@Param('id') id: string) {
    // return this.svc.listAssignees(id);
  }

  @Get('meal-plans/my/active')
  getMyActive(@Req() req: any) {
    return this.svc.getActivePlan(req.user.id);
  }

  // ---------------- MEAL LOGS (CLIENT) ----------------
  @Post('meal-logs')
  upsertLog(@Req() req: any, @Body() dto: MealLogUpsertDto) {
    return this.svc.upsertLog({ ...dto, userId: req.user.id });
  }

  @Get('meal-logs/summary')
  summary(@Req() req: any, @Query('date') date: string) {
    return this.svc.summary(req.user.id, date);
  }

  @Get('meal-logs')
  listLogs(@Req() req: any, @Query() q: { date?: string; from?: string; to?: string }) {
    return this.svc.listLogs(req.user.id, q);
  }
}
