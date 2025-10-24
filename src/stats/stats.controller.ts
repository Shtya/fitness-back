 import { Controller, Get, Param, Query, UseGuards, Req } from '@nestjs/common';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guard/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';

@Controller('stats')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  /* ==================== SYSTEM OVERVIEW STATS ==================== */
  @Get('system/overview')
  @Roles(UserRole.ADMIN)
  async getSystemOverview() {
    return this.statsService.getSystemOverview();
  }

  @Get('system/detailed')
  @Roles(UserRole.ADMIN)
  async getSystemDetailedStats(@Query('timeframe') timeframe: string = '30d') {
    return this.statsService.getSystemDetailedStats(timeframe);
  }

  @Get('system/activity-trends')
  @Roles(UserRole.ADMIN)
  async getSystemActivityTrends(@Query('days') days: number = 30) {
    return this.statsService.getSystemActivityTrends(days);
  }

  /* ==================== COACH DASHBOARD STATS ==================== */
  @Get('coach/overview')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async getCoachOverview(@Req() req) {
    return this.statsService.getCoachOverview(req.user.id);
  }

  @Get('coach/clients-progress')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async getClientsProgress(@Req() req, @Query('timeframe') timeframe: string = '30d') {
    return this.statsService.getClientsProgress(req.user.id, timeframe);
  }

  @Get('coach/client/:clientId/detailed')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async getClientDetailedStats(@Param('clientId') clientId: string, @Query('timeframe') timeframe: string = '30d') {
    return this.statsService.getClientDetailedStats(clientId, timeframe);
  }

  /* ==================== CLIENT DASHBOARD STATS ==================== */
  @Get('my/overview')
  async getMyOverview(@Req() req) {
    return this.statsService.getClientOverview(req.user.id);
  }

  @Get('my/detailed')
  async getMyDetailedStats(@Req() req, @Query('timeframe') timeframe: string = '30d') {
    return this.statsService.getClientDetailedStats(req.user.id, timeframe);
  }

  @Get('my/progress-timeline')
  async getMyProgressTimeline(@Req() req, @Query('months') months: number = 6) {
    return this.statsService.getClientProgressTimeline(req.user.id, months);
  }

  @Get('my/compliance')
  async getMyComplianceStats(@Req() req, @Query('timeframe') timeframe: string = '30d') {
    return this.statsService.getClientComplianceStats(req.user.id, timeframe);
  }

  /* ==================== CROSS-USER STATS (Admin/Coach) ==================== */
  @Get('user/:userId/overview')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async getUserOverview(@Param('userId') userId: string) {
    return this.statsService.getClientOverview(userId);
  }

  @Get('user/:userId/compliance')
  @Roles(UserRole.ADMIN, UserRole.COACH)
  async getUserComplianceStats(@Param('userId') userId: string, @Query('timeframe') timeframe: string = '30d') {
    return this.statsService.getClientComplianceStats(userId, timeframe);
  }
}