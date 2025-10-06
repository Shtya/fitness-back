import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import { PrsService } from './prs.service';

@Controller('prs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PrsController {
  constructor(private readonly prsService: PrsService) {}

  @Get('stats/overview')
  async getOverview(@Query('userId') userId: string, @Query('windowDays') windowDays: number = 30) {
    return await this.prsService.getOverview(userId, windowDays);
  }

  @Get('stats/e1rm-series')
  async getE1rmSeries(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string, @Query('bucket') bucket: string = 'week', @Query('windowDays') windowDays: number = 90) {
    return await this.prsService.getE1rmSeries(userId, exerciseName, bucket, windowDays);
  }

  @Get('stats/top-sets')
  async getTopSets(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string, @Query('top') top: number = 5) {
    return await this.prsService.getTopSets(userId, exerciseName, top);
  }

  @Get('history')
  async getExerciseHistory(@Query('userId') userId: string, @Query('exerciseName') exerciseName: string) {
    return await this.prsService.getExerciseHistory(userId, exerciseName);
  }

  @Post('last-workout-sets')
  async getLastWorkoutSets(
    @Body()
    body: {
      userId: string;
      exercises: string[]; // Array of exercise names (not IDs)
    },
  ) {
    return await this.prsService.getLastWorkoutSets(body.userId, body.exercises);
  }

  @Post()
  async upsertDailyPR(
    @Body()
    body: {
      exerciseName: string;
      date: string;
      records: Array<{
        id?: string;
        weight: number;
        reps: number;
        done: boolean;
        setNumber: number;
      }>;
    },
    @Query('userId') userId: string,
  ) {
    return await this.prsService.upsertDailyPR(userId, body.exerciseName, body.date, body.records);
  }
  @Get('all-stats')
  async getAllStats(@Query('userId') userId: string, @Query('windowDays') windowDays: number = 30, @Query('exerciseWindowDays') exerciseWindowDays: number = 90) {
    return await this.prsService.getAllStats(userId, windowDays, exerciseWindowDays);
  }

  @Get('last-day/by-name')
  async getLastDayByName(@Query('userId') userId: string, @Query('day') day: string, @Query('onOrBefore') onOrBefore: string) {
    return await this.prsService.getLastDayByName(userId, day, onOrBefore);
  }

  // Additional endpoints for coach/admin access
  @Get('user/:userId/summary')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async getUserSummary(@Param('userId') userId: string) {
    const overview = await this.prsService.getOverview(userId, 30);
    const recentSessions = await this.prsService.getOverview(userId, 7);

    return {
      ...overview,
      recentActivity: recentSessions.history,
    };
  }

  @Get('user/:userId/progress/:exerciseName')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async getUserExerciseProgress(@Param('userId') userId: string, @Param('exerciseName') exerciseName: string) {
    const series = await this.prsService.getE1rmSeries(userId, exerciseName, 'month', 365);
    const topSets = await this.prsService.getTopSets(userId, exerciseName, 10);
    const history = await this.prsService.getExerciseHistory(userId, exerciseName);

    return {
      progress: series,
      bestSets: topSets,
      recentHistory: history.slice(0, 20), // Last 20 attempts
    };
  }

  // NEW: Get last exercise data for progressive overload (optional)
  @Get('last-exercise/:exerciseName')
  async getLastExerciseData(@Query('userId') userId: string, @Param('exerciseName') exerciseName: string) {
    // This uses the same logic but returns the previous best sets for defaults
    const exerciseId = this.generateExerciseId(exerciseName);

    // You can implement this method in the service if needed
    const lastRecord = await this.prsService.getLastDayByName(
      userId,
      'any', // We don't care about day for this
      new Date().toISOString().split('T')[0],
    );

    return {
      previousBestSets: lastRecord.exercises.find(ex => ex.exerciseName === exerciseName)?.records || [],
      suggestion: 'Use these as starting points and try to increase weight or reps!',
    };
  }

  private generateExerciseId(exerciseName: string): string {
    return Buffer.from(exerciseName).toString('base64').slice(0, 20);
  }
}
