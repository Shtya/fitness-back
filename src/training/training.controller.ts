// src/training/training.controller.ts
import { BadRequestException, Controller, Get, Post, Body, Query } from '@nestjs/common';
import { TrainingService } from './training.service';
import { UpsertDailyPrDto } from 'dto/daily-pr.dto';

@Controller()
export class TrainingController {
  constructor(private readonly svc: TrainingService) {}

  // Bulk save for the exercise/day
  @Post('prs')
  async upsertDailyPR(@Query('userId') userId: string, @Body() dto: UpsertDailyPrDto) {
    if (!userId) throw new BadRequestException('userId is required');
    return this.svc.upsertDaily(userId, dto);
  }

  // Save one set (row Save button)
  @Post('prs/attempt')
  async upsertAttempt(@Query('userId') userId: string, @Body() dto: any) {
    if (!userId) throw new BadRequestException('userId is required');
    return this.svc.upsertAttempt(userId, dto);
  }

  // History table for an exercise
  @Get('prs/history')
  async history(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string) {
    if (!userId) throw new BadRequestException('userId is required');
    if (!exerciseName) throw new BadRequestException('exerciseName is required');
    return this.svc.getAttempts(userId, exerciseName);
  }

  // Top sets cards
  @Get('prs/stats/top-sets')
  async topSets(
    @Query('userId') userId: string,
    @Query('exerciseName') exerciseName: string,
    @Query('top') top = '5',
  ) {
    if (!userId) throw new BadRequestException('userId is required');
    if (!exerciseName) throw new BadRequestException('exerciseName is required');
    return this.svc.getTopSets(userId, exerciseName, Math.max(1, Number(top) || 5));
  }

  // e1RM series
  @Get('prs/stats/e1rm-series')
  async series(
    @Query('userId') userId: string,
    @Query('exerciseName') exerciseName: string,
    @Query('bucket') bucket = 'week',
    @Query('windowDays') windowDays = '90',
  ) {
    if (!userId) throw new BadRequestException('userId is required');
    if (!exerciseName) throw new BadRequestException('exerciseName is required');
    return this.svc.getE1rmSeries(userId, exerciseName, bucket, Math.max(1, Number(windowDays) || 90));
  }

  // Overview KPI cards
  @Get('prs/stats/overview')
  async overview(@Query('userId') userId: string, @Query('windowDays') windowDays = '30') {
    if (!userId) throw new BadRequestException('userId is required');
    return this.svc.getOverview(userId, Math.max(1, Number(windowDays) || 30));
  }
}
