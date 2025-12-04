import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Req } from '@nestjs/common';
import { NutritionService } from './nutrition.service';
import { CreateMealPlanDto } from './dto/create-meal-plan.dto';
import { LogMealDto } from './dto/log-meal.dto';
import { CreateSuggestionDto } from './dto/suggestion.dto';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { UpdateMealPlanDto } from './dto/update-meal-plan.dto';

@Controller('nutrition')
@UseGuards(JwtAuthGuard)
export class NutritionController {
  constructor(private readonly nutritionService: NutritionService) {}

  // ========== MEAL PLANS MANAGEMENT (Coach/Admin) ==========

  @Post('meal-plans')
  createMealPlan(@Body() createDto: CreateMealPlanDto, @Request() req, @Query('lang') lang?: 'ar' | 'en') {
    return this.nutritionService.createMealPlan(createDto, { id: req.user.id, role: req.user.role }, lang);
  }

  @Get('meal-plans')
  findAllMealPlans(@Request() req, @Query('user_id') user_id :any , @Query('search') search?: string, @Query('page') page: number = 1, @Query('limit') limit: number = 12, @Query('sortBy') sortBy: string = 'created_at', @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'DESC', @Query('lang') lang?: 'ar' | 'en') {
    return this.nutritionService.findAllMealPlans(
      {
        q: search,
        page: Number(page) || 1,
        limit: Number(limit) || 12,
        sortBy,
        sortOrder,
      },
      { id: user_id?? req.user.id, role: req.user.role },
      lang,
    );
  }

  @Get('meal-plans/:id')
  findMealPlanById(@Param('id') id: string, @Request() req, @Query('lang') lang?: 'ar' | 'en') {
    return this.nutritionService.findMealPlanByIdSecure(id, { id: req.user.id, role: req.user.role }, lang);
  }

  @Put('meal-plans/:id')
  updateMealPlan(@Param('id') id: string, @Body() updateDto: UpdateMealPlanDto, @Request() req, @Query('lang') lang?: 'ar' | 'en') {
    return this.nutritionService.updateMealPlan(id, updateDto, { id: req.user.id, role: req.user.role }, lang);
  }

  @Delete('meal-plans/:id')
  deleteMealPlan(@Param('id') id: string, @Request() req, @Query('lang') lang?: 'ar' | 'en') {
    return this.nutritionService.deleteMealPlan(id, { id: req.user.id, role: req.user.role }, lang);
  }

  @Post('meal-plans/:id/assign')
  assignMealPlan(@Param('id') id: string, @Body('userId') userId: string, @Request() req, @Query('lang') lang?: 'ar' | 'en') {
    return this.nutritionService.assignMealPlan(id, userId, { id: req.user.id, role: req.user.role }, lang);
  }

  @Get('meal-plans/:id/assignments')
  getPlanAssignments(@Param('id') id: string, @Request() req, @Query('lang') lang?: 'ar' | 'en') {
    return this.nutritionService.getPlanAssignmentsSecure(id, { id: req.user.id, role: req.user.role }, lang);
  }

  // ========== CLIENT MEAL PLAN ==========

  @Get('my/meal-plan')
  getClientMealPlan(@Request() req) {
    return this.nutritionService.getClientMealPlan(req.user.id);
  }

  @Get('my/meal-logs')
  getMealLogs(@Request() req, @Query('days') days?: number, @Query('userId') userId?: string,  @Query('date') date?: string) {
    return this.nutritionService.getMealLogs(userId ?? req.user.id, days, date);
  }

  @Post('food-logs')
  logMeal(@Request() req, @Body() logDto: LogMealDto) {
    return this.nutritionService.logMeal(req.user.id, logDto);
  }

  // ========== SUGGESTIONS ==========

  @Post('meal-suggestions')
  createSuggestion(@Request() req, @Body() suggestionDto: CreateSuggestionDto) {
    return this.nutritionService.createSuggestion(req.user.id, suggestionDto);
  }

  @Post('suggestions')
  createSuggestionAlias(@Request() req, @Body() suggestionDto: CreateSuggestionDto) {
    return this.nutritionService.createSuggestion(req.user.id, suggestionDto);
  }

  @Get('my/suggestions')
  getMySuggestions(@Request() req, @Query('status') status?: string, @Query('page') page?: number, @Query('limit') limit?: number) {
    return this.nutritionService.getUserSuggestions(req.user.id, { status, page, limit });
  }

  @Get('suggestions')
  getAllSuggestions(@Request() req, @Query('status') status?: string, @Query('clientId') clientId?: string, @Query('page') page?: number, @Query('limit') limit?: number) {
    return this.nutritionService.getAllSuggestions(req.user.id, { status, clientId, page, limit });
  }

  // ========== STATISTICS ==========

  @Get('stats')
  getNutritionStats(@Request() req) {
    return this.nutritionService.getNutritionStats({
      id: req.user.id,
      role: req.user.role,
    });
  }

  @Get('progress/:clientId')
  getClientProgress(@Param('clientId') clientId: string, @Query('range') range?: number) {
    return this.nutritionService.getClientProgress(clientId, range);
  }

  // ========== AI INTEGRATION ==========

  @Post('ai/generate')
  generateWithAI(@Body('prompt') prompt: string , @Req() req:any) {
    return this.nutritionService.generateMealPlanWithAI(prompt , req?.user?.id);
  }
}
