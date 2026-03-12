import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from 'entities/global.entity';
import { StatsService } from './stats.service';
 
/**
 * Admin dashboard stats.
 * Mounted at /admin so full path is GET /api/v1/admin/stats
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminStatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('stats')
  getStats(@Query() query: any, @Req() req: { user: { id: string; role: UserRole } }) {
    return this.statsService.getAdminDashboardStats(query, req.user);
  }
}
