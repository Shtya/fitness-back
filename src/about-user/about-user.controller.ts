import { Controller, Get, Param, Query, Post, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { AboutUserService } from './about-user.service';

// @UseGuards(JwtAuthGuard, RolesGuard)
@Controller('about-user')
export class AboutUserController {
  constructor(private readonly svc: AboutUserService) {}

  /** Aggregate: everything needed for the page header, left rail, chips, chart, activity */
  @Get(':id/page-data')
  async getPageData(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.getPageData(id);
  }

  /** ALIAS for your UI */
  @Get(':id/summary')
  async getSummaryAlias(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.getPageData(id);
  }

  /** Measurements: list (with date range) */
  @Get(':id/measurements')
  async listMeasurements(@Param('id', new ParseUUIDPipe()) id: string, @Query() q: any) {
    return this.svc.listMeasurements(id, q);
  }

  /** Measurements: upsert by (userId, date) unique */
  @Post(':id/measurements')
  async upsertMeasurement(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: any) {
    return this.svc.upsertMeasurement(id, dto as any);
  }

  /** Progress photos (optionally by date range) */
  @Get(':id/progress-photos')
  async listProgressPhotos(@Param('id', new ParseUUIDPipe()) id: string, @Query() q: any) {
    return this.svc.listProgressPhotos(id, q);
  }

  /** ALIAS your UI called `/photos` */
  @Get(':id/photos')
  async listPhotosAlias(@Param('id', new ParseUUIDPipe()) id: string, @Query() q: any) {
    return this.svc.listProgressPhotos(id, q);
  }

  /** Workouts assigned (active plan breakdown) */
  @Get(':id/workouts')
  async listWorkouts(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.listWorkouts(id);
  }

  /** Active meal plan (summary) */
  @Get(':id/meal-plans')
  async listMealPlans(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.listMealPlans(id);
  }

  /** Meal logs for a given day (YYYY-MM-DD) */
  @Get(':id/meal-logs')
  async listMealLogsForDay(@Param('id', new ParseUUIDPipe()) id: string, @Query() q: any) {
    return this.svc.listMealLogsForDay(id, q.date);
  }

  /** Weekly reports (as “nutrition reports”) */
  @Get(':id/reports')
  async listWeeklyReports(@Param('id', new ParseUUIDPipe()) id: string, @Query() { page, limit }: any) {
    return this.svc.listWeeklyReports(id, page, limit);
  }

  /** Generate a report (stub that satisfies your UI + DB non-null constraints) */
  @Post(':id/reports')
  async generateWeeklyReport(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: any) {
    return this.svc.generateWeeklyReport(id, dto);
  }

  @Get(':id/targets')
  async getNutritionTargets(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('lang') _lang?: string, // optional; ignored here but accepted
  ) {
    return this.svc.getNutritionTargets(id);
  }

  /** Weight metrics (compat for /metrics/weights?userId=&days=) */
  @Get(':id/metrics/weights')
  async getWeightMetrics(@Param('id', new ParseUUIDPipe()) id: string, @Query('days') days?: string) {
    return this.svc.getWeightMetrics(id, Number(days) || 30);
  }

  /** Meal logs recent (compat for /nutrition/users/:id/meal-logs?days=) */
  @Get(':id/meal-logs/recent')
  async listMealLogsRecent(@Param('id', new ParseUUIDPipe()) id: string, @Query('days') days?: string) {
    return this.svc.listMealLogsRecent(id, Number(days) || 30);
  }
}
