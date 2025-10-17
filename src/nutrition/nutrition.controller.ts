// --- File: nutrition/nutrition.controller.ts ---
import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { NutritionService } from './nutrition.service';
import { CreateMealPlanDto } from './dto/create-meal-plan.dto';
import { LogMealDto } from './dto/log-meal.dto';
import { CreateSuggestionDto } from './dto/suggestion.dto';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { UpdateMealPlanDto } from './dto/update-meal-plan.dto';
import { CRUD } from 'common/crud.service';

@Controller('nutrition')
@UseGuards(JwtAuthGuard)
export class NutritionController {
  constructor(private readonly nutritionService: NutritionService) {}

  // ========== MEAL PLANS MANAGEMENT (Coach/Admin) ==========

  @Post('meal-plans')
  createMealPlan(@Body() createDto: CreateMealPlanDto, @Request() req) {
    return this.nutritionService.createMealPlan(createDto, req.user.id);
  }

  @Get('meal-plans')
  findAllMealPlans(@Query() query: any) {
    // accept ?q= from frontend
    return CRUD.findAll(this.nutritionService.mealPlanRepo, 'meal_plan', query.q || query.search, query.page, query.limit, query.sortBy, query.sortOrder, ['days', 'days.meals', 'days.supplements', 'days.meals.items', 'days.meals.supplements', 'assignments', 'activeUsers'], ['name'], {});
  }

  @Get('meal-plans/:id')
  findMealPlanById(@Param('id') id: string) {
    return this.nutritionService.findMealPlanById(id);
  }

  @Put('meal-plans/:id')
  updateMealPlan(@Param('id') id: string, @Body() updateDto: UpdateMealPlanDto) {
    return this.nutritionService.updateMealPlan(id, updateDto);
  }

  @Delete('meal-plans/:id')
  deleteMealPlan(@Param('id') id: string) {
    return this.nutritionService.deleteMealPlan(id);
  }

  @Post('meal-plans/:id/assign')
  assignMealPlan(@Param('id') id: string, @Body('userId') userId: string) {
    return this.nutritionService.assignMealPlan(id, userId);
  }

  @Get('meal-plans/:id/assignments')
  getPlanAssignments(@Param('id') id: string) {
    return this.nutritionService.getPlanAssignments(id);
  }

  // ========== CLIENT MEAL PLAN ==========

  @Get('my/meal-plan')
  getClientMealPlan(@Request() req) {
    return this.nutritionService.getClientMealPlan(req.user.id);
  }

@Get('my/meal-logs')
getMealLogs(
  @Request() req,
  @Query('days') days?: number,
  @Query('date') date?: string, // NEW
) {
  return this.nutritionService.getMealLogs(req.user.id, days, date);
}


  @Post('food-logs')
  logMeal(@Request() req, @Body() logDto: LogMealDto) {
    return this.nutritionService.logMeal(req.user.id, logDto);
  }

  // ========== SUGGESTIONS ==========

  // canonical route
  @Post('meal-suggestions')
  createSuggestion(@Request() req, @Body() suggestionDto: CreateSuggestionDto) {
    return this.nutritionService.createSuggestion(req.user.id, suggestionDto);
  }

  // alias to match client usage: POST /nutrition/suggestions
  @Post('suggestions')
  createSuggestionAlias(@Request() req, @Body() suggestionDto: CreateSuggestionDto) {
    return this.nutritionService.createSuggestion(req.user.id, suggestionDto);
  }

  @Get('my/suggestions')
  getMySuggestions(@Request() req, @Query('status') status?: string, @Query('page') page?: number, @Query('limit') limit?: number) {
    return this.nutritionService.getUserSuggestions(req.user.id, { status, page, limit });
  }

  // Optional: For coaches to get suggestions from their clients
  @Get('suggestions')
  getAllSuggestions(@Request() req, @Query('status') status?: string, @Query('clientId') clientId?: string, @Query('page') page?: number, @Query('limit') limit?: number) {
    return this.nutritionService.getAllSuggestions(req.user.id, { status, clientId, page, limit });
  }

  // ========== STATISTICS ==========

  @Get('stats')
  getNutritionStats() {
    return this.nutritionService.getNutritionStats();
  }

  @Get('progress/:clientId')
  getClientProgress(@Param('clientId') clientId: string, @Query('range') range?: number) {
    return this.nutritionService.getClientProgress(clientId, range);
  }

  // ========== AI INTEGRATION ==========

  @Post('ai/generate')
  generateWithAI(@Body('prompt') prompt: string) {
    return this.nutritionService.generateMealPlanWithAI(prompt);
  }
}
