import { Controller, Get, Post, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import { PrsService } from './prs.service';

@Controller('prs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PrsController {
  constructor(private readonly prsService: PrsService) {}

  @Get('stats/progress')
  async getProgress(@Query('userId') userId: string, @Query('windowDays') windowDays: string = '30', @Query('exerciseWindowDays') exerciseWindowDays: string = '90', @Req() req: any) {
    return this.prsService.getProgress(+windowDays, +exerciseWindowDays, userId ?? req.user.id);
  }

  @Get('stats/day')
  async getDayStats(@Query('userId') userId: string, @Query('date') date: string, @Req() req: any) {
    return this.prsService.getDayStats(userId ?? req.user.id, date);
  }

  @Get('exercise/progress')
  async getExerciseProgressDeltas(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string, @Query('limit') limit = '50', @Req() req: any) {
    return this.prsService.getExerciseDeltas(userId ?? req.user.id, exerciseName, +limit);
  }

  @Get('exercise/compare')
  async compareExerciseBetweenDates(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string, @Query('from') fromDate: string, @Query('to') toDate: string, @Req() req: any) {
    return this.prsService.compareExerciseBetweenDates(userId ?? req.user.id, exerciseName, fromDate, toDate);
  }

  @Get('stats/overview')
  async getOverview(@Query('userId') userId: string, @Query('windowDays') windowDays: number = 30, @Req() req: any) {
    return await this.prsService.getOverview(userId ?? req.user.id, windowDays);
  }

  @Get('stats/e1rm-series')
  async getE1rmSeries(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string, @Query('bucket') bucket: string = 'week', @Query('windowDays') windowDays: number = 90, @Req() req: any) {
    return await this.prsService.getE1rmSeries(userId ?? req.user.id, exerciseName, bucket, windowDays);
  }

  @Get('stats/top-sets')
  async getTopSets(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string, @Query('top') top: number = 5, @Req() req: any) {
    return await this.prsService.getTopSets(userId ?? req.user.id, exerciseName, top);
  }

  @Get('history')
  async getExerciseHistory(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string, @Req() req: any) {
    return await this.prsService.getExerciseHistory(userId ?? req.user.id, exerciseName);
  }

  @Post('last-workout-sets')
  async getLastWorkoutSets(@Body() body: { userId?: string; exercises: string[] }, @Req() req: any) {
    const uid = body.userId ?? req.user.id;
    return await this.prsService.getLastWorkoutSets(uid, body.exercises);
  }

  @Post()
  async upsertDailyPR(
    @Body()
    body: {
      exerciseName: string;
      date: string;
      records: Array<{ id?: string; weight: number; reps: number; done: boolean; setNumber: number }>;
    },
    @Query('userId') userId: string,
    @Req() req: any,
  ) {
    return await this.prsService.upsertDailyPR(userId ?? req.user.id, body.exerciseName, body.date, body.records);
  }

  @Get('all-stats')
  async getAllStats(@Query('userId') userId: string, @Query('windowDays') windowDays: number = 30, @Query('exerciseWindowDays') exerciseWindowDays: number = 90, @Req() req: any) {
    return await this.prsService.getAllStats(userId ?? req.user.id, windowDays, exerciseWindowDays);
  }

  @Get('last-day/by-name')
  async getLastDayByName(@Query('userId') userId: string, @Query('day') day: string, @Query('onOrBefore') onOrBefore: string, @Req() req: any) {
    return await this.prsService.getLastDayByName(userId ?? req.user.id, day, onOrBefore);
  }

  // Coach/admin
  @Get('user/:userId/summary')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async getUserSummary(@Param('userId') userId: string) {
    const overview = await this.prsService.getOverview(userId, 30);
    const recentSessions = await this.prsService.getOverview(userId, 7);
    return { ...overview, recentActivity: recentSessions.history };
  }

  @Get('user/:userId/progress/:exerciseName')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async getUserExerciseProgress(@Param('userId') userId: string, @Param('exerciseName') exerciseName: string) {
    const series = await this.prsService.getE1rmSeries(userId, exerciseName, 'month', 365);
    const topSets = await this.prsService.getTopSets(userId, exerciseName, 10);
    const history = await this.prsService.getExerciseHistory(userId, exerciseName);
    return { progress: series, bestSets: topSets, recentHistory: history.slice(0, 20) };
  }

  @Get('last-exercise/:exerciseName')
  async getLastExerciseData(@Query('userId') userId: string, @Param('exerciseName') exerciseName: string, @Req() req: any) {
    const uid = userId ?? req.user.id;
    const lastRecord = await this.prsService.getLastDayByName(uid, 'any', new Date().toISOString().split('T')[0]);
    return {
      previousBestSets: lastRecord.exercises.find(ex => ex.exerciseName === exerciseName)?.records || [],
      suggestion: 'Use these as starting points and try to increase weight or reps!',
    };
  }
}
